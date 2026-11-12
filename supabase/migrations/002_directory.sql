-- ===========================================================================
-- STEP 2: member directory, admin-created members, profiles and headshots
-- ===========================================================================
--
-- To upgrade a project that already has step 1: run this file once in the Supabase SQL Editor.
-- It never deletes members or allowlist entries you added, and it is safe to run again.
-- (supabase/schema.sql = step 1 followed by this same section, for brand-new projects.)
--
-- What changes:
--   * A directory entry (members row) no longer needs a login. Admins can create one for any email
--     on the list, with a profile. When that person first signs in with the same, confirmed email,
--     the entry is linked to their login and they can edit it (and only it).
--   * members gets its own id plus user_id (the login, empty until first sign-in). Existing rows keep
--     their id and are linked to their login automatically.
--   * Ordinary members can read only their OWN members row. Everyone else comes through directory(),
--     which shows email or phone only where that member chose to show them.
--   * New: profiles table, directory() function, private "headshots" storage bucket.

-- ---------------------------------------------------------------------------
-- members: decouple from logins
-- ---------------------------------------------------------------------------

do $$
begin
  -- user_id = the login linked to this entry (null until the person first signs in)
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'user_id'
  ) then
    alter table public.members add column user_id uuid;
    update public.members set user_id = id;               -- step 1 rows: id was the login id
    alter table public.members drop constraint if exists members_id_fkey;
    alter table public.members alter column id set default gen_random_uuid();
    alter table public.members add constraint members_user_id_key unique (user_id);
    alter table public.members add constraint members_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete set null;
  end if;

  -- one entry per email, and every entry's email must be on the allowlist
  if not exists (select 1 from pg_constraint where conname = 'members_email_key') then
    update public.members set email = lower(btrim(email)) where email <> lower(btrim(email));
    -- rows whose email is no longer on the list had no access anyway (step 1 removed them on delete)
    delete from public.members m
      where m.email is null or not exists (select 1 from public.allowed_emails a where a.email = m.email);
    alter table public.members alter column email set not null;
    alter table public.members add constraint members_email_key unique (email);
    alter table public.members add constraint members_email_fkey
      foreign key (email) references public.allowed_emails (email) on update cascade on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'members_display_name_not_blank') then
    alter table public.members
      add constraint members_display_name_not_blank check (display_name is null or btrim(display_name) <> '');
  end if;
end;
$$;

-- The foreign key above now removes a members row when its email leaves the list.
drop trigger if exists allowed_emails_after_delete on public.allowed_emails;
drop function if exists public.allowed_emails_after_delete();

-- Normalise emails on new entries; only claim_membership() sets user_id.
create or replace function public.members_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  new.display_name := nullif(btrim(new.display_name), '');
  if tg_op = 'INSERT' then
    new.created_on := now();
  end if;
  return new;
end;
$$;

drop trigger if exists members_before_write on public.members;
create trigger members_before_write
  before insert or update on public.members
  for each row execute function public.members_before_write();

-- The signed-in person's directory entry id, or null.
create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.user_id = auth.uid()
    and public.is_member();
$$;

-- Called by the site after every sign-in. For an allowed, confirmed caller it:
--   1. finds the entry already linked to their login, or
--   2. links the entry an admin created for their email (if not linked to anyone yet), or
--   3. creates a new entry.
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
  mid uuid;
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

  select id into mid from public.members where user_id = u.id;

  if mid is null then
    update public.members
      set user_id = u.id,
          last_login = now(),
          display_name = coalesce(display_name, default_name)
      where email = my_email and user_id is null
      returning id into mid;
  end if;

  if mid is null then
    insert into public.members (user_id, email, display_name, last_login)
    values (u.id, my_email, default_name, now())
    on conflict (email) do nothing;
    return;
  end if;

  update public.members set last_login = now() where id = mid;
  -- follow a change of login email when the new address is on the list and free
  begin
    update public.members set email = my_email where id = mid and email <> my_email;
  exception when unique_violation or foreign_key_violation then
    null;
  end;
end;
$$;

