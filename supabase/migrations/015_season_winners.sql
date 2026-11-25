-- ===========================================================================
-- STEP 15: season winners on the member map's Dinners view
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 014. Safe to run again. Replaces one function; no table or
-- data changes.
--
-- club_dinner_map(club) also returns, per dinner:
--   season_number           the season as a number: "S3" -> 3; "2018/2019" -> years since the club's first
--                           such season + 1 (Les Ronds: 2016/2017 -> 1, 2018/2019 -> 3); otherwise the season's
--                           order in the club. A dinner without a season counts in September-August of its date.
--   season_winner_overall   true for the dinner(s) with the highest score of the season in that category,
--   season_winner_food      within the club. Overall = 0.5 x food + 0.25 x wine + 0.25 x vibe, as on the
--   season_winner_wine      public dinner map (exact value, not the rounded one). Ties: every tied dinner is
--   season_winner_vibe      a winner. A dinner without a score in that category cannot win.
-- The page shows the flag of the category selected (Overall, Food, Wine or Vibe).

begin;

drop function if exists public.club_dinner_map(integer);
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
  overall       numeric,        -- as on the dinner maps: (2 x food + wine + vibe) / 4, needs all three
  menu_url      text,           -- an https link, or a path in the private menus bucket
  rating_scale  smallint,       -- the club's scale: 10 for The Nines, 20 for Les Ronds
  source_ref    text,           -- the dinner's id from the old sheets, e.g. 'nines:#1.2' (null for new dinners)
  season_number integer,        -- e.g. 3 for "S3"
  season_winner_overall boolean,
  season_winner_food    boolean,
  season_winner_wine    boolean,
  season_winner_vibe    boolean
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
  with ev as (            -- every dinner of the club, with its season (or September-August of its date)
    select e.*,
           coalesce(e.season,
                    case when extract(month from e.event_date) >= 9
                         then extract(year from e.event_date)::int || '/' || (extract(year from e.event_date)::int + 1)
                         else (extract(year from e.event_date)::int - 1) || '/' || extract(year from e.event_date)::int end) as season_key,
           0.5 * e.rating_food + 0.25 * e.rating_wine + 0.25 * e.rating_vibe as score_overall
    from public.club_events e
    where e.club_id = p_club
  ),
  seasons as (
    select ev.season_key, min(ev.event_date) as starts from ev group by ev.season_key
  ),
  numbered as (
    select s.season_key,
           case when s.season_key ~ '^S[0-9]+$' then substr(s.season_key, 2)::int
                when s.season_key ~ '^[0-9]{4}/[0-9]{4}$'
                  then left(s.season_key, 4)::int
                       - (select min(left(x.season_key, 4)::int) from seasons x where x.season_key ~ '^[0-9]{4}/[0-9]{4}$') + 1
                else (dense_rank() over (order by s.starts))::int end as num
    from seasons s
  ),
  best as (               -- the season's top score per category (nulls ignored: a dinner without a score cannot win)
    select ev.season_key, max(ev.score_overall) as top_overall, max(ev.rating_food) as top_food,
           max(ev.rating_wine) as top_wine, max(ev.rating_vibe) as top_vibe
    from ev group by ev.season_key
  )
  select ev.id, v.id, v.name, v.address, v.lat, v.lng, ev.event_date, ev.season, ev.month,
         case when jsonb_array_length(ev.brigadiers) > 0 or ev.brigadier_group_id is null then ev.brigadiers
              else coalesce((select jsonb_agg(p.display_name order by p.display_name)
                             from public.brigadier_group_members m join public.profiles p on p.id = m.profile_id
                             where m.group_id = ev.brigadier_group_id), '[]'::jsonb) end,
         ev.rating_food, ev.rating_wine, ev.rating_vibe,
         round((2 * ev.rating_food + ev.rating_wine + ev.rating_vibe) / 4, 2),   -- null unless all three are set
         ev.menu_url, c.rating_scale, ev.source_ref,
         n.num,
         coalesce(ev.score_overall = b.top_overall, false),
         coalesce(ev.rating_food = b.top_food, false),
         coalesce(ev.rating_wine = b.top_wine, false),
         coalesce(ev.rating_vibe = b.top_vibe, false)
  from ev
  join public.venues v on v.id = ev.venue_id
  join public.clubs c on c.id = ev.club_id
  join numbered n on n.season_key = ev.season_key
  join best b on b.season_key = ev.season_key
  where not (ev.event_date > today and ev.rsvp_status = 'not_open')
  order by ev.event_date desc, ev.created_at desc;
end;
$$;

revoke execute on function public.club_dinner_map(integer) from public, anon;
grant execute on function public.club_dinner_map(integer) to authenticated;

commit;

notify pgrst, 'reload schema';
