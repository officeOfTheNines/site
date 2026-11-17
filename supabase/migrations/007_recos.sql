-- ===========================================================================
-- STEP 7: Recos (members' restaurant recommendations)
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 006. One transaction; safe to run again. Only adds things.
-- (supabase/schema.sql already contains this section, for brand-new projects.)
--
-- reco_places   = a restaurant on the Recos map (no visibility of its own).
-- reco_comments = a member's recommendation of a place: short text, the club they posted as, and who
--                 may see it: 'everyone' (members of any club), 'club' (members of that club) or 'me'
--                 (only the author; super admins can see everything, for moderation).
-- A place is visible only to people who can see at least one of its comments, or who created it.
-- Nothing (no error, count or duplicate warning) reveals a place the viewer cannot see.
-- Deleting the last comment on a place deletes the place.

begin;

create table if not exists public.reco_places (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  address      text,
  lat          double precision not null,
  lng          double precision not null,
  external_id  text,             -- a map provider's id for the place (e.g. 'osm:N123'), when known
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint reco_places_name_shape    check (btrim(name) <> '' and char_length(name) <= 120),
  constraint reco_places_address_len   check (address is null or char_length(address) <= 300),
  constraint reco_places_lat_range     check (lat between -90 and 90),
  constraint reco_places_lng_range     check (lng between -180 and 180),
  constraint reco_places_external_len  check (external_id is null or char_length(external_id) <= 200)
);
create index if not exists reco_places_external_idx on public.reco_places (external_id);

create table if not exists public.reco_comments (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.reco_places (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  club_id     integer not null references public.clubs (id),
  body        text not null,
  visibility  text not null default 'everyone',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint reco_comments_body_shape  check (btrim(body) <> '' and char_length(body) <= 300),
  constraint reco_comments_visibility  check (visibility in ('everyone', 'club', 'me'))
);
create index if not exists reco_comments_place_idx   on public.reco_comments (place_id);
create index if not exists reco_comments_profile_idx on public.reco_comments (profile_id);

alter table public.reco_places   enable row level security;
alter table public.reco_comments enable row level security;

-- ---------------------------------------------------------------------------
-- Who can see what
-- ---------------------------------------------------------------------------

-- Can the signed-in person see a comment with these settings?
create or replace function public.can_see_reco_comment(p_visibility text, p_club integer, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.has_any_access() then false
    when public.is_super_admin() then true
    when p_profile is not null and p_profile = public.current_profile_id() then true
    when p_visibility = 'everyone' then true
    when p_visibility = 'club' then public.is_member(p_club)
    else false
  end;
$$;

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
            where c.place_id = p_place and public.can_see_reco_comment(c.visibility, c.club_id, c.profile_id))
    or exists (select 1 from public.reco_places p
               where p.id = p_place and p.created_by is not null and p.created_by = public.current_profile_id())
  );
$$;

-- "Name lower-cased, accents and punctuation removed", for comparing restaurant names.
create or replace function public.reco_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           translate(lower(coalesce(p_name, '')),
                     'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', 'aaaaaaceeeeiiiinooooouuuuyyoa'),
           '[^a-z0-9]+', '', 'g');
$$;

