-- The Nines members site: step 1 schema (allowlist, members, admin).
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

drop policy if exists "members read members"        on public.members;  -- step 1 policy, replaced in step 2
drop policy if exists "members read own row, admins read all" on public.members;
drop policy if exists "members update own name"     on public.members;
drop policy if exists "admins update any member"    on public.members;

-- Ordinary members only see their own row (it holds their email). Everyone else's public details
-- come through directory(), which hides email and phone unless the member chose to show them.
create policy "members read own row, admins read all" on public.members
  for select to authenticated
  using (
    ((select public.is_member()) and id = (select auth.uid()))
    or (select public.is_admin())
  );

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
