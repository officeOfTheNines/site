-- ===========================================================================
-- STEP 15: a map home per club (centre and default zoom of the member map)
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 014. Safe to run again. Adds three columns to clubs
-- and fills them only where they are still empty, so values you adjust later are never overwritten.
-- No member data is read or changed.
--
-- The member map (Recos / Dinners) opens on, and returns to, the current club's home:
--   map_center_lat, map_center_lng  degrees (WGS84)
--   map_default_zoom                Leaflet zoom level, 1 (world) to 19 (street)
-- clubs is already readable by signed-in members, so the page reads these with the club row.

begin;

alter table public.clubs add column if not exists map_center_lat   double precision;
alter table public.clubs add column if not exists map_center_lng   double precision;
alter table public.clubs add column if not exists map_default_zoom smallint;

alter table public.clubs drop constraint if exists clubs_map_home;
alter table public.clubs add constraint clubs_map_home check (
  (map_center_lat is null or map_center_lat between -90 and 90)
  and (map_center_lng is null or map_center_lng between -180 and 180)
  and (map_default_zoom is null or map_default_zoom between 1 and 19));

update public.clubs set map_center_lat = 51.5074, map_center_lng = -0.1278, map_default_zoom = 12
where id = 1 and map_center_lat is null and map_center_lng is null and map_default_zoom is null;   -- The Nines: central London
update public.clubs set map_center_lat = 48.8566, map_center_lng = 2.3522, map_default_zoom = 12
where id = 2 and map_center_lat is null and map_center_lng is null and map_default_zoom is null;   -- Les Ronds: central Paris

commit;

notify pgrst, 'reload schema';