drop policy if exists "members read members"                  on public.members;  -- step 1
drop policy if exists "members read own row, admins read all" on public.members;
drop policy if exists "members update own name"               on public.members;
drop policy if exists "admins update any member"              on public.members;
drop policy if exists "admins add members"                    on public.members;

create policy "members read own row, admins read all" on public.members
  for select to authenticated
  using (
    ((select public.is_member()) and user_id = (select auth.uid()))
    or (select public.is_admin())
  );

create policy "members update own name" on public.members
  for update to authenticated
  using ((select public.is_member()) and user_id = (select auth.uid()))
  with check ((select public.is_member()) and user_id = (select auth.uid()));

create policy "admins update any member" on public.members
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "admins add members" on public.members
  for insert to authenticated
  with check ((select public.is_admin()));

revoke all on table public.members from public, anon, authenticated;
grant select                        on table public.members to authenticated;
grant insert (email, display_name)  on table public.members to authenticated;
grant update (display_name)         on table public.members to authenticated;

-- ---------------------------------------------------------------------------
-- profiles: one per directory entry, created when it is first saved
-- (no row yet = "has not filled in a profile")
-- ---------------------------------------------------------------------------

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

drop policy if exists "members read own profile, admins read all"     on public.profiles;
drop policy if exists "members add own profile, admins add any"       on public.profiles;
drop policy if exists "members update own profile, admins update any" on public.profiles;

create policy "members read own profile, admins read all" on public.profiles
  for select to authenticated
  using (member_id = (select public.current_member_id()) or (select public.is_admin()));

create policy "members add own profile, admins add any" on public.profiles
  for insert to authenticated
  with check (member_id = (select public.current_member_id()) or (select public.is_admin()));

create policy "members update own profile, admins update any" on public.profiles
  for update to authenticated
  using (member_id = (select public.current_member_id()) or (select public.is_admin()))
  with check (member_id = (select public.current_member_id()) or (select public.is_admin()));

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant insert (member_id, bio, phone, show_email, show_phone, photo_path, listed) on table public.profiles to authenticated;
grant update (bio, phone, show_email, show_phone, photo_path, listed)            on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- The directory. Listed entries only; email and phone ONLY where the member turned the flag on.
-- Includes entries created by admins for people who have not signed in yet.
-- Returns nothing at all to callers who are not members.
-- ---------------------------------------------------------------------------

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
    case when p.show_email then m.email end,
    case when p.show_phone then p.phone end
  from public.members m
  left join public.profiles p on p.member_id = m.id
  where public.is_member()
    and coalesce(p.listed, true)
  order by lower(coalesce(m.display_name, m.email));
$$;

revoke execute on function public.directory()             from public, anon;
revoke execute on function public.current_member_id()     from public, anon;
revoke execute on function public.claim_membership()      from public, anon;
revoke execute on function public.profiles_before_write() from public, anon, authenticated;
revoke execute on function public.members_before_write()  from public, anon, authenticated;
grant  execute on function public.directory()             to authenticated;
grant  execute on function public.current_member_id()     to authenticated;
grant  execute on function public.claim_membership()      to authenticated;

-- ---------------------------------------------------------------------------
-- Headshots: a PRIVATE storage bucket. Files live at <member id>/avatar.jpg
-- (the directory entry id). The site shows them through signed links that expire after an hour.
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
      name = (select public.current_member_id())::text || '/avatar.jpg'
      or ((select public.is_admin()) and name ~ '^[0-9a-f-]{36}/avatar\.jpg$')
    )
  );

create policy "headshots: replace own, admins any" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'headshots'
    and (name = (select public.current_member_id())::text || '/avatar.jpg' or (select public.is_admin()))
  )
  with check (
    bucket_id = 'headshots'
    and (
      name = (select public.current_member_id())::text || '/avatar.jpg'
      or ((select public.is_admin()) and name ~ '^[0-9a-f-]{36}/avatar\.jpg$')
    )
  );

create policy "headshots: delete own, admins any" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'headshots'
    and (name = (select public.current_member_id())::text || '/avatar.jpg' or (select public.is_admin()))
  );

-- Make the site's API see the changes straight away.
notify pgrst, 'reload schema';
