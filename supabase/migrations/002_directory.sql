-- ===========================================================================
-- STEP 2: member directory, profiles and headshots
-- ===========================================================================
--
-- To upgrade a project that already has step 1: run this file once in the Supabase SQL Editor.
-- It never deletes allowlist entries or members you added, and it is safe to run again.
-- (supabase/schema.sql = step 1 followed by this same section, for brand-new projects.)
--
-- Concepts:
--   allowed_emails = who may get in (access).            Unchanged from step 1.
--   members        = one row per login (sign-in record). Unchanged from step 1, except that
--                    removing someone's access no longer deletes their row.
--   profiles       = the directory card. One per email (unique, lowercase). An admin can create it
--                    before the person ever signs in. member_id stays empty until that person first
--                    signs in with a CONFIRMED matching email (any login method), then links to them.
--
-- Rules:
--   * Access always comes from allowed_emails. Removing an email blocks access at once but never
--     deletes the profile; deleting a profile is a separate admin action.
--   * Whether a card appears in the directory depends only on profiles.listed, which only admins
--     change. A card whose email is no longer on the list is marked "former member".
--   * profiles.foreign_member (admins only) marks people who moved abroad: still members, still see the
--     directory, shown with a "Foreign member" label, and to be left out of club emails when the site
--     starts sending them.
--   * Members read and edit only their own profile; admins manage all. Email and phone appear in the
--     directory only where that person turned show_email / show_phone on (both off by default).

-- Safety check: stop if an earlier draft of this step (with a different profiles table) was run.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'profiles')
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'profiles' and column_name = 'email') then
    raise exception 'An earlier draft of the step 2 SQL was run on this project. Nothing was changed. Ask for the clean-up script before running this file.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- members: keep the sign-in record when access is removed; members see only their own row
-- ---------------------------------------------------------------------------

drop trigger if exists allowed_emails_after_delete on public.allowed_emails;
drop function if exists public.allowed_emails_after_delete();

drop policy if exists "members read members"                  on public.members;  -- step 1
drop policy if exists "members read own row, admins read all" on public.members;

create policy "members read own row, admins read all" on public.members
  for select to authenticated
  using (
    ((select public.is_member()) and id = (select auth.uid()))
    or (select public.is_admin())
  );

-- ---------------------------------------------------------------------------
-- profiles: the directory card
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  member_id          uuid references public.members (id) on delete set null,
  display_name       text not null,
  bio                text,
  phone              text,
  show_email         boolean not null default false,
  show_phone         boolean not null default false,
  photo_path         text,
  listed             boolean not null default true,
  foreign_member     boolean not null default false,
  created_on         timestamptz not null default now(),
  updated_on         timestamptz not null default now(),
  member_updated_on  timestamptz,  -- last time the person saved their own profile (null = prompt them)
  constraint profiles_email_key          unique (email),
  constraint profiles_member_id_key      unique (member_id),
  constraint profiles_email_lower        check (email = lower(btrim(email))),
  constraint profiles_email_shape        check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint profiles_display_name_shape check (btrim(display_name) <> '' and char_length(display_name) <= 80),
  constraint profiles_bio_length         check (bio is null or char_length(bio) <= 500),
  constraint profiles_phone_shape        check (phone is null or phone ~ '^[0-9+() .-]{5,30}$'),
  -- a photo can only live in the profile's own folder
  constraint profiles_photo_path         check (photo_path is null or photo_path = id::text || '/avatar.jpg')
);

alter table public.profiles enable row level security;

-- The signed-in person's profile id, or null. Only for people who currently have access.
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.member_id = auth.uid()
    and public.is_member();
$$;

-- Tidies values. For edits made directly from the site by non-admins (current_user is
-- 'authenticated'), keeps email, member_id and listed as they were. The database's own functions
-- (sign-in linking, admin actions) and the SQL editor are not limited by this.
-- Records when a person saves their own, already linked profile.
-- Runs with the caller's rights (not security definer) so current_user tells these cases apart.
create or replace function public.profiles_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  new.display_name := btrim(new.display_name);
  new.bio := nullif(btrim(new.bio), '');
  new.phone := nullif(btrim(new.phone), '');
  new.updated_on := now();
  if tg_op = 'INSERT' then
    new.created_on := now();
    new.member_updated_on := null;
  else
    if current_user = 'authenticated' and not public.is_admin() then
      new.email := old.email;
      new.member_id := old.member_id;
      new.listed := old.listed;
      new.foreign_member := old.foreign_member;
      new.created_on := old.created_on;
    end if;
    if auth.uid() is not null and old.member_id = auth.uid() then
      new.member_updated_on := now();
    else
      new.member_updated_on := old.member_updated_on;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_before_write on public.profiles;
