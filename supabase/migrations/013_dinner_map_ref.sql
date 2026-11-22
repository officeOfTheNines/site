-- ===========================================================================
-- STEP 13: the dinner's number on the Recos map's Events cards
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 012. Safe to run again. Only replaces one function:
-- club_dinner_map() also returns source_ref (the dinner's id from the old sheets, e.g. 'nines:#1.2'),
-- shown as "#1.2" on the card, as on the dinner maps. No table or data changes.

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
  source_ref    text            -- the dinner's id from the old sheets, e.g. 'nines:#1.2' (null for new dinners)
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
         round((2 * e.rating_food + e.rating_wine + e.rating_vibe) / 4, 2),   -- null unless all three are set
         e.menu_url, c.rating_scale, e.source_ref
  from public.club_events e
  join public.venues v on v.id = e.venue_id
  join public.clubs c on c.id = e.club_id
  where e.club_id = p_club
    and not (e.event_date > today and e.rsvp_status = 'not_open')
  order by e.event_date desc, e.created_at desc;
end;
$$;

revoke execute on function public.club_dinner_map(integer) from public, anon;
grant execute on function public.club_dinner_map(integer) to authenticated;

commit;

notify pgrst, 'reload schema';
