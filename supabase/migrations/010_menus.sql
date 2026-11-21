-- ===========================================================================
-- STEP 10: dinner menus in private storage
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 009. Safe to run again. Only adds things.
--
-- Menus (mostly PDFs, sometimes a photo) move from Google Drive into a PRIVATE storage bucket,
-- "menus", one folder per club: menus/<club slug>/<file>, for example menus/nines/1.1.pdf.
-- club_events.menu_url holds that path (it still accepts an https link too).
-- Only members of that club (and super admins) can open a club's menus, through links that expire;
-- nobody uploads from the site: the office loads menus with the import tools.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menus', 'menus', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 'nines/1.1.pdf' -> the club whose slug is the first folder (null if none, never an error).
create or replace function public.menu_club_from_path(p_path text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.clubs c
  where p_path ~ '^[a-z0-9-]+/[A-Za-z0-9._-]+$' and c.slug = split_part(p_path, '/', 1);
$$;

drop policy if exists "menus: club members view" on storage.objects;
create policy "menus: club members view" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'menus'
    and ((select public.is_super_admin()) or public.is_member(public.menu_club_from_path(name)))
  );

-- menu_url: an https link, or a path in the menus bucket ("menus/<club slug>/<file>")
alter table public.club_events drop constraint if exists club_events_menu_url;
alter table public.club_events add constraint club_events_menu_url check (
  menu_url is null
  or menu_url ~ '^https://'
  or menu_url ~ '^menus/[a-z0-9-]+/[A-Za-z0-9._-]+\.(pdf|jpe?g|png|webp|heic)$');

revoke execute on function public.menu_club_from_path(text) from public, anon;
grant execute on function public.menu_club_from_path(text) to authenticated;

commit;

notify pgrst, 'reload schema';
