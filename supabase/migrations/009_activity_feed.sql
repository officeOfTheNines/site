-- ===========================================================================
-- STEP 9: activity feed (home page) and the "My clubs | All clubs" scope (home + Recos map)
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 008. Safe to run again. Only adds functions and indexes:
-- no new tables, no data changes, and the existing Recos functions and permissions are untouched.
--
-- The feed is derived from reco_comments (no events table):
--   reco_added    = the first comment on a restaurant that the viewer can see
--   comment_added = a later comment on a restaurant
-- Edits do not create events (only created_at is used). Deleting a comment removes its event.
--
-- activity_feed() is SECURITY INVOKER, so the existing row-level security on reco_comments and
-- reco_places still decides what the viewer can read; on top of that it enforces:
--   * never the viewer's own events;
--   * "Only me" comments never shown to others (not even to super admins, who see them on the map
--     for moderation); "My club" comments only to members of that club;
--   * my_clubs:  events by members of any club the viewer belongs to;
--     all_clubs: also "Everyone" comments by members of any club.
-- Never emails or phones: authors appear as "First L." with the club they posted as.

begin;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists reco_comments_created_idx       on public.reco_comments (created_at desc, id desc);
create index if not exists reco_comments_place_created_idx on public.reco_comments (place_id, created_at, id);
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
  place_id     uuid,         -- the reco (restaurant) to open on the map
  place_name   text,
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
      where e.place_id = c.place_id and (e.created_at, e.id) < (c.created_at, c.id)
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
  join public.reco_places p on p.id = c.place_id
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
  place_id     uuid,
  place_name   text,
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
      where e.place_id = c.place_id and (e.created_at, e.id) < (c.created_at, c.id)
        and public.can_see_reco_comment(e.visibility, e.club_id, e.profile_id)
    ) then 'comment_added' else 'reco_added' end,
    c.created_at, c.id, p.id, p.name, public.reco_area(p.address), cl.name, c.visibility,
    null::smallint, null::smallint,
    case when char_length(c.body) > 140 then rtrim(left(c.body, 139)) || '…' else c.body end,
    null::text
  from public.reco_comments c
  join public.reco_places p on p.id = c.place_id
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
create or replace function public.reco_scope_place_ids(p_scope text default 'my_clubs')
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
  select distinct c.place_id
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
revoke execute on function public.reco_scope_place_ids(text)                        from public, anon;
grant execute on function public.reco_comment_facts(uuid)                           to authenticated;
grant execute on function public.reco_area(text)                                    to authenticated;
grant execute on function public.activity_feed(text, integer, timestamptz)          to authenticated;
grant execute on function public.my_reco_activity(integer, timestamptz)             to authenticated;
grant execute on function public.reco_scope_place_ids(text)                         to authenticated;

commit;

notify pgrst, 'reload schema';
