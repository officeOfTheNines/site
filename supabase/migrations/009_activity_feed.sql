-- ===========================================================================
-- STEP 9: venues, club events, the activity feed (home page) and the "My clubs | All clubs" scope
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 008. Safe to run again. Runs as one transaction.
--   1. Renames reco_places to venues and reco_comments.place_id to venue_id (no data changes), and
--      re-creates the Recos functions that use those names (add_reco and reco_feed now return venue_id).
--   2. Adds clubs.rating_scale (The Nines 10, Les Ronds 20) and club_events (dinners: date, brigadiers,
--      wine/food/vibe ratings), empty and not used yet.
--   3. Adds the activity feed functions and their indexes.
-- Existing Recos permissions are unchanged.
--
-- The feed is derived from reco_comments (no events table):
--   reco_added    = the first comment on a restaurant that the viewer can see
--   comment_added = a later comment on a restaurant
-- Edits do not create events (only created_at is used). Deleting a comment removes its event.
--
-- activity_feed() is SECURITY INVOKER, so the existing row-level security on reco_comments and
-- venues still decides what the viewer can read; on top of that it enforces:
--   * never the viewer's own events;
--   * "Only me" comments never shown to others (not even to super admins, who see them on the map
--     for moderation); "My club" comments only to members of that club;
--   * my_clubs:  events by members of any club the viewer belongs to;
--     all_clubs: also "Everyone" comments by members of any club.
-- Never emails or phones: authors appear as "First L." with the club they posted as.

begin;

-- ---------------------------------------------------------------------------
-- reco_places is now called venues (the same restaurants will also hold club dinners).
-- Only the table, its constraints and its index are renamed; reco_comments.venue_id keeps its name.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.reco_places') is not null and to_regclass('public.venues') is null then
    alter table public.reco_places rename to venues;
    alter table public.venues rename constraint reco_places_pkey to venues_pkey;
    alter table public.venues rename constraint reco_places_created_by_fkey to venues_created_by_fkey;
    alter table public.venues rename constraint reco_places_name_shape to venues_name_shape;
    alter table public.venues rename constraint reco_places_address_len to venues_address_len;
    alter table public.venues rename constraint reco_places_lat_range to venues_lat_range;
    alter table public.venues rename constraint reco_places_lng_range to venues_lng_range;
    alter table public.venues rename constraint reco_places_external_len to venues_external_len;
    alter index public.reco_places_external_idx rename to venues_external_idx;
  end if;
  -- reco_comments.place_id is now venue_id
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'reco_comments' and column_name = 'place_id') then
    alter table public.reco_comments rename column place_id to venue_id;
    alter table public.reco_comments rename constraint reco_comments_place_id_fkey to reco_comments_venue_id_fkey;
    alter index public.reco_comments_place_idx rename to reco_comments_venue_idx;
  end if;
end;
$$;

-- Dinner ratings are out of each club's own scale: The Nines 10, Les Ronds 20.
alter table public.clubs add column if not exists rating_scale smallint not null default 10;
alter table public.clubs drop constraint if exists clubs_rating_scale;
alter table public.clubs add constraint clubs_rating_scale check (rating_scale between 1 and 100);
update public.clubs set rating_scale = 20 where id = 2 and rating_scale = 10;

