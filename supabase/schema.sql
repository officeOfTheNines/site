-- The Nines members site: complete database schema.
--
-- For a BRAND-NEW project: run this whole file in the Supabase SQL Editor (safe to run again).
-- For a project that is already running: run only the new file(s) in supabase/migrations/ instead.
--
-- The file is made of one section per step, applied in order. A later step may change things an
-- earlier step created.
--
-- ===========================================================================
-- STEP 1: allowlist, members, admin
-- ===========================================================================
--
-- Run this whole file in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is safe to run more than once.
--
-- Security model:
--   * Anyone can create an account, but an account only gets access when its email is
--     confirmed AND its address is in public.allowed_emails.
--   * Every row-level security policy goes through is_member() or is_admin().
--   * The "anon" role (the public key used before login) gets no table or function access.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.allowed_emails (
  email     text primary key,
  role      text not null default 'member',
  added_by  text,
  added_on  timestamptz not null default now(),
  constraint allowed_emails_role_check  check (role in ('member', 'admin')),
  constraint allowed_emails_email_lower check (email = lower(btrim(email))),
  constraint allowed_emails_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create table if not exists public.members (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  display_name  text,
  created_on    timestamptz not null default now(),
  last_login    timestamptz,
  constraint members_display_name_length check (display_name is null or char_length(display_name) between 1 and 80)
);

alter table public.allowed_emails enable row level security;
alter table public.members        enable row level security;

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER, empty search_path, fully qualified names)
-- ---------------------------------------------------------------------------

-- The signed-in user's confirmed email, lowercased, or null.
create or replace function public.current_confirmed_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid()
    and u.email_confirmed_at is not null;
$$;

create or replace function public.my_access()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.role
  from public.allowed_emails a
  where a.email = public.current_confirmed_email();
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_access() is not null;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_access() = 'admin', false);
$$;

-- Creates or refreshes the caller's members row. Does nothing for people not on the list.
create or replace function public.claim_membership()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  u auth.users%rowtype;
  default_name text;
begin
  if not public.is_member() then
    return;
  end if;

  select * into u from auth.users where id = auth.uid();

  default_name := left(btrim(coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    split_part(lower(u.email), '@', 1)
  )), 80);

  insert into public.members (id, email, display_name, last_login)
  values (u.id, lower(u.email), default_name, now())
  on conflict (id) do update
    set email      = excluded.email,
        last_login = excluded.last_login,
        -- keep a name the member has already chosen
        display_name = coalesce(public.members.display_name, excluded.display_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers on allowed_emails
-- ---------------------------------------------------------------------------

-- Normalise the email and record who added it (the caller, not whatever the page sends).
create or replace function public.allowed_emails_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  new.added_on := now();
  if auth.uid() is not null then
    new.added_by := (select lower(email) from auth.users where id = auth.uid());
  end if;
  return new;
end;
$$;

-- Stops: removing your own address (from the site), and deleting, demoting or renaming the last admin.
create or replace function public.allowed_emails_protect_admins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.email := lower(btrim(new.email));
  end if;

  -- Removing yourself is blocked when done through the site (auth.uid() is set).
  -- In the SQL editor auth.uid() is null, so the office can still fix things there.
  if tg_op = 'DELETE'
     and auth.uid() is not null
     and old.email = (select lower(email) from auth.users where id = auth.uid()) then
    raise exception 'You cannot remove your own email address.'
      using errcode = 'P0001', hint = 'nines_self_remove';
  end if;

  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.email <> old.email) then
    -- Serialise admin changes so two admins cannot remove each other at the same moment.
    perform pg_advisory_xact_lock(hashtext('public.allowed_emails.admins'));
    if not exists (
      select 1 from public.allowed_emails
      where role = 'admin' and email <> old.email
    ) then
      raise exception 'The last admin cannot be removed or demoted. Add another admin first.'
        using errcode = 'P0001', hint = 'nines_last_admin';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- When an address leaves the list, remove that person's members row too.
-- (It is created again automatically if the address is added back and they log in.)
create or replace function public.allowed_emails_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.members where lower(email) = old.email;
  return old;
end;
$$;

drop trigger if exists allowed_emails_before_insert on public.allowed_emails;
create trigger allowed_emails_before_insert
  before insert on public.allowed_emails
  for each row execute function public.allowed_emails_before_insert();

drop trigger if exists allowed_emails_protect_admins on public.allowed_emails;
create trigger allowed_emails_protect_admins
  before update or delete on public.allowed_emails
  for each row execute function public.allowed_emails_protect_admins();

drop trigger if exists allowed_emails_after_delete on public.allowed_emails;
create trigger allowed_emails_after_delete
  after delete on public.allowed_emails
  for each row execute function public.allowed_emails_after_delete();

