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