-- ---------------------------------------------------------------------------
-- Club events (dinners): ready for the two dinner maps' Google Sheets, not used by the site yet.
-- One row per dinner, at a venue (the same venues as Recos, so a restaurant is one pin for both).
-- Brigadiers are stored as the names written at the time (a JSON array of text), so later name
-- changes do not rewrite history. Ratings are out of the club's rating_scale (clubs table: The Nines
-- 10, Les Ronds 20); sheet columns: bottles = wine, plate = food, atmosphere = vibe.
-- Nobody can read or write it from the site yet (no permissions granted): it is filled by the
-- office in the SQL editor or by an import script.
-- ---------------------------------------------------------------------------
create table if not exists public.club_events (
  id            uuid primary key default gen_random_uuid(),
  club_id       integer not null references public.clubs (id),
  venue_id      uuid not null references public.venues (id) on delete restrict,
  event_date    date,                          -- when known
  season        text,                          -- as written in the sheet, e.g. "Season 3"
  month         text,                          -- as written in the sheet, e.g. "March 2025"
  brigadiers    jsonb not null default '[]'::jsonb,   -- ["First Last", ...]
  rating_wine   numeric(5,2),                  -- out of the club's rating_scale (clubs table)
  rating_food   numeric(5,2),
  rating_vibe   numeric(5,2),
  menu_url      text,
  notes         text,
  source_ref    text,                          -- the sheet's own id for the row, for re-runnable imports
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint club_events_brigadiers_shape check (
    jsonb_typeof(brigadiers) = 'array'
    and not jsonb_path_exists(brigadiers, '$[*] ? (@.type() != "string")')),
  constraint club_events_ratings_positive check (coalesce(rating_wine, 0) >= 0 and coalesce(rating_food, 0) >= 0 and coalesce(rating_vibe, 0) >= 0),
  constraint club_events_menu_url      check (menu_url is null or menu_url ~ '^https://'),
  constraint club_events_text_lengths  check (char_length(coalesce(season, '')) <= 60 and char_length(coalesce(month, '')) <= 60
                                              and char_length(coalesce(notes, '')) <= 2000 and char_length(coalesce(source_ref, '')) <= 60),
  constraint club_events_source_ref_key unique (club_id, source_ref)
);
create index if not exists club_events_club_date_idx on public.club_events (club_id, event_date desc);
create index if not exists club_events_venue_idx     on public.club_events (venue_id);

create or replace function public.club_events_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  scale smallint;
begin
  new.season := nullif(btrim(new.season), '');
  new.month := nullif(btrim(new.month), '');
  new.notes := nullif(btrim(new.notes), '');
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  -- ratings may not exceed the club's scale (clubs.rating_scale: 10 for The Nines, 20 for Les Ronds)
  select c.rating_scale into scale from public.clubs c where c.id = new.club_id;
  if greatest(new.rating_wine, new.rating_food, new.rating_vibe) > scale then
    raise exception 'Ratings for this club are out of %.', scale using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists club_events_before_write on public.club_events;
create trigger club_events_before_write
  before insert or update on public.club_events
  for each row execute function public.club_events_before_write();

alter table public.club_events enable row level security;
revoke all on table public.club_events from public, anon, authenticated;
revoke execute on function public.club_events_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
drop function if exists public.add_reco(integer, text, text, double precision, double precision, text, text, text, uuid);
drop function if exists public.reco_feed();

