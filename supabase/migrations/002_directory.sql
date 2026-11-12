-- The Nines: STEP 2 changes only (member directory, profiles, headshots).
--
-- Run this ONCE in the Supabase SQL Editor on a project that already has step 1.
-- It is also safe to run again. (supabase/schema.sql is the full schema for a brand-new project
-- and already contains everything below.)
--
-- What it changes:
--   1. members: ordinary members can now read only their OWN row (it holds their email).
--      Admins still read all rows. Other members' details come through directory().
--   2. New profiles table, directory() function, and a private "headshots" storage bucket.

-- ---------------------------------------------------------------------------
-- 1. Tighten who can read the members table
-- ---------------------------------------------------------------------------

drop policy if exists "members read members" on public.members;  -- step 1 policy being replaced
drop policy if exists "members read own row, admins read all" on public.members;

create policy "members read own row, admins read all" on public.members
  for select to authenticated
  using (
    ((select public.is_member()) and id = (select auth.uid()))
    or (select public.is_admin())
  );

-- ===========================================================================
-- STEP 2: member directory, profiles and headshots
-- ===========================================================================

-- A display name must not be blank (step 1 only checked the length).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'members_display_name_not_blank') then
    alter table public.members
      add constraint members_display_name_not_blank check (display_name is null or btrim(display_name) <> '');
  end if;
end;
$$;

-- One row per member, created the first time they save their profile.
-- No row yet = "has not filled in a profile" (the member home shows a prompt).
create table if not exists public.profiles (
  member_id   uuid primary key references public.members (id) on delete cascade,
  bio         text,
  phone       text,
  show_email  boolean not null default false,
  show_phone  boolean not null default false,
  photo_path  text,
  listed      boolean not null default true,
  updated_on  timestamptz default now(),
  constraint profiles_bio_length   check (bio is null or char_length(bio) <= 500),
  constraint profiles_phone_shape  check (phone is null or phone ~ '^[0-9+() .-]{5,30}$'),
  -- a member's photo can only live in their own folder
  constraint profiles_photo_path   check (photo_path is null or photo_path = member_id::text || '/avatar.jpg')
);

alter table public.profiles enable row level security;

-- Tidies values, stamps updated_on, and stops non-admins changing "listed" (silently kept as it was).
-- In the SQL editor auth.uid() is null, so the office can still change anything there.
create or replace function public.profiles_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.bio := nullif(btrim(new.bio), '');
  new.phone := nullif(btrim(new.phone), '');
  new.updated_on := now();
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.listed := true;
    else
      new.listed := old.listed;
      new.member_id := old.member_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_before_write on public.profiles;
create trigger profiles_before_write
  before insert or update on public.profiles
  for each row execute function public.profiles_before_write();

drop policy if exists "members read own profile, admins read all"   on public.profiles;
drop policy if exists "members add own profile, admins add any"     on public.profiles;
drop policy if exists "members update own profile, admins update any" on public.profiles;

create policy "members read own profile, admins read all" on public.profiles
  for select to authenticated
  using (
    ((select public.is_member()) and member_id = (select auth.uid()))
    or (select public.is_admin())
  );

create policy "members add own profile, admins add any" on public.profiles
  for insert to authenticated
  with check (
    ((select public.is_member()) and member_id = (select auth.uid()))
    or (select public.is_admin())
  );

create policy "members update own profile, admins update any" on public.profiles
  for update to authenticated
  using (
    ((select public.is_member()) and member_id = (select auth.uid()))
    or (select public.is_admin())
  )
  with check (
    ((select public.is_member()) and member_id = (select auth.uid()))
    or (select public.is_admin())
  );

-- The directory. Listed members only; email and phone ONLY where the member turned the flag on.
-- Returns nothing at all to callers who are not members.
create or replace function public.directory()
returns table (
  member_id    uuid,
  display_name text,
  bio          text,
  photo_path   text,
  email        text,
  phone        text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.display_name,
    p.bio,
    p.photo_path,
    case when p.show_email then lower(m.email) end,
    case when p.show_phone then p.phone end
  from public.members m
  join public.allowed_emails a on a.email = lower(m.email)
  left join public.profiles p on p.member_id = m.id
  where public.is_member()
    and coalesce(p.listed, true)
  order by lower(coalesce(m.display_name, m.email));
$$;

-- Privileges for step 2
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant insert (member_id, bio, phone, show_email, show_phone, photo_path, listed) on table public.profiles to authenticated;
grant update (bio, phone, show_email, show_phone, photo_path, listed)            on table public.profiles to authenticated;

revoke execute on function public.directory()             from public, anon;
revoke execute on function public.profiles_before_write() from public, anon, authenticated;
grant  execute on function public.directory()             to authenticated;

-- ---------------------------------------------------------------------------
-- Headshots: a PRIVATE storage bucket. Files live at <member id>/avatar.jpg.
-- The site shows them through signed links that expire after an hour.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('headshots', 'headshots', false, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "headshots: members view"                 on storage.objects;
drop policy if exists "headshots: upload own, admins any"       on storage.objects;
drop policy if exists "headshots: replace own, admins any"      on storage.objects;
drop policy if exists "headshots: delete own, admins any"       on storage.objects;

create policy "headshots: members view" on storage.objects
  for select to authenticated
  using (bucket_id = 'headshots' and (select public.is_member()));

create policy "headshots: upload own, admins any" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'headshots'
    and (
      ((select public.is_member()) and name = (select auth.uid())::text || '/avatar.jpg')
      or ((select public.is_admin()) and name ~ '^[0-9a-f-]{36}/avatar\.jpg$')
    )
  );

create policy "headshots: replace own, admins any" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'headshots'
    and (
      ((select public.is_member()) and name = (select auth.uid())::text || '/avatar.jpg')
      or (select public.is_admin())
    )
  )
  with check (
    bucket_id = 'headshots'
    and (
      ((select public.is_member()) and name = (select auth.uid())::text || '/avatar.jpg')
      or ((select public.is_admin()) and name ~ '^[0-9a-f-]{36}/avatar\.jpg$')
    )
  );

create policy "headshots: delete own, admins any" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'headshots'
    and (
      ((select public.is_member()) and name = (select auth.uid())::text || '/avatar.jpg')
      or (select public.is_admin())
    )
  );

-- Make the site's API see the changes straight away.
notify pgrst, 'reload schema';