-- ---------------------------------------------------------------------------
-- Row-level security policies
-- ---------------------------------------------------------------------------

drop policy if exists "admins read allowlist"   on public.allowed_emails;
drop policy if exists "admins add to allowlist" on public.allowed_emails;
drop policy if exists "admins remove from allowlist" on public.allowed_emails;

create policy "admins read allowlist" on public.allowed_emails
  for select to authenticated
  using ((select public.is_admin()));

create policy "admins add to allowlist" on public.allowed_emails
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "admins remove from allowlist" on public.allowed_emails
  for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "members read members"        on public.members;
drop policy if exists "members update own name"     on public.members;
drop policy if exists "admins update any member"    on public.members;

create policy "members read members" on public.members
  for select to authenticated
  using ((select public.is_member()));

create policy "members update own name" on public.members
  for update to authenticated
  using ((select public.is_member()) and id = (select auth.uid()))
  with check ((select public.is_member()) and id = (select auth.uid()));

create policy "admins update any member" on public.members
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Privileges. New tables are not exposed automatically in this project, so grant explicitly.
-- Row-level security above still decides which rows each person sees.
-- ---------------------------------------------------------------------------

revoke all on table public.allowed_emails from public, anon, authenticated;
revoke all on table public.members        from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select, delete            on table public.allowed_emails to authenticated;
grant insert (email, role)      on table public.allowed_emails to authenticated;
grant select                    on table public.members        to authenticated;
grant update (display_name)     on table public.members        to authenticated;
-- members rows are created only by claim_membership(), and removed by the cascade or allowlist trigger.

revoke execute on function public.current_confirmed_email()       from public, anon, authenticated;
revoke execute on function public.is_member()                     from public, anon;
revoke execute on function public.is_admin()                      from public, anon;
revoke execute on function public.my_access()                     from public, anon;
revoke execute on function public.claim_membership()              from public, anon;
revoke execute on function public.allowed_emails_before_insert()  from public, anon, authenticated;
revoke execute on function public.allowed_emails_protect_admins() from public, anon, authenticated;
revoke execute on function public.allowed_emails_after_delete()   from public, anon, authenticated;

grant execute on function public.is_member()        to authenticated;
grant execute on function public.is_admin()         to authenticated;
grant execute on function public.my_access()        to authenticated;
grant execute on function public.claim_membership() to authenticated;

-- ---------------------------------------------------------------------------
-- Seed the first two admins (left alone if already present)
-- ---------------------------------------------------------------------------

insert into public.allowed_emails (email, role, added_by)
values
  ('office@thenines.club', 'admin', 'schema.sql'),
  ('jbsolanet@gmail.com',  'admin', 'schema.sql')
on conflict (email) do nothing;

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
--   * allowed_emails.needs_profile = false (for example office@thenines.club) means no card is ever
--     created automatically for that email: an office or staff account with access but no card.
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
-- allowed_emails: needs_profile (false = office/staff account, never gets a card automatically)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'allowed_emails' and column_name = 'needs_profile') then
    alter table public.allowed_emails add column needs_profile boolean not null default true;
    -- set once, when the column is first added; admins can change it later on the admin page
    update public.allowed_emails set needs_profile = false where email = 'office@thenines.club';
  end if;
end;
$$;