create trigger profiles_before_write
  before insert or update on public.profiles
  for each row execute function public.profiles_before_write();

drop policy if exists "members read own profile, admins read all"     on public.profiles;
drop policy if exists "admins add profiles"                           on public.profiles;
drop policy if exists "members update own profile, admins update any" on public.profiles;
drop policy if exists "admins delete profiles"                        on public.profiles;

create policy "members read own profile, admins read all" on public.profiles
  for select to authenticated
  using (id = (select public.current_profile_id()) or (select public.is_admin()));

create policy "admins add profiles" on public.profiles
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "members update own profile, admins update any" on public.profiles
  for update to authenticated
  using (id = (select public.current_profile_id()) or (select public.is_admin()))
  with check (id = (select public.current_profile_id()) or (select public.is_admin()));

create policy "admins delete profiles" on public.profiles
  for delete to authenticated
  using ((select public.is_admin()));

revoke all on table public.profiles from public, anon, authenticated;
grant select, delete on table public.profiles to authenticated;
grant insert (email, display_name, bio, phone, show_email, show_phone, photo_path, listed, foreign_member)
  on table public.profiles to authenticated;
grant update (display_name, bio, phone, show_email, show_phone, photo_path, listed, foreign_member)
  on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Sign-in: link or create the caller's profile (called by the site after every sign-in)
-- ---------------------------------------------------------------------------

-- For an allowed, confirmed caller:
--   1. creates or refreshes their members row (as in step 1);
--   2. if no profile is linked to them yet, links the profile with their email (whatever login
--      method they used: Google and password sign-ins with the same email land on the same profile);
--   3. if there is no profile for their email at all, creates a blank one.
-- Does nothing for people not on the list.
create or replace function public.claim_membership()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  u auth.users%rowtype;
  my_email text;
  default_name text;
begin
  if not public.is_member() then
    return;
  end if;

  select * into u from auth.users where id = auth.uid();
  my_email := lower(btrim(u.email));
  default_name := left(btrim(coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    split_part(my_email, '@', 1)
  )), 80);

  insert into public.members (id, email, display_name, last_login)
  values (u.id, my_email, default_name, now())
  on conflict (id) do update
    set email      = excluded.email,
        last_login = excluded.last_login,
        display_name = coalesce(public.members.display_name, excluded.display_name);

  if exists (select 1 from public.profiles where member_id = u.id) then
    return;
  end if;

  update public.profiles set member_id = u.id
    where email = my_email and member_id is null;
  if found then
    return;
  end if;

  insert into public.profiles (email, member_id, display_name)
  values (my_email, u.id, default_name)
  on conflict (email) do nothing;  -- a profile for this email is linked to another login: leave it
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin actions that must happen together
-- ---------------------------------------------------------------------------