-- The Recos functions that name the table, re-created to use venues (unchanged otherwise, except
-- that removing a venue's last reco keeps the venue when a club event uses it).
-- ---------------------------------------------------------------------------
-- Can the signed-in person see this place? (one visible comment, or they created it)
create or replace function public.can_see_reco_place(p_place uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_access() and (
    exists (select 1 from public.reco_comments c
            where c.venue_id = p_place and public.can_see_reco_comment(c.visibility, c.club_id, c.profile_id))
    or exists (select 1 from public.venues p
               where p.id = p_place and p.created_by is not null and p.created_by = public.current_profile_id())
  );
$$;

-- Does a stored place match what someone is adding? Same provider id, or within about 30 metres
-- with a similar name (equal, or one contained in the other, ignoring case, accents and punctuation).
create or replace function public.reco_place_matches(p_place public.venues, p_name text,
                                                     p_lat double precision, p_lng double precision,
                                                     p_external_id text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_external_id is not null and p_place.external_id = p_external_id)
      or (public.reco_distance_m(p_place.lat, p_place.lng, p_lat, p_lng) <= 30
          and length(public.reco_name_key(p_name)) >= 3
          and (public.reco_name_key(p_place.name) = public.reco_name_key(p_name)
               or strpos(public.reco_name_key(p_place.name), public.reco_name_key(p_name)) > 0
               or strpos(public.reco_name_key(p_name), public.reco_name_key(p_place.name)) > 0));
$$;

-- Duplicate check for the add form: a matching place the viewer can SEE, or nothing.
create or replace function public.find_reco_place(p_name text, p_lat double precision, p_lng double precision,
                                                  p_external_id text default null)
returns table (id uuid, name text, address text, lat double precision, lng double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.address, p.lat, p.lng
  from public.venues p
  where public.has_any_access()
    and public.reco_place_matches(p, p_name, p_lat, p_lng, nullif(btrim(p_external_id), ''))
    and public.can_see_reco_place(p.id)
  order by (p.external_id is not distinct from nullif(btrim(p_external_id), '')) desc,
           public.reco_distance_m(p.lat, p.lng, p_lat, p_lng)
  limit 1;
$$;

-- Add a reco. Attaches the comment to:
--   1. p_venue_id, when given and visible to the caller (they confirmed "Already recommended");
--   2. otherwise any matching place, visible or not (the caller is told nothing about a hidden one);
--   3. otherwise a new place.
-- The caller must have a profile and belong to p_club. Returns the place id and the comment id.
create or replace function public.add_reco(
  p_club integer,
  p_name text,
  p_address text,
  p_lat double precision,
  p_lng double precision,
  p_external_id text,
  p_body text,
  p_visibility text default 'everyone',
  p_venue_id uuid default null
)
returns table (venue_id uuid, comment_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_profile_id();
  ext text := nullif(btrim(p_external_id), '');
  pid uuid;
  cid uuid;
begin
  if me is null then
    raise exception 'You need a member profile to add a reco.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.club_access a
                 where a.club_id = p_club and a.email = public.current_confirmed_email()) then
    raise exception 'You can only post as a club you belong to.' using errcode = '42501';
  end if;
  if coalesce(p_visibility, '') not in ('everyone', 'club', 'me') then
    raise exception 'Visibility must be everyone, club or me.' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'The location is missing or not valid.' using errcode = '22023';
  end if;

  -- serialise adds so two members adding the same place at once share one place
  perform pg_advisory_xact_lock(hashtext('public.venues.add'));

  if p_venue_id is not null and public.can_see_reco_place(p_venue_id) then
    pid := p_venue_id;
  end if;

  if pid is null then
    select p.id into pid
    from public.venues p
    where public.reco_place_matches(p, p_name, p_lat, p_lng, ext)
    order by (p.external_id is not distinct from ext) desc, public.reco_distance_m(p.lat, p.lng, p_lat, p_lng)
    limit 1;
  end if;

  if pid is null then
    insert into public.venues (name, address, lat, lng, external_id, created_by)
    values (btrim(p_name), nullif(btrim(p_address), ''), p_lat, p_lng, ext, me)
    returning id into pid;
  end if;

  insert into public.reco_comments (venue_id, profile_id, club_id, body, visibility)
  values (pid, me, p_club, btrim(p_body), p_visibility)
  returning id into cid;

  return query select pid, cid;
end;
$$;

-- Everything the Recos map shows: the visible places and, for each, its visible comments, with the
-- author shown as "First L." and the club's name. Never emails or phones.
create or replace function public.reco_feed()
returns table (
  venue_id      uuid,
  venue_name    text,
  address       text,
  lat           double precision,
  lng           double precision,
  comment_id    uuid,
  author_label  text,
  club_id       integer,
  club_name     text,
  body          text,
  visibility    text,
  created_at    timestamptz,
  updated_at    timestamptz,
  is_mine       boolean,
  can_delete    boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.address, p.lat, p.lng,
         c.id, public.reco_author_label(pr.display_name), c.club_id, cl.name, c.body, c.visibility,
         c.created_at, c.updated_at,
         coalesce(c.profile_id = public.current_profile_id(), false),
         coalesce(c.profile_id = public.current_profile_id() or public.is_admin(c.club_id), false)
  from public.venues p
  left join public.reco_comments c
    on c.venue_id = p.id and public.can_see_reco_comment(c.visibility, c.club_id, c.profile_id)
  left join public.profiles pr on pr.id = c.profile_id
  left join public.clubs cl on cl.id = c.club_id
  where public.has_any_access()
    and public.can_see_reco_place(p.id)
  order by p.name, c.created_at desc nulls last;
$$;

-- Tidy text; only body and visibility change after posting.
create or replace function public.reco_comments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.body := btrim(new.body);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.venue_id := old.venue_id;
    new.profile_id := old.profile_id;
    new.club_id := old.club_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;


-- Deleting the last comment on a place deletes the place.
create or replace function public.reco_comments_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- the last reco gone: remove the venue, unless a club event (a dinner) uses it
  delete from public.venues p
  where p.id = old.venue_id
    and not exists (select 1 from public.reco_comments c where c.venue_id = old.venue_id)
    and not exists (select 1 from public.club_events e where e.venue_id = old.venue_id);
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists reco_comments_created_idx       on public.reco_comments (created_at desc, id desc);
create index if not exists reco_comments_venue_created_idx on public.reco_comments (venue_id, created_at, id);
create index if not exists reco_comments_profile_created_idx on public.reco_comments (profile_id, created_at desc);
create index if not exists club_access_email_idx           on public.club_access (email);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- For one comment the signed-in member can see: is it theirs, the author as "First L.", and does the
-- author belong to a club the member belongs to. Returns no row for a comment they cannot see.
-- (Signed-in members cannot read reco_comments.profile_id directly; this gives only these facts.)
create or replace function public.reco_comment_facts(p_comment uuid)
returns table (is_mine boolean, author_label text, shares_club boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(c.profile_id = public.current_profile_id(), false),
         public.reco_author_label(pr.display_name),
         exists (select 1 from public.club_access a where a.email = pr.email and public.is_member(a.club_id))
  from public.reco_comments c
  join public.profiles pr on pr.id = c.profile_id
  where c.id = p_comment
    and public.can_see_reco_comment(c.visibility, c.club_id, c.profile_id);
$$;

-- "Postcode or area" from a free-text address: a UK postcode ("EC1M 4AY"), a French postcode and town
-- ("75011 Paris"), otherwise the last part of the address.
create or replace function public.reco_area(p_address text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_address is null or btrim(p_address) = '' then null
    when p_address ~* '\m[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}\M'
      then upper(substring(p_address from '(?i)\m([A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2})\M'))
    when p_address ~ '\m[0-9]{5}\s+[^,]+'
      then btrim(substring(p_address from '\m([0-9]{5}\s+[^,]+)'))
    else left(btrim(regexp_replace(p_address, '^.*,', '')), 40)
  end;
$$;

-- ---------------------------------------------------------------------------
-- The home feed
-- ---------------------------------------------------------------------------
create or replace function public.activity_feed(
  p_scope  text        default 'my_clubs',
  p_limit  integer     default 20,
  p_before timestamptz default null
)
returns table (
  event_type   text,         -- 'reco_added' or 'comment_added'
  created_at   timestamptz,
  comment_id   uuid,
  venue_id     uuid,         -- the reco (restaurant) to open on the map
  venue_name   text,
  area         text,
  author_label text,         -- "First L."
  club_name    text,         -- the club the author posted as
  stars        smallint,     -- not stored yet: always null
  price_level  smallint,     -- not stored yet: always null
  snippet      text,         -- the comment, cut to about 140 characters
  image_path   text          -- reserved for photos: always null for now
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_scope is null or p_scope not in ('my_clubs', 'all_clubs') then
    raise exception 'Scope must be my_clubs or all_clubs.' using errcode = '22023';
  end if;
  return query
  select
    case when exists (
      -- an earlier comment on the same restaurant that the viewer can see (row-level security applies)
      select 1 from public.reco_comments e
      where e.venue_id = c.venue_id and (e.created_at, e.id) < (c.created_at, c.id)
    ) then 'comment_added' else 'reco_added' end,
    c.created_at,
    c.id,
    p.id,
    p.name,
    public.reco_area(p.address),
    f.author_label,
    cl.name,
    null::smallint,
    null::smallint,
    case when char_length(c.body) > 140 then rtrim(left(c.body, 139)) || '…' else c.body end,
    null::text
  from public.reco_comments c
  cross join lateral public.reco_comment_facts(c.id) f
  join public.venues p on p.id = c.venue_id
  left join public.clubs cl on cl.id = c.club_id
  where public.has_any_access()
    and (p_before is null or c.created_at < p_before)
    and not f.is_mine
    and c.visibility <> 'me'
    and (c.visibility <> 'club' or public.is_member(c.club_id))
    and (f.shares_club or (p_scope = 'all_clubs' and c.visibility = 'everyone'))
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

-- ---------------------------------------------------------------------------
-- The member's own recos and comments (home page, "My activity"). Not affected by the scope.
-- Whether a comment counts as "added" is judged on the comments the member can see, so it never
-- hints at a hidden earlier comment.
-- ---------------------------------------------------------------------------
create or replace function public.my_reco_activity(
  p_limit  integer     default 20,
  p_before timestamptz default null
)
returns table (
  event_type   text,
  created_at   timestamptz,
  comment_id   uuid,
  venue_id     uuid,
  venue_name   text,
  area         text,
  club_name    text,
  visibility   text,
  stars        smallint,
  price_level  smallint,
  snippet      text,
  image_path   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when exists (
      select 1 from public.reco_comments e
      where e.venue_id = c.venue_id and (e.created_at, e.id) < (c.created_at, c.id)
        and public.can_see_reco_comment(e.visibility, e.club_id, e.profile_id)
    ) then 'comment_added' else 'reco_added' end,
    c.created_at, c.id, p.id, p.name, public.reco_area(p.address), cl.name, c.visibility,
    null::smallint, null::smallint,
    case when char_length(c.body) > 140 then rtrim(left(c.body, 139)) || '…' else c.body end,
    null::text
  from public.reco_comments c
  join public.venues p on p.id = c.venue_id
  left join public.clubs cl on cl.id = c.club_id
  where public.has_any_access()
    and public.current_profile_id() is not null
    and c.profile_id = public.current_profile_id()
    and (p_before is null or c.created_at < p_before)
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- The Recos map's "My clubs" view: the restaurants with at least one comment that is the member's own
-- or by a member of their clubs, under the same visibility rules as the feed. ("All clubs" on the map
-- shows every pin the member can see, as before.)
-- ---------------------------------------------------------------------------
create or replace function public.reco_scope_venue_ids(p_scope text default 'my_clubs')
returns setof uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_scope is null or p_scope not in ('my_clubs', 'all_clubs') then
    raise exception 'Scope must be my_clubs or all_clubs.' using errcode = '22023';
  end if;
  return query
  select distinct c.venue_id
  from public.reco_comments c
  cross join lateral public.reco_comment_facts(c.id) f
  where public.has_any_access()
    and (f.is_mine
         or (c.visibility <> 'me'
             and (c.visibility <> 'club' or public.is_member(c.club_id))
             and (f.shares_club or (p_scope = 'all_clubs' and c.visibility = 'everyone'))));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: signed-in people only
-- ---------------------------------------------------------------------------
revoke execute on function public.reco_comment_facts(uuid)                          from public, anon;
revoke execute on function public.reco_area(text)                                   from public, anon;
revoke execute on function public.activity_feed(text, integer, timestamptz)         from public, anon;
revoke execute on function public.my_reco_activity(integer, timestamptz)            from public, anon;
revoke execute on function public.reco_scope_venue_ids(text)                        from public, anon;
revoke execute on function public.add_reco(integer, text, text, double precision, double precision, text, text, text, uuid) from public, anon;
revoke execute on function public.reco_feed()                                       from public, anon;
grant execute on function public.add_reco(integer, text, text, double precision, double precision, text, text, text, uuid) to authenticated;
grant execute on function public.reco_feed()                                        to authenticated;
grant execute on function public.reco_comment_facts(uuid)                           to authenticated;
grant execute on function public.reco_area(text)                                    to authenticated;
grant execute on function public.activity_feed(text, integer, timestamptz)          to authenticated;
grant execute on function public.my_reco_activity(integer, timestamptz)             to authenticated;
grant execute on function public.reco_scope_venue_ids(text)                         to authenticated;

commit;

notify pgrst, 'reload schema';