-- Admins may change needs_profile (and only that column) on the admin page.
drop policy if exists "admins update allowlist settings" on public.allowed_emails;
create policy "admins update allowlist settings" on public.allowed_emails
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
grant update (needs_profile) on table public.allowed_emails to authenticated;

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
--   3. if there is no profile for their email at all, creates a blank one, unless their email is
--      marked needs_profile = false (office/staff accounts).
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

  if not (select a.needs_profile from public.allowed_emails a where a.email = my_email) then
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
-- If the email is already on the list, its role is left as it is (needs_profile is set as asked).
-- If a profile already exists for the email (for example someone whose access was removed), it is
-- kept as it is, apart from "listed", which is set as asked. Returns the profile id.
-- With p_needs_profile = false (office/staff account): access only, no card; returns the existing
-- card's id if there is one, otherwise null.
drop function if exists public.admin_add_member(text, text, text, boolean, boolean);
create or replace function public.admin_add_member(
  p_email text,
  p_display_name text,
  p_role text default 'member',
  p_listed boolean default true,
  p_foreign boolean default false,
  p_needs_profile boolean default true
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

  insert into public.allowed_emails (email, role, needs_profile) values (e, p_role, coalesce(p_needs_profile, true))
  on conflict (email) do update set needs_profile = excluded.needs_profile;

  select id into pid from public.profiles where email = e;
  if not coalesce(p_needs_profile, true) then
    return pid;
  end if;
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
revoke execute on function public.admin_add_member(text, text, text, boolean, boolean, boolean) from public, anon;
revoke execute on function public.admin_remove_access(text, boolean)        from public, anon;
revoke execute on function public.profiles_before_write()                   from public, anon, authenticated;
grant  execute on function public.directory()                               to authenticated;
grant  execute on function public.current_profile_id()                      to authenticated;
grant  execute on function public.claim_membership()                        to authenticated;
grant  execute on function public.admin_add_member(text, text, text, boolean, boolean, boolean) to authenticated;
grant  execute on function public.admin_remove_access(text, boolean)        to authenticated;

-- ---------------------------------------------------------------------------
-- Existing members (signed in under step 1) get a profile with their current name,
-- except office/staff accounts (needs_profile = false).
-- ---------------------------------------------------------------------------

insert into public.profiles (email, member_id, display_name)
select lower(m.email), m.id, coalesce(nullif(btrim(m.display_name), ''), split_part(lower(m.email), '@', 1))
from public.members m
join public.allowed_emails a on a.email = lower(m.email) and a.needs_profile
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

-- ===========================================================================
-- STEP 3: brigadier groups
-- ===========================================================================
--
-- To upgrade a project that already has steps 1 and 2: run this file once in the Supabase SQL Editor.
-- It only adds things, and it is safe to run again.
-- (supabase/schema.sql = steps 1, 2 and 3 in order, for brand-new projects.)
--
-- A brigadier group is the standing team that organises a monthly dinner: usually two members,
-- rarely three. Its members are each other's co-brigadiers. A person's co-brigadiers are everyone
-- who shares a group with them: this is always worked out from group membership, never stored twice.
-- A person normally belongs to one group; more than one is allowed.
--
-- Members of a group are directory cards (profiles), so a group can be set up before people sign in.
--
-- Next step (not built yet): a dinners table with a brigadier_group_id integer column referencing
-- brigadier_groups(id), so a dinner's brigadiers come from its group instead of free text.

create table if not exists public.brigadier_groups (
  id          integer generated always as identity primary key,
  created_on  timestamptz not null default now()
);

create table if not exists public.brigadier_group_members (
  group_id    integer not null references public.brigadier_groups (id) on delete cascade,
  profile_id  uuid    not null references public.profiles (id) on delete cascade,
  added_on    timestamptz not null default now(),
  primary key (group_id, profile_id)
);

create index if not exists brigadier_group_members_profile_idx on public.brigadier_group_members (profile_id);

alter table public.brigadier_groups        enable row level security;
alter table public.brigadier_group_members enable row level security;

-- Admins read the tables directly. Members see co-brigadiers through directory() and
-- my_co_brigadiers() below, which only reveal names on listed cards.
drop policy if exists "admins read brigadier groups"         on public.brigadier_groups;
drop policy if exists "admins read brigadier group members"  on public.brigadier_group_members;

create policy "admins read brigadier groups" on public.brigadier_groups
  for select to authenticated
  using ((select public.is_admin()));

create policy "admins read brigadier group members" on public.brigadier_group_members
  for select to authenticated
  using ((select public.is_admin()));

revoke all on table public.brigadier_groups        from public, anon, authenticated;
revoke all on table public.brigadier_group_members from public, anon, authenticated;
grant select on table public.brigadier_groups        to authenticated;
grant select on table public.brigadier_group_members to authenticated;
-- Changes go through the admin functions below, so a group is always saved in one step.

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

-- Creates a group (p_group_id null) or replaces the members of an existing one.
-- p_profile_ids: the cards in the group, at least one. Returns the group id.
create or replace function public.admin_save_brigadier_group(p_group_id integer, p_profile_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  gid integer := p_group_id;
  ids uuid[] := array(select distinct x from unnest(coalesce(p_profile_ids, '{}'::uuid[])) as x where x is not null);
begin
  if not public.is_admin() then
    raise exception 'Only admins can change brigadier groups.' using errcode = '42501';
  end if;
  if cardinality(ids) = 0 then
    raise exception 'A brigadier group needs at least one member.' using errcode = '22023';
  end if;
  if (select count(*) from public.profiles where id = any (ids)) <> cardinality(ids) then
    raise exception 'One of the chosen members no longer exists. Reload and try again.' using errcode = '23503';
  end if;

  if gid is null then
    insert into public.brigadier_groups default values returning id into gid;
  elsif not exists (select 1 from public.brigadier_groups where id = gid) then
    raise exception 'That brigadier group no longer exists.' using errcode = 'P0002';
  end if;

  delete from public.brigadier_group_members where group_id = gid and not (profile_id = any (ids));
  insert into public.brigadier_group_members (group_id, profile_id)
  select gid, x from unnest(ids) as x
  on conflict do nothing;

  return gid;
end;
$$;

create or replace function public.admin_delete_brigadier_group(p_group_id integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change brigadier groups.' using errcode = '42501';
  end if;
  delete from public.brigadier_groups where id = p_group_id;
  if not found then
    raise exception 'That brigadier group no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Co-brigadiers, worked out from shared groups
-- ---------------------------------------------------------------------------

-- Names of a card's co-brigadiers that members may see (listed cards only), in name order.
create or replace function public.co_brigadier_names(p_profile_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct other.display_name order by other.display_name), '{}')
  from public.brigadier_group_members mine
  join public.brigadier_group_members theirs
    on theirs.group_id = mine.group_id and theirs.profile_id <> mine.profile_id
  join public.profiles other on other.id = theirs.profile_id
  where mine.profile_id = p_profile_id
    and other.listed;
$$;

-- The signed-in member's own co-brigadiers (for their profile page).
create or replace function public.my_co_brigadiers()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.current_profile_id() is null then '{}'::text[]
              else public.co_brigadier_names(public.current_profile_id()) end;
$$;

-- The directory, now with each card's co-brigadiers. Same privacy rules as step 2.
drop function if exists public.directory();
create function public.directory()
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
    p.bio,
    p.photo_path,
    case when p.show_email then p.email end,
    case when p.show_phone then p.phone end,
    a.email is null,
    p.foreign_member,
    public.co_brigadier_names(p.id)
  from public.profiles p
  left join public.allowed_emails a on a.email = p.email
  where public.is_member()
    and p.listed
  order by lower(p.display_name);
$$;

revoke execute on function public.directory()                                    from public, anon;
revoke execute on function public.my_co_brigadiers()                             from public, anon;
revoke execute on function public.co_brigadier_names(uuid)                       from public, anon, authenticated;
revoke execute on function public.admin_save_brigadier_group(integer, uuid[])    from public, anon;
revoke execute on function public.admin_delete_brigadier_group(integer)          from public, anon;
grant  execute on function public.directory()                                    to authenticated;
grant  execute on function public.my_co_brigadiers()                             to authenticated;
grant  execute on function public.admin_save_brigadier_group(integer, uuid[])    to authenticated;
grant  execute on function public.admin_delete_brigadier_group(integer)          to authenticated;

-- Make the site's API see the changes straight away.
notify pgrst, 'reload schema';

-- ===========================================================================
-- STEP 4: change a member's email
-- ===========================================================================
--
-- To upgrade a project that already has steps 1 to 3: run this file once in the Supabase SQL Editor.
-- It only adds one function, and it is safe to run again.
-- (supabase/schema.sql = steps 1 to 4 in order, for brand-new projects.)
--
-- When a member starts using a different email, an admin changes it in one action. It:
--   1. moves their access (allowed_emails) to the new email, keeping role and settings;
--   2. moves their directory card (profiles) to the new email, keeping photo, bio, groups and choices;
--   3. unlinks the card from their old login, unless that login already uses the new email.
--      The next time they sign in with the new email (any method), claim_membership() links the card
--      to them again. The old login stops working because its email is no longer on the list.
-- Nothing is duplicated or deleted.

create or replace function public.admin_change_email(p_old_email text, p_new_email text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o text := lower(btrim(p_old_email));
  n text := lower(btrim(p_new_email));
begin
  if not public.is_admin() then
    raise exception 'Only admins can change emails.' using errcode = '42501';
  end if;
  if n is null or n !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'The new email address does not look right.' using errcode = '22023';
  end if;
  if o = n then
    raise exception 'The new email is the same as the old one.' using errcode = '22023';
  end if;
  if o = public.current_confirmed_email() then
    raise exception 'You cannot change your own email here. Ask another admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.allowed_emails where email = o)
     and not exists (select 1 from public.profiles where email = o) then
    raise exception 'That email is not on the list and has no card.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.allowed_emails where email = n)
     or exists (select 1 from public.profiles where email = n) then
    raise exception 'The new email is already used by someone else.' using errcode = '23505';
  end if;

  -- The step 1 rules still apply here (for example, never leave the club without an admin).
  update public.allowed_emails set email = n where email = o;

  update public.profiles p
    set email = n,
        member_id = case
          when p.member_id is not null
               and (select lower(u.email) from auth.users u where u.id = p.member_id) = n
            then p.member_id   -- their login already uses the new email: keep the link
          else null            -- re-linked automatically when they sign in with the new email
        end
    where p.email = o;
end;
$$;

revoke execute on function public.admin_change_email(text, text) from public, anon;
grant  execute on function public.admin_change_email(text, text) to authenticated;

notify pgrst, 'reload schema';