-- Distance in metres between two points (haversine).
create or replace function public.reco_distance_m(lat1 double precision, lng1 double precision,
                                                  lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
           + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- Does a stored place match what someone is adding? Same provider id, or within about 30 metres
-- with a similar name (equal, or one contained in the other, ignoring case, accents and punctuation).
create or replace function public.reco_place_matches(p_place public.reco_places, p_name text,
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
  from public.reco_places p
  where public.has_any_access()
    and public.reco_place_matches(p, p_name, p_lat, p_lng, nullif(btrim(p_external_id), ''))
    and public.can_see_reco_place(p.id)
  order by (p.external_id is not distinct from nullif(btrim(p_external_id), '')) desc,
           public.reco_distance_m(p.lat, p.lng, p_lat, p_lng)
  limit 1;
$$;

-- Add a reco. Attaches the comment to:
--   1. p_place_id, when given and visible to the caller (they confirmed "Already recommended");
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
  p_place_id uuid default null
)
returns table (place_id uuid, comment_id uuid)
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
  perform pg_advisory_xact_lock(hashtext('public.reco_places.add'));

  if p_place_id is not null and public.can_see_reco_place(p_place_id) then
    pid := p_place_id;
  end if;

  if pid is null then
    select p.id into pid
    from public.reco_places p
    where public.reco_place_matches(p, p_name, p_lat, p_lng, ext)
    order by (p.external_id is not distinct from ext) desc, public.reco_distance_m(p.lat, p.lng, p_lat, p_lng)
    limit 1;
  end if;

  if pid is null then
    insert into public.reco_places (name, address, lat, lng, external_id, created_by)
    values (btrim(p_name), nullif(btrim(p_address), ''), p_lat, p_lng, ext, me)
    returning id into pid;
  end if;

  insert into public.reco_comments (place_id, profile_id, club_id, body, visibility)
  values (pid, me, p_club, btrim(p_body), p_visibility)
  returning id into cid;

  return query select pid, cid;
end;
$$;

-- "Jean-Baptiste Solanet" -> "Jean-Baptiste S."; "Merry de Dreux-Brézé" -> "Merry D."
create or replace function public.reco_author_label(p_display_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[] := regexp_split_to_array(btrim(coalesce(p_display_name, '')), '\s+');
  i integer;
begin
  if coalesce(array_length(parts, 1), 0) = 0 or parts[1] = '' then
    return 'Member';
  end if;
  if array_length(parts, 1) = 1 then
    return parts[1];
  end if;
  -- the family name's first capitalised word (skips particles such as "de", "van")
  for i in 2 .. array_length(parts, 1) loop
    if left(parts[i], 1) <> lower(left(parts[i], 1)) then
      return parts[1] || ' ' || upper(left(parts[i], 1)) || '.';
    end if;
  end loop;
  return parts[1] || ' ' || upper(left(parts[array_length(parts, 1)], 1)) || '.';
end;
$$;

-- Everything the Recos map shows: the visible places and, for each, its visible comments, with the
-- author shown as "First L." and the club's name. Never emails or phones.
create or replace function public.reco_feed()
returns table (
  place_id      uuid,
  place_name    text,
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
  from public.reco_places p
  left join public.reco_comments c
    on c.place_id = p.id and public.can_see_reco_comment(c.visibility, c.club_id, c.profile_id)
  left join public.profiles pr on pr.id = c.profile_id
  left join public.clubs cl on cl.id = c.club_id
  where public.has_any_access()
    and public.can_see_reco_place(p.id)
  order by p.name, c.created_at desc nulls last;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

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
    new.place_id := old.place_id;
    new.profile_id := old.profile_id;
    new.club_id := old.club_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists reco_comments_before_write on public.reco_comments;
create trigger reco_comments_before_write
  before insert or update on public.reco_comments
  for each row execute function public.reco_comments_before_write();

-- Deleting the last comment on a place deletes the place.
create or replace function public.reco_comments_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.reco_places p
  where p.id = old.place_id
    and not exists (select 1 from public.reco_comments c where c.place_id = old.place_id);
  return old;
end;
$$;

drop trigger if exists reco_comments_after_delete on public.reco_comments;
create trigger reco_comments_after_delete
  after delete on public.reco_comments
  for each row execute function public.reco_comments_after_delete();

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------

drop policy if exists "people see reco places they can see"    on public.reco_places;
drop policy if exists "people see reco comments they can see"  on public.reco_comments;
drop policy if exists "authors edit their own reco comments"   on public.reco_comments;
drop policy if exists "authors, club admins and super admins delete reco comments" on public.reco_comments;

create policy "people see reco places they can see" on public.reco_places
  for select to authenticated
  using (public.can_see_reco_place(id));

create policy "people see reco comments they can see" on public.reco_comments
  for select to authenticated
  using (public.can_see_reco_comment(visibility, club_id, profile_id));

create policy "authors edit their own reco comments" on public.reco_comments
  for update to authenticated
  using (profile_id = (select public.current_profile_id()))
  with check (profile_id = (select public.current_profile_id()));

create policy "authors, club admins and super admins delete reco comments" on public.reco_comments
  for delete to authenticated
  using (
    profile_id = (select public.current_profile_id())
    or public.is_admin(club_id)
    or (select public.is_super_admin())
  );

revoke all on table public.reco_places, public.reco_comments from public, anon, authenticated;
-- places: never who created them or when (that would reveal a place's history)
grant select (id, name, address, lat, lng, external_id) on table public.reco_places to authenticated;
grant select (id, place_id, club_id, body, visibility, created_at, updated_at) on table public.reco_comments to authenticated;
grant update (body, visibility) on table public.reco_comments to authenticated;
grant delete on table public.reco_comments to authenticated;
-- new places and comments only through add_reco()

revoke execute on function public.can_see_reco_comment(text, integer, uuid)          from public, anon;
revoke execute on function public.can_see_reco_place(uuid)                           from public, anon;
revoke execute on function public.reco_name_key(text)                                from public, anon, authenticated;
revoke execute on function public.reco_distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.reco_place_matches(public.reco_places, text, double precision, double precision, text) from public, anon, authenticated;
revoke execute on function public.reco_author_label(text)                            from public, anon, authenticated;
revoke execute on function public.find_reco_place(text, double precision, double precision, text) from public, anon;
revoke execute on function public.add_reco(integer, text, text, double precision, double precision, text, text, text, uuid) from public, anon;
revoke execute on function public.reco_feed()                                        from public, anon;
revoke execute on function public.reco_comments_before_write()                       from public, anon, authenticated;
revoke execute on function public.reco_comments_after_delete()                       from public, anon, authenticated;

grant execute on function public.can_see_reco_comment(text, integer, uuid)          to authenticated;
grant execute on function public.can_see_reco_place(uuid)                           to authenticated;
grant execute on function public.find_reco_place(text, double precision, double precision, text) to authenticated;
grant execute on function public.add_reco(integer, text, text, double precision, double precision, text, text, text, uuid) to authenticated;
grant execute on function public.reco_feed()                                        to authenticated;

commit;

notify pgrst, 'reload schema';