-- Add a member: puts the email on the list AND creates their profile, in one step.
-- If the email is already on the list, its role is left as it is. If a profile already exists
-- for the email (for example someone whose access was removed), it is kept as it is, apart from
-- "listed", which is set as asked. Returns the profile id.
create or replace function public.admin_add_member(
  p_email text,
  p_display_name text,
  p_role text default 'member',
  p_listed boolean default true,
  p_foreign boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e text := lower(btrim(p_email));
  pid uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can add members.' using errcode = '42501';
  end if;
  if p_role not in ('member', 'admin') then
    raise exception 'Role must be member or admin.' using errcode = '22023';
  end if;

  insert into public.allowed_emails (email, role) values (e, p_role)
  on conflict (email) do nothing;

  select id into pid from public.profiles where email = e;
  if pid is not null then
    update public.profiles set listed = coalesce(p_listed, true) where id = pid;
    return pid;
  end if;

  insert into public.profiles (email, display_name, listed, foreign_member, member_id)
  values (e, p_display_name, coalesce(p_listed, true), coalesce(p_foreign, false),
          (select m.id from public.members m
            where lower(m.email) = e
              and not exists (select 1 from public.profiles x where x.member_id = m.id)))
  returning id into pid;

  return pid;
end;
$$;

-- Remove access: takes the email off the list (the step 1 rules still apply: not yourself, never
-- the last admin) and, if asked, hides their card. Never deletes the profile.
create or replace function public.admin_remove_access(p_email text, p_hide boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e text := lower(btrim(p_email));
begin
  if not public.is_admin() then
    raise exception 'Only admins can remove access.' using errcode = '42501';
  end if;
  delete from public.allowed_emails where email = e;
  if not found then
    raise exception 'That email is not on the list.' using errcode = 'P0002';
  end if;
  if p_hide then
    update public.profiles set listed = false where email = e;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The directory: listed cards only; email and phone ONLY where the person turned them on.
-- former_member = their email is no longer on the list; foreign_member = moved abroad.
-- Returns nothing to non-members.
-- ---------------------------------------------------------------------------

drop function if exists public.directory();
create function public.directory()
returns table (
  profile_id    uuid,
  display_name  text,
  bio           text,
  photo_path    text,
  email         text,
  phone          text,
  former_member  boolean,
  foreign_member boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.display_name,
    p.bio,
    p.photo_path,
    case when p.show_email then p.email end,
    case when p.show_phone then p.phone end,
    a.email is null,
    p.foreign_member
  from public.profiles p
  left join public.allowed_emails a on a.email = p.email
  where public.is_member()
    and p.listed
  order by lower(p.display_name);
$$;

revoke execute on function public.directory()                               from public, anon;
revoke execute on function public.current_profile_id()                      from public, anon;
revoke execute on function public.claim_membership()                        from public, anon;
revoke execute on function public.admin_add_member(text, text, text, boolean, boolean) from public, anon;
revoke execute on function public.admin_remove_access(text, boolean)        from public, anon;
revoke execute on function public.profiles_before_write()                   from public, anon, authenticated;
grant  execute on function public.directory()                               to authenticated;
grant  execute on function public.current_profile_id()                      to authenticated;
grant  execute on function public.claim_membership()                        to authenticated;
grant  execute on function public.admin_add_member(text, text, text, boolean, boolean) to authenticated;
grant  execute on function public.admin_remove_access(text, boolean)        to authenticated;

-- ---------------------------------------------------------------------------
-- Existing members (signed in under step 1) get a profile with their current name.
-- ---------------------------------------------------------------------------

insert into public.profiles (email, member_id, display_name)
select lower(m.email), m.id, coalesce(nullif(btrim(m.display_name), ''), split_part(lower(m.email), '@', 1))
from public.members m
join public.allowed_emails a on a.email = lower(m.email)
where not exists (select 1 from public.profiles p where p.member_id = m.id or p.email = lower(m.email))
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Headshots: a PRIVATE storage bucket. Files live at <profile id>/avatar.jpg.
-- The site shows them through signed links that expire after an hour.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('headshots', 'headshots', false, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "headshots: members view"            on storage.objects;
drop policy if exists "headshots: upload own, admins any"  on storage.objects;
drop policy if exists "headshots: replace own, admins any" on storage.objects;
drop policy if exists "headshots: delete own, admins any"  on storage.objects;

create policy "headshots: members view" on storage.objects
  for select to authenticated
  using (bucket_id = 'headshots' and (select public.is_member()));

create policy "headshots: upload own, admins any" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'headshots'
    and (
      name = (select public.current_profile_id())::text || '/avatar.jpg'
      or ((select public.is_admin()) and name ~ '^[0-9a-f-]{36}/avatar\.jpg$')
    )
  );

create policy "headshots: replace own, admins any" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'headshots'
    and (name = (select public.current_profile_id())::text || '/avatar.jpg' or (select public.is_admin()))
  )
  with check (
    bucket_id = 'headshots'
    and (
      name = (select public.current_profile_id())::text || '/avatar.jpg'
      or ((select public.is_admin()) and name ~ '^[0-9a-f-]{36}/avatar\.jpg$')
    )
  );

create policy "headshots: delete own, admins any" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'headshots'
    and (name = (select public.current_profile_id())::text || '/avatar.jpg' or (select public.is_admin()))
  );

-- Make the site's API see the changes straight away.
notify pgrst, 'reload schema';
