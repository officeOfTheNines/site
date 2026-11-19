-- ===========================================================================
-- STEP 8: a different photo per club (optional)
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 007. Safe to run again. Only adds things: no photo,
-- profile or card changes.
--
-- Everyone keeps their main photo (profiles.photo_path, file <profile id>/avatar.jpg). A club card can
-- now also have its own photo (club_profiles.override_photo_path, file <profile id>/club-<club id>.jpg),
-- shown in that club's directory instead of the main one. When it is empty, the main photo is shown.
--
-- On the profile page, a new photo (or "Remove photo") saved from club X changes the main photo AND
-- club X's photo (its own photo is cleared, so it shows the main one). Other clubs' own photos stay.
-- Club photos are set in bulk by the office (SQL plus files uploaded to the headshots bucket).

begin;

alter table public.club_profiles add column if not exists override_photo_path text;

alter table public.club_profiles drop constraint if exists club_profiles_override_photo_path;
alter table public.club_profiles add constraint club_profiles_override_photo_path
  check (override_photo_path is null
         or override_photo_path = profile_id::text || '/club-' || club_id::text || '.jpg');

-- Storage paths: '<profile id>/avatar.jpg' or '<profile id>/club-<n>.jpg' -> the profile id;
-- anything else -> null (never an error). The headshots upload, replace and delete rules use this,
-- so club photos follow the same rules as main photos: the person, or an admin of one of their clubs.
create or replace function public.profile_id_from_path(p_path text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(avatar|club-[0-9]{1,9})\.jpg$'
      then split_part(p_path, '/', 1)::uuid
  end;
$$;

-- A club's directory: as before, but photo_path is the card's own photo for this club when it has
-- one, otherwise the person's main photo.
create or replace function public.directory(p_club integer)
returns table (
  profile_id     uuid,
  display_name   text,
  bio            text,
  photo_path     text,
  email          text,
  phone          text,
  former_member  boolean,
  foreign_member boolean,
  co_brigadiers  text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.display_name,
    cp.bio,
    coalesce(cp.override_photo_path, p.photo_path),
    case when cp.show_email or public.is_admin(p_club) then p.email end,
    case when cp.show_phone or public.is_admin(p_club) then p.phone end,
    not exists (select 1 from public.club_access a where a.club_id = p_club and a.email = p.email),
    cp.foreign_member,
    public.co_brigadier_names(p_club, p.id)
  from public.club_profiles cp
  join public.profiles p on p.id = cp.profile_id
  where public.is_member(p_club)
    and cp.club_id = p_club
    and cp.listed
  order by lower(p.display_name);
$$;

-- The profile page clears a club's own photo when a new main photo is saved from that club.
grant update (override_photo_path) on table public.club_profiles to authenticated;

commit;

notify pgrst, 'reload schema';
