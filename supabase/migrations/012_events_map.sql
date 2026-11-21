-- ===========================================================================
-- STEP 12: club dinners on the Recos map ("Events"), and the feed following the current club
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 011. Safe to run again. Only adds or replaces functions:
-- no table or data changes.
--
--   club_dinner_map(club)   the club's dinners for the map, one row per dinner, for members of that club
--                           only (venues and club_events stay unreadable directly). Dinners still to come
--                           whose replies are not open yet are left out; so are dinners without a venue.
--   activity_feed(...)      gets an optional p_club: with it, "My clubs" shows recos by members of that
--                           one club (the member's current club). Without it, as before.

begin;

-- ---------------------------------------------------------------------------
-- The club's dinners for the map
-- ---------------------------------------------------------------------------
create or replace function public.club_dinner_map(p_club integer)
returns table (
  event_id      uuid,
  venue_id      uuid,
  venue_name    text,
  address       text,
  lat           double precision,
  lng           double precision,
  event_date    date,
  season        text,
  month         text,
  brigadiers    jsonb,          -- display names: as stored on the dinner, else the brigadier group's members
  rating_food   numeric,        -- the dinner maps' "plate"
  rating_wine   numeric,        -- "bottles"
  rating_vibe   numeric,        -- "atmosphere"
  overall       numeric,        -- average of the ratings present (null when none)
  menu_url      text,           -- an https link, or a path in the private menus bucket
  rating_scale  smallint        -- the club's scale: 10 for The Nines, 20 for Les Ronds
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  today date;
begin
  if not public.is_member(p_club) then
    return;   -- not a member of that club (club_access): nothing
  end if;
  select (now() at time zone c.timezone)::date into today from public.clubs c where c.id = p_club;
  return query
  select e.id, v.id, v.name, v.address, v.lat, v.lng, e.event_date, e.season, e.month,
         case when jsonb_array_length(e.brigadiers) > 0 or e.brigadier_group_id is null then e.brigadiers
              else coalesce((select jsonb_agg(p.display_name order by p.display_name)
                             from public.brigadier_group_members m join public.profiles p on p.id = m.profile_id
                             where m.group_id = e.brigadier_group_id), '[]'::jsonb) end,
         e.rating_food, e.rating_wine, e.rating_vibe,
         round((coalesce(e.rating_food, 0) + coalesce(e.rating_wine, 0) + coalesce(e.rating_vibe, 0))
               / nullif((e.rating_food is not null)::int + (e.rating_wine is not null)::int + (e.rating_vibe is not null)::int, 0), 2),
         e.menu_url, c.rating_scale
  from public.club_events e
  join public.venues v on v.id = e.venue_id
  join public.clubs c on c.id = e.club_id
  where e.club_id = p_club
    and not (e.event_date > today and e.rsvp_status = 'not_open')
  order by e.event_date desc, e.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Feed: "My clubs" can follow the member's current club
-- ---------------------------------------------------------------------------

-- Is the author of this comment (which the caller can see) a member of that club?
create or replace function public.reco_comment_author_in_club(p_comment uuid, p_club integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reco_comments c
    join public.profiles pr on pr.id = c.profile_id
    join public.club_access a on a.email = pr.email and a.club_id = p_club
    where c.id = p_comment
      and public.can_see_reco_comment(c.visibility, c.club_id, c.profile_id)
  );
$$;

drop function if exists public.activity_feed(text, integer, timestamptz);
create or replace function public.activity_feed(
  p_scope  text        default 'my_clubs',
  p_limit  integer     default 20,
  p_before timestamptz default null,
  p_club   integer     default null   -- the member's current club: "My clubs" = members of this club
)
returns table (
  event_type   text,
  created_at   timestamptz,
  comment_id   uuid,
  venue_id     uuid,
  venue_name   text,
  area         text,
  author_label text,
  club_name    text,
  stars        smallint,
  price_level  smallint,
  snippet      text,
  image_path   text
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
  if p_club is not null and not public.is_member(p_club) then
    return;
  end if;
  return query
  select
    case when exists (
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
    and (case when p_club is null then f.shares_club else public.reco_comment_author_in_club(c.id, p_club) end
         or (p_scope = 'all_clubs' and c.visibility = 'everyone'))
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke execute on function public.club_dinner_map(integer)                          from public, anon;
revoke execute on function public.reco_comment_author_in_club(uuid, integer)        from public, anon;
revoke execute on function public.activity_feed(text, integer, timestamptz, integer) from public, anon;
grant execute on function public.club_dinner_map(integer)                           to authenticated;
grant execute on function public.reco_comment_author_in_club(uuid, integer)         to authenticated;
grant execute on function public.activity_feed(text, integer, timestamptz, integer)  to authenticated;

commit;

notify pgrst, 'reload schema';
