-- The Nines members site: complete database schema (several clubs).
--
-- For a BRAND-NEW project: run this whole file in the Supabase SQL Editor. It runs as one
-- transaction and is safe to run again.
-- For a project that is already running: run only the new file(s) in supabase/migrations/ instead.
-- This file always matches the result of running every migration in order.
--
-- Concepts:
--   clubs           = The Nines (1), Les Ronds (2)
--   club_access     = who may open each club's member area, and their role there (one row per club)
--   super_admins    = people who manage every club
--   members         = one login record per person who has signed in
--   profiles        = one shared profile per person (name, phone, photo), used by all their clubs
--   club_profiles   = a person's card in one club (bio, listed, foreign member, show email/phone,
--                     and optionally its own photo for that club, override_photo_path)
--   brigadier_groups / brigadier_group_members = the teams that organise each club's dinners
--   venues          = restaurants, shared across clubs: recommended in Recos and/or hosting club dinners
--   reco_comments   = the recos themselves: author, club posted as, text, who can see it
--                     ('everyone' | 'club' | 'me'); a venue is visible on Recos only through a visible reco
--   club_events     = club dinners: date (no time), optional venue, brigadier group or names, ratings,
--                     and replies status (not_open | open | closed) with an optional deadline
--   club_event_answers = one reply per member per dinner (attending | not attending), set through functions
-- Everything is enforced with row-level security; the publishable (anon) key can read nothing.

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.clubs (
  id          integer primary key,
  slug        text not null unique,
  name        text not null,
  site_url    text,
  map_url     text,
  created_on  timestamptz not null default now(),
  rating_scale smallint not null default 10,   -- dinner ratings are out of this (The Nines 10, Les Ronds 20)
  map_center_lat   double precision,           -- member map home (centre and zoom); the page falls back to
  map_center_lng   double precision,           -- the club's city when empty
  map_default_zoom smallint,
  constraint clubs_rating_scale check (rating_scale between 1 and 100),
  constraint clubs_map_home check (
    (map_center_lat is null or map_center_lat between -90 and 90)
    and (map_center_lng is null or map_center_lng between -180 and 180)
    and (map_default_zoom is null or map_default_zoom between 1 and 19))
);

-- Access, per club (one row per person per club).
create table if not exists public.club_access (
  club_id        integer not null references public.clubs (id),
  email          text not null,
  role           text not null default 'member',
  needs_profile  boolean not null default true,
  added_by       text,
  added_on       timestamptz not null default now(),
  primary key (club_id, email),
  constraint club_access_role_check  check (role in ('member', 'admin')),
  constraint club_access_email_lower check (email = lower(btrim(email))),
  constraint club_access_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create table if not exists public.super_admins (
  email     text primary key,
  added_by  text,
  added_on  timestamptz not null default now(),
  constraint super_admins_email_lower check (email = lower(btrim(email)))
);

-- Login records: one row per person who has signed in.
create table if not exists public.members (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  display_name  text,
  created_on    timestamptz not null default now(),
  last_login    timestamptz,
  constraint members_display_name_length check (display_name is null or char_length(display_name) between 1 and 80)
);

-- Shared profile: one per person, used by every club they belong to.
create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  member_id     uuid references public.members (id) on delete set null,
  display_name  text not null,
  phone         text,
  photo_path    text,
  created_on    timestamptz not null default now(),
  updated_on    timestamptz not null default now(),
  constraint profiles_email_key          unique (email),
  constraint profiles_member_id_key      unique (member_id),
  constraint profiles_email_lower        check (email = lower(btrim(email))),
  constraint profiles_email_shape        check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint profiles_display_name_shape check (btrim(display_name) <> '' and char_length(display_name) <= 80),
  constraint profiles_phone_shape        check (phone is null or phone ~ '^[0-9+() .-]{5,30}$'),
  constraint profiles_photo_path         check (photo_path is null or photo_path = id::text || '/avatar.jpg')
);

-- A person's card in one club: what that club's members see, and that club's settings for them.
create table if not exists public.club_profiles (
  club_id            integer not null references public.clubs (id) on delete cascade,
  profile_id         uuid not null references public.profiles (id) on delete cascade,
  bio                text,
  listed             boolean not null default true,
  foreign_member     boolean not null default false,
  show_email         boolean not null default false,
  show_phone         boolean not null default false,
  member_updated_on  timestamptz,   -- last time the person saved this card themselves (null = prompt them)
  created_on         timestamptz not null default now(),
  updated_on         timestamptz not null default now(),
  override_photo_path text,         -- this club's own photo (<profile id>/club-<club id>.jpg); null = main photo
  member_number      integer,       -- the club's membership number (admins only)
  club_role          text,          -- e.g. "Fondateur et président du Diner des Ronds" (admins only)
  occupation         text,
  other_clubs        text[] not null default '{}',
  address            text,          -- home address; other members see it only when show_address
  show_address       boolean not null default false,
  primary key (club_id, profile_id),
  constraint club_profiles_bio_length check (bio is null or char_length(bio) <= 500),
  constraint club_profiles_override_photo_path check (override_photo_path is null
    or override_photo_path = profile_id::text || '/club-' || club_id::text || '.jpg'),
  constraint club_profiles_member_number check (member_number is null or member_number > 0),
  constraint club_profiles_text_lengths check (
    char_length(coalesce(club_role, '')) <= 120 and char_length(coalesce(occupation, '')) <= 200
    and char_length(coalesce(address, '')) <= 300),
  constraint club_profiles_other_clubs check (
    cardinality(other_clubs) <= 12 and char_length(array_to_string(other_clubs, '|')) <= 600)
);
create index if not exists club_profiles_profile_idx on public.club_profiles (profile_id);
create unique index if not exists club_profiles_member_number_idx
  on public.club_profiles (club_id, member_number) where member_number is not null;

-- Brigadier groups: the standing teams (usually 2, rarely 3) that organise a club's dinners.
-- Next step (not built yet): dinners.brigadier_group_id integer references brigadier_groups (id).
create table if not exists public.brigadier_groups (
  id          integer generated always as identity primary key,
  created_on  timestamptz not null default now(),
  club_id     integer not null default 1 references public.clubs (id)
);

create table if not exists public.brigadier_group_members (
  group_id    integer not null references public.brigadier_groups (id) on delete cascade,
  profile_id  uuid    not null references public.profiles (id) on delete cascade,
  added_on    timestamptz not null default now(),
  is_godson   smallint,   -- 0 = godfather (sponsor), 1 = godson, null = an ordinary brigadier group
  primary key (group_id, profile_id),
  constraint brigadier_group_members_is_godson check (is_godson in (0, 1))
);
create index if not exists brigadier_group_members_profile_idx on public.brigadier_group_members (profile_id);

-- ---------------------------------------------------------------------------
-- Clubs and the first admins (left alone if already present)
-- ---------------------------------------------------------------------------

insert into public.clubs (id, slug, name, site_url, map_url, rating_scale, map_center_lat, map_center_lng, map_default_zoom) values
  (1, 'nines',    'The Nines',       'https://site.thenines.club/',          'https://map.thenines.club',   10, 51.5074, -0.1278, 12),
  (2, 'lesronds', 'Dîner des Ronds', 'https://site.thenines.club/lesronds/', 'https://ronds.thenines.club', 20, 48.8566,  2.3522, 12)
on conflict (id) do nothing;

insert into public.super_admins (email, added_by) values ('jbsolanet@gmail.com', 'schema.sql')
on conflict (email) do nothing;

insert into public.club_access (club_id, email, role, needs_profile, added_by) values
  (1, 'office@thenines.club', 'admin', false, 'schema.sql'),
  (1, 'jbsolanet@gmail.com',  'admin', true,  'schema.sql')
on conflict (club_id, email) do nothing;

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

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.super_admins s where s.email = public.current_confirmed_email()
  );
$$;

-- The caller's role in a club: 'admin', 'member', or null (no access). Super admins are admins everywhere.
create or replace function public.my_access(p_club integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.current_confirmed_email() is null then null
    when not exists (select 1 from public.clubs c where c.id = p_club) then null
    when public.is_super_admin() then 'admin'
    else (select a.role from public.club_access a
          where a.club_id = p_club and a.email = public.current_confirmed_email())
  end;
$$;

create or replace function public.is_member(p_club integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_access(p_club) is not null;
$$;

create or replace function public.is_admin(p_club integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_access(p_club) = 'admin', false);
$$;

-- True when the caller has access to at least one club.
create or replace function public.has_any_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin()
      or exists (select 1 from public.club_access a where a.email = public.current_confirmed_email());
$$;

-- The clubs the caller can open, with their role in each (for club pickers).
create or replace function public.my_clubs()
returns table (club_id integer, slug text, name text, site_url text, map_url text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.slug, c.name, c.site_url, c.map_url, public.my_access(c.id)
  from public.clubs c
  where public.my_access(c.id) is not null
  order by c.id;
$$;

-- The signed-in person's shared profile id, or null.
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
    and public.has_any_access();
$$;

-- True when the caller may manage this profile: a super admin, or an admin of a club the person
-- belongs to (has access to, or has a card in).
create or replace function public.can_admin_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin()
      or exists (select 1 from public.club_profiles cp
                 where cp.profile_id = p_profile and public.is_admin(cp.club_id))
      or exists (select 1 from public.profiles p
                 join public.club_access a on a.email = p.email
                 where p.id = p_profile and public.is_admin(a.club_id));
$$;

-- '<profile id>/avatar.jpg' (main photo) or '<profile id>/club-<n>.jpg' (a club's own photo)
-- -> the profile id; anything else -> null (never an error).
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

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Normalise the email and record who added it (the caller, not whatever the page sends).
create or replace function public.club_access_before_insert()
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

-- Stops, per club: removing your own access (from the site), and deleting, demoting or moving the
-- club's last admin. In the SQL editor auth.uid() is null, so the office can still fix things there.
create or replace function public.club_access_protect_admins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.email := lower(btrim(new.email));
  end if;

  if tg_op = 'DELETE'
     and auth.uid() is not null
     and old.email = (select lower(email) from auth.users where id = auth.uid()) then
    raise exception 'You cannot remove your own email address.'
      using errcode = 'P0001', hint = 'nines_self_remove';
  end if;

  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.email <> old.email or new.club_id <> old.club_id) then
    -- serialise admin changes per club so two admins cannot remove each other at the same moment
    perform pg_advisory_xact_lock(hashtext('public.club_access.admins'), old.club_id);
    if not exists (
      select 1 from public.club_access
      where club_id = old.club_id and role = 'admin' and email <> old.email
    ) then
      raise exception 'The last admin of this club cannot be removed or demoted. Add another admin first.'
        using errcode = 'P0001', hint = 'nines_last_admin';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists club_access_before_insert on public.club_access;
create trigger club_access_before_insert
  before insert on public.club_access
  for each row execute function public.club_access_before_insert();

drop trigger if exists club_access_protect_admins on public.club_access;
create trigger club_access_protect_admins
  before update or delete on public.club_access
  for each row execute function public.club_access_protect_admins();

-- Shared profile: tidies values. Direct edits from the site by someone who cannot manage the
-- profile keep email and member_id as they were. Runs with the caller's rights so current_user
-- tells the site ('authenticated') apart from the database's own functions and the SQL editor.
create or replace function public.profiles_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  new.display_name := btrim(new.display_name);
  new.phone := nullif(btrim(new.phone), '');
  new.updated_on := now();
  if tg_op = 'INSERT' then
    new.created_on := now();
  elsif current_user = 'authenticated' and not public.can_admin_profile(old.id) then
    new.email := old.email;
    new.member_id := old.member_id;
    new.created_on := old.created_on;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_before_write on public.profiles;
create trigger profiles_before_write
  before insert or update on public.profiles
  for each row execute function public.profiles_before_write();

-- Club card settings: only that club's admins change listed / foreign_member (members' attempts
-- are kept as they were). Records when the person saves their own card in that club.
create or replace function public.club_profiles_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.bio := nullif(btrim(new.bio), '');
  new.club_role := nullif(btrim(new.club_role), '');
  new.occupation := nullif(btrim(new.occupation), '');
  new.address := nullif(btrim(new.address), '');
  new.other_clubs := coalesce(array(
    select c from (select distinct on (lower(btrim(x))) btrim(x) as c, o
                   from unnest(coalesce(new.other_clubs, '{}'::text[])) with ordinality as u(x, o)
                   where btrim(coalesce(x, '')) <> ''
                   order by lower(btrim(x)), o) d
    order by o), '{}'::text[]);
  new.updated_on := now();
  if tg_op = 'INSERT' then
    new.created_on := now();
    new.member_updated_on := null;
    return new;
  end if;
  if current_user = 'authenticated' and not public.is_admin(old.club_id) then
    new.listed := old.listed;
    new.foreign_member := old.foreign_member;
    new.member_number := old.member_number;
    new.club_role := old.club_role;
  end if;
  new.club_id := old.club_id;
  new.profile_id := old.profile_id;
  new.created_on := old.created_on;
  if auth.uid() is not null
     and (select p.member_id from public.profiles p where p.id = old.profile_id) = auth.uid() then
    new.member_updated_on := now();
  else
    new.member_updated_on := old.member_updated_on;
  end if;
  return new;
end;
$$;

drop trigger if exists club_profiles_before_write on public.club_profiles;
create trigger club_profiles_before_write
  before insert or update on public.club_profiles
  for each row execute function public.club_profiles_before_write();

-- ---------------------------------------------------------------------------
-- Sign-in
-- ---------------------------------------------------------------------------

-- Called by the site after every sign-in. For a caller with access to any club it:
--   1. creates or refreshes their members row (login record);
--   2. links the shared profile with their email, if none is linked to them yet (any login method);
--   3. if a club they belong to needs a card (needs_profile), makes sure a profile exists and that
--      it has a card in each such club (blank cards for new people).
-- Does nothing for people with no access.
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
  pid uuid;
begin
  if not public.has_any_access() then
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

  select id into pid from public.profiles where member_id = u.id;
  if pid is null then
    update public.profiles set member_id = u.id
      where email = my_email and member_id is null
      returning id into pid;
  end if;

  if not exists (select 1 from public.club_access where email = my_email and needs_profile) then
    return;
  end if;

  if pid is null then
    insert into public.profiles (email, member_id, display_name)
    values (my_email, u.id, default_name)
    on conflict (email) do nothing   -- a profile for this email is linked to another login: leave it
    returning id into pid;
  end if;
  if pid is null then
    return;
  end if;

  insert into public.club_profiles (club_id, profile_id)
  select a.club_id, pid from public.club_access a
  where a.email = my_email and a.needs_profile
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Directory and co-brigadiers (per club)
-- ---------------------------------------------------------------------------

-- Names of a card's co-brigadiers in one club (listed cards in that club only), in name order.
create or replace function public.co_brigadier_names(p_club integer, p_profile_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct other.display_name order by other.display_name), '{}')
  from public.brigadier_groups g
  join public.brigadier_group_members mine on mine.group_id = g.id and mine.profile_id = p_profile_id
  join public.brigadier_group_members theirs
    on theirs.group_id = g.id and theirs.profile_id <> p_profile_id
  join public.profiles other on other.id = theirs.profile_id
  join public.club_profiles ocp on ocp.profile_id = other.id and ocp.club_id = p_club
  where g.club_id = p_club
    and ocp.listed;
$$;

create or replace function public.my_co_brigadiers(p_club integer)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.current_profile_id() is null or not public.is_member(p_club) then '{}'::text[]
              else public.co_brigadier_names(p_club, public.current_profile_id()) end;
$$;

-- A club's directory: listed cards only. Email and phone appear where the person chose to show
-- them, and always for that club's admins. former_member = no access to this club any more.
-- photo_path = the card's own photo for this club if it has one, otherwise the main photo.
-- Returns nothing to people who are not members of the club.
create or replace function public.member_relations(p_club integer, p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', other.id,
           'display_name', other.display_name,
           'relation', case when theirs.is_godson = 1 and mine.is_godson = 0 then 'godson'
                            when theirs.is_godson = 0 and mine.is_godson = 1 then 'godfather'
                            else 'co_brigadier' end,
           'group_id', g.id)
         order by g.id, other.display_name), '[]'::jsonb)
  from public.brigadier_groups g
  join public.brigadier_group_members mine on mine.group_id = g.id and mine.profile_id = p_profile_id
  join public.brigadier_group_members theirs on theirs.group_id = g.id and theirs.profile_id <> p_profile_id
  join public.profiles other on other.id = theirs.profile_id
  join public.club_profiles ocp on ocp.profile_id = other.id and ocp.club_id = p_club
  where g.club_id = p_club
    and ocp.listed;
$$;

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
  co_brigadiers  text[],
  member_number  integer,
  club_role      text,
  occupation     text,
  other_clubs    text[],
  address        text,
  private_fields text[],     -- admins only: of 'email', 'phone', 'address', those other members cannot see
  relations      jsonb       -- [{ profile_id, display_name, relation: godson | godfather | co_brigadier, group_id }]
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
    public.co_brigadier_names(p_club, p.id),
    cp.member_number,
    cp.club_role,
    cp.occupation,
    cp.other_clubs,
    case when cp.show_address or public.is_admin(p_club) then cp.address end,
    case when public.is_admin(p_club) then
      array_remove(array[case when not cp.show_email then 'email' end,
                         case when not cp.show_phone then 'phone' end,
                         case when not cp.show_address then 'address' end], null)
    end,
    public.member_relations(p_club, p.id)
  from public.club_profiles cp
  join public.profiles p on p.id = cp.profile_id
  where public.is_member(p_club)
    and cp.club_id = p_club
    and cp.listed
  order by lower(p.display_name);
$$;

-- ---------------------------------------------------------------------------
-- Admin actions (each checks that the caller is an admin of the club it acts on)
-- ---------------------------------------------------------------------------

-- Add a member to a club: access AND their card in that club, in one step. The shared profile is
-- reused if the person already has one (for example from another club). If the email already has
-- access to this club, its role is left as it is (needs_profile is set as asked). Re-adding someone
-- whose access was removed restores access and keeps their card ("listed" set as asked).
-- p_needs_profile = false: access only, no card. Returns the profile id (or null without a card).
create or replace function public.admin_add_member(
  p_club integer,
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
  if not public.is_admin(p_club) then
    raise exception 'Only admins of this club can add members.' using errcode = '42501';
  end if;
  if p_role not in ('member', 'admin') then
    raise exception 'Role must be member or admin.' using errcode = '22023';
  end if;

  insert into public.club_access (club_id, email, role, needs_profile)
  values (p_club, e, p_role, coalesce(p_needs_profile, true))
  on conflict (club_id, email) do update set needs_profile = excluded.needs_profile;

  select id into pid from public.profiles where email = e;
  if not coalesce(p_needs_profile, true) then
    return pid;
  end if;

  if pid is null then
    insert into public.profiles (email, display_name, member_id)
    values (e, p_display_name,
            (select m.id from public.members m
              where lower(m.email) = e
                and not exists (select 1 from public.profiles x where x.member_id = m.id)))
    returning id into pid;
  end if;

  insert into public.club_profiles (club_id, profile_id, listed, foreign_member)
  values (p_club, pid, coalesce(p_listed, true), coalesce(p_foreign, false))
  on conflict (club_id, profile_id) do update set listed = excluded.listed;

  return pid;
end;
$$;

-- Remove access to one club: the person can no longer open that club's member area. Their card in
-- that club is kept (hidden if asked; otherwise shown as "Former member"). Other clubs are untouched.
create or replace function public.admin_remove_access(p_club integer, p_email text, p_hide boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e text := lower(btrim(p_email));
begin
  if not public.is_admin(p_club) then
    raise exception 'Only admins of this club can remove access.' using errcode = '42501';
  end if;
  delete from public.club_access where club_id = p_club and email = e;
  if not found then
    raise exception 'That email is not on this club''s list.' using errcode = 'P0002';
  end if;
  if p_hide then
    update public.club_profiles cp set listed = false
    from public.profiles p
    where cp.profile_id = p.id and cp.club_id = p_club and p.email = e;
  end if;
end;
$$;

-- What "Remove from club" would do, so the page can ask before acting:
--   small_group_ids = this club's brigadier groups that would be left with fewer than 2 members;
--   deletes_profile = the person would then belong to no club, so their shared profile and login
--                     record are deleted too; photo_path = their photo (removed by the page first).
create or replace function public.admin_remove_from_club_preview(p_club integer, p_email text)
returns table (small_group_ids integer[], deletes_profile boolean, photo_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e text := lower(btrim(p_email));
  pid uuid;
begin
  if not public.is_admin(p_club) then
    raise exception 'Only admins of this club can remove members.' using errcode = '42501';
  end if;
  select id into pid from public.profiles where email = e;
  return query
  select
    coalesce((select array_agg(g.id order by g.id)
              from public.brigadier_groups g
              where g.club_id = p_club
                and exists (select 1 from public.brigadier_group_members m where m.group_id = g.id and m.profile_id = pid)
                and (select count(*) from public.brigadier_group_members m where m.group_id = g.id and m.profile_id <> pid) < 2),
             '{}'::integer[]),
    not exists (select 1 from public.club_access a where a.email = e and a.club_id <> p_club)
      and not exists (select 1 from public.club_profiles cp where cp.profile_id = pid and cp.club_id <> p_club),
    (select p.photo_path from public.profiles p where p.id = pid);
end;
$$;

-- Remove from club: deletes, for THIS club only, the person's access, their card and their
-- brigadier group places. A group left with fewer than 2 members is deleted only when
-- p_delete_small_groups is true (the page asks the admin first); otherwise nothing changes.
-- If the person then belongs to no club (no access and no card anywhere), their shared profile and
-- their login record (members) are deleted too. Their Supabase sign-in account itself is not.
create or replace function public.admin_remove_from_club(p_club integer, p_email text, p_delete_small_groups boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e text := lower(btrim(p_email));
  pid uuid;
  small integer[];
begin
  if not public.is_admin(p_club) then
    raise exception 'Only admins of this club can remove members.' using errcode = '42501';
  end if;
  if e = public.current_confirmed_email() then
    raise exception 'You cannot remove yourself. Ask another admin.' using errcode = '42501';
  end if;
  select id into pid from public.profiles where email = e;
  if pid is null and not exists (select 1 from public.club_access where club_id = p_club and email = e) then
    raise exception 'That person is not in this club.' using errcode = 'P0002';
  end if;
  if pid is not null and not exists (select 1 from public.club_profiles where club_id = p_club and profile_id = pid)
     and not exists (select 1 from public.club_access where club_id = p_club and email = e) then
    raise exception 'That person is not in this club.' using errcode = 'P0002';
  end if;

  select array_agg(g.id) into small
  from public.brigadier_groups g
  where g.club_id = p_club
    and exists (select 1 from public.brigadier_group_members m where m.group_id = g.id and m.profile_id = pid)
    and (select count(*) from public.brigadier_group_members m where m.group_id = g.id and m.profile_id <> pid) < 2;
  if small is not null and not coalesce(p_delete_small_groups, false) then
    raise exception 'Removing this person would leave brigadier group(s) % with fewer than two members. Confirm to delete those groups.', array_to_string(small, ', ')
      using errcode = 'P0001', hint = 'nines_small_groups';
  end if;

  -- this club only (the step 1 rules apply: not yourself, never the club's last admin)
  delete from public.club_access where club_id = p_club and email = e;
  if pid is not null then
    delete from public.brigadier_group_members m
      using public.brigadier_groups g
      where m.group_id = g.id and g.club_id = p_club and m.profile_id = pid;
    if small is not null then
      delete from public.brigadier_groups where id = any (small) and club_id = p_club;
    end if;
    delete from public.club_profiles where club_id = p_club and profile_id = pid;
  end if;

  -- belongs to no club any more: delete the shared profile and the login record
  if not exists (select 1 from public.club_access where email = e)
     and (pid is null or not exists (select 1 from public.club_profiles where profile_id = pid)) then
    if pid is not null then
      delete from public.profiles where id = pid;
    end if;
    delete from public.members where lower(email) = e;
  end if;
end;
$$;

-- Change a person's email everywhere (their access in every club and their profile), keeping
-- everything else. The caller must be a super admin, or an admin of every club the person is in.
-- The card is unlinked from the old login unless that login already uses the new email; the next
-- sign-in with the new email links it again.
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
  pid uuid;
begin
  if n is null or n !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'The new email address does not look right.' using errcode = '22023';
  end if;
  if o = n then
    raise exception 'The new email is the same as the old one.' using errcode = '22023';
  end if;
  if o = public.current_confirmed_email() then
    raise exception 'You cannot change your own email here. Ask another admin.' using errcode = '42501';
  end if;
  select id into pid from public.profiles where email = o;
  if pid is null and not exists (select 1 from public.club_access where email = o) then
    raise exception 'That email is not on any list and has no card.' using errcode = 'P0002';
  end if;
  if not public.is_super_admin() and (
       exists (select 1 from public.club_access a where a.email = o and not public.is_admin(a.club_id))
    or exists (select 1 from public.club_profiles cp where cp.profile_id = pid and not public.is_admin(cp.club_id))
    or not (exists (select 1 from public.club_access a where a.email = o)
            or exists (select 1 from public.club_profiles cp where cp.profile_id = pid))
  ) then
    raise exception 'This person is also in a club you do not manage. Ask a super admin.' using errcode = '42501';
  end if;
  if exists (select 1 from public.club_access where email = n)
     or exists (select 1 from public.profiles where email = n) then
    raise exception 'The new email is already used by someone else.' using errcode = '23505';
  end if;

  update public.club_access set email = n where email = o;
  update public.profiles p
    set email = n,
        member_id = case
          when p.member_id is not null
               and (select lower(u.email) from auth.users u where u.id = p.member_id) = n
            then p.member_id
          else null
        end
    where p.id = pid;
end;
$$;

-- Creates a brigadier group in a club (p_group_id null) or replaces the members of one.
-- Every member must have a card in that club. Returns the group id.
create or replace function public.admin_save_brigadier_group(p_club integer, p_group_id integer, p_profile_ids uuid[],
                                                             p_is_godson smallint[] default null)
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
  if not public.is_admin(p_club) then
    raise exception 'Only admins of this club can change brigadier groups.' using errcode = '42501';
  end if;
  if cardinality(ids) = 0 then
    raise exception 'A brigadier group needs at least one member.' using errcode = '22023';
  end if;
  if (select count(*) from public.club_profiles where club_id = p_club and profile_id = any (ids)) <> cardinality(ids) then
    raise exception 'Everyone in a brigadier group must have a card in this club. Reload and try again.' using errcode = '23503';
  end if;
  if p_is_godson is not null then
    if cardinality(p_is_godson) <> cardinality(p_profile_ids) then
      raise exception 'Godfather / godson values must match the members.' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_is_godson) v where v is not null and v not in (0, 1)) then
      raise exception 'Godfather / godson must be 0, 1 or empty.' using errcode = '22023';
    end if;
  end if;

  if gid is null then
    insert into public.brigadier_groups (club_id) values (p_club) returning id into gid;
  elsif not exists (select 1 from public.brigadier_groups where id = gid and club_id = p_club) then
    raise exception 'That brigadier group no longer exists.' using errcode = 'P0002';
  end if;

  delete from public.brigadier_group_members where group_id = gid and not (profile_id = any (ids));
  insert into public.brigadier_group_members (group_id, profile_id)
  select gid, x from unnest(ids) as x
  on conflict do nothing;

  if p_is_godson is not null then
    update public.brigadier_group_members m
    set is_godson = v.r
    from (select distinct on (x) x, r from unnest(p_profile_ids, p_is_godson) with ordinality as u(x, r, o)
          where x is not null order by x, o) v
    where m.group_id = gid and m.profile_id = v.x;
  end if;

  return gid;
end;
$$;

create or replace function public.admin_delete_brigadier_group(p_club integer, p_group_id integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(p_club) then
    raise exception 'Only admins of this club can change brigadier groups.' using errcode = '42501';
  end if;
  delete from public.brigadier_groups where id = p_group_id and club_id = p_club;
  if not found then
    raise exception 'That brigadier group no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.clubs                   enable row level security;
alter table public.club_access             enable row level security;
alter table public.super_admins            enable row level security;
alter table public.members                 enable row level security;
alter table public.profiles                enable row level security;
alter table public.club_profiles           enable row level security;
alter table public.brigadier_groups        enable row level security;
alter table public.brigadier_group_members enable row level security;

drop policy if exists "signed-in people read clubs" on public.clubs;
create policy "signed-in people read clubs" on public.clubs
  for select to authenticated using (true);

drop policy if exists "club admins read their club's access list" on public.club_access;
drop policy if exists "club admins change access settings"        on public.club_access;
create policy "club admins read their club's access list" on public.club_access
  for select to authenticated using ((select public.is_admin(club_id)));
create policy "club admins change access settings" on public.club_access
  for update to authenticated
  using ((select public.is_admin(club_id)))
  with check ((select public.is_admin(club_id)));

drop policy if exists "super admins read super admins" on public.super_admins;
create policy "super admins read super admins" on public.super_admins
  for select to authenticated using ((select public.is_super_admin()));

drop policy if exists "people read own login record, admins read their members" on public.members;
create policy "people read own login record, admins read their members" on public.members
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_super_admin())
    or exists (select 1 from public.club_access a where a.email = lower(members.email) and public.is_admin(a.club_id))
  );

drop policy if exists "people read own profile, admins read their members'" on public.profiles;
drop policy if exists "people update own profile, admins their members'"   on public.profiles;
create policy "people read own profile, admins read their members'" on public.profiles
  for select to authenticated
  using (id = (select public.current_profile_id()) or public.can_admin_profile(id));
create policy "people update own profile, admins their members'" on public.profiles
  for update to authenticated
  using (id = (select public.current_profile_id()) or public.can_admin_profile(id))
  with check (id = (select public.current_profile_id()) or public.can_admin_profile(id));

drop policy if exists "people read own club cards, club admins read all" on public.club_profiles;
drop policy if exists "people update own club cards, club admins all"   on public.club_profiles;
create policy "people read own club cards, club admins read all" on public.club_profiles
  for select to authenticated
  using ((profile_id = (select public.current_profile_id()) and public.is_member(club_id)) or public.is_admin(club_id));
create policy "people update own club cards, club admins all" on public.club_profiles
  for update to authenticated
  using ((profile_id = (select public.current_profile_id()) and public.is_member(club_id)) or public.is_admin(club_id))
  with check ((profile_id = (select public.current_profile_id()) and public.is_member(club_id)) or public.is_admin(club_id));

drop policy if exists "club admins read brigadier groups"        on public.brigadier_groups;
drop policy if exists "club admins read brigadier group members" on public.brigadier_group_members;
create policy "club admins read brigadier groups" on public.brigadier_groups
  for select to authenticated using (public.is_admin(club_id));
create policy "club admins read brigadier group members" on public.brigadier_group_members
  for select to authenticated
  using (exists (select 1 from public.brigadier_groups g where g.id = group_id and public.is_admin(g.club_id)));

-- ---------------------------------------------------------------------------
-- Privileges (new tables are not exposed automatically). Nothing for anon.
-- Writes other than those granted here go through the admin functions above.
-- ---------------------------------------------------------------------------

revoke all on table public.clubs, public.club_access, public.super_admins, public.members,
                    public.profiles, public.club_profiles, public.brigadier_groups,
                    public.brigadier_group_members
  from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on table public.clubs, public.club_access, public.super_admins, public.members,
                      public.profiles, public.club_profiles, public.brigadier_groups,
                      public.brigadier_group_members
  to authenticated;
grant update (needs_profile)                                            on table public.club_access   to authenticated;
grant update (display_name, phone, photo_path)                          on table public.profiles      to authenticated;
grant update (bio, show_email, show_phone, listed, foreign_member, override_photo_path,
              occupation, other_clubs, address, show_address, member_number, club_role) on table public.club_profiles to authenticated;

-- every function: nothing for public or anon
revoke execute on function public.current_confirmed_email()                         from public, anon, authenticated;
revoke execute on function public.co_brigadier_names(integer, uuid)                 from public, anon, authenticated;
revoke execute on function public.member_relations(integer, uuid)                   from public, anon, authenticated;
revoke execute on function public.club_access_before_insert()                       from public, anon, authenticated;
revoke execute on function public.club_access_protect_admins()                      from public, anon, authenticated;
revoke execute on function public.profiles_before_write()                           from public, anon, authenticated;
revoke execute on function public.club_profiles_before_write()                      from public, anon, authenticated;
revoke execute on function public.is_super_admin()                                  from public, anon;
revoke execute on function public.my_access(integer)                                from public, anon;
revoke execute on function public.is_member(integer)                                from public, anon;
revoke execute on function public.is_admin(integer)                                 from public, anon;
revoke execute on function public.has_any_access()                                  from public, anon;
revoke execute on function public.my_clubs()                                        from public, anon;
revoke execute on function public.current_profile_id()                              from public, anon;
revoke execute on function public.can_admin_profile(uuid)                           from public, anon;
revoke execute on function public.profile_id_from_path(text)                        from public, anon;
revoke execute on function public.claim_membership()                                from public, anon;
revoke execute on function public.my_co_brigadiers(integer)                         from public, anon;
revoke execute on function public.directory(integer)                                from public, anon;
revoke execute on function public.admin_add_member(integer, text, text, text, boolean, boolean, boolean) from public, anon;
revoke execute on function public.admin_remove_access(integer, text, boolean)       from public, anon;
revoke execute on function public.admin_remove_from_club_preview(integer, text)     from public, anon;
revoke execute on function public.admin_remove_from_club(integer, text, boolean)    from public, anon;
revoke execute on function public.admin_change_email(text, text)                    from public, anon;
revoke execute on function public.admin_save_brigadier_group(integer, integer, uuid[], smallint[]) from public, anon;
revoke execute on function public.admin_delete_brigadier_group(integer, integer)    from public, anon;

-- signed-in people (row-level security and the checks inside each function still decide)
grant execute on function public.is_super_admin()                                  to authenticated;
grant execute on function public.my_access(integer)                                to authenticated;
grant execute on function public.is_member(integer)                                to authenticated;
grant execute on function public.is_admin(integer)                                 to authenticated;
grant execute on function public.has_any_access()                                  to authenticated;
grant execute on function public.my_clubs()                                        to authenticated;
grant execute on function public.current_profile_id()                              to authenticated;
grant execute on function public.can_admin_profile(uuid)                           to authenticated;
grant execute on function public.profile_id_from_path(text)                        to authenticated;
grant execute on function public.claim_membership()                                to authenticated;
grant execute on function public.my_co_brigadiers(integer)                         to authenticated;
grant execute on function public.directory(integer)                                to authenticated;
grant execute on function public.admin_add_member(integer, text, text, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.admin_remove_access(integer, text, boolean)       to authenticated;
grant execute on function public.admin_remove_from_club_preview(integer, text)     to authenticated;
grant execute on function public.admin_remove_from_club(integer, text, boolean)    to authenticated;
grant execute on function public.admin_change_email(text, text)                    to authenticated;
grant execute on function public.admin_save_brigadier_group(integer, integer, uuid[], smallint[]) to authenticated;
grant execute on function public.admin_delete_brigadier_group(integer, integer)    to authenticated;

-- ---------------------------------------------------------------------------
-- Headshots: a PRIVATE storage bucket. Main photo at <profile id>/avatar.jpg (shared by all the
-- person's clubs); optional club photos at <profile id>/club-<club id>.jpg, shown in that club instead.
-- Shown through signed links that expire after an hour.
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
drop policy if exists "headshots: club members view"                      on storage.objects;
drop policy if exists "headshots: upload own, club admins their members'" on storage.objects;
drop policy if exists "headshots: replace own, club admins their members'" on storage.objects;
drop policy if exists "headshots: delete own, club admins their members'" on storage.objects;

create policy "headshots: club members view" on storage.objects
  for select to authenticated
  using (bucket_id = 'headshots' and (select public.has_any_access()));

create policy "headshots: upload own, club admins their members'" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'headshots'
    and public.profile_id_from_path(name) is not null
    and (public.profile_id_from_path(name) = (select public.current_profile_id())
         or public.can_admin_profile(public.profile_id_from_path(name)))
  );

create policy "headshots: replace own, club admins their members'" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'headshots'
    and public.profile_id_from_path(name) is not null
    and (public.profile_id_from_path(name) = (select public.current_profile_id())
         or public.can_admin_profile(public.profile_id_from_path(name)))
  )
  with check (
    bucket_id = 'headshots'
    and public.profile_id_from_path(name) is not null
    and (public.profile_id_from_path(name) = (select public.current_profile_id())
         or public.can_admin_profile(public.profile_id_from_path(name)))
  );

create policy "headshots: delete own, club admins their members'" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'headshots'
    and public.profile_id_from_path(name) is not null
    and (public.profile_id_from_path(name) = (select public.current_profile_id())
         or public.can_admin_profile(public.profile_id_from_path(name)))
  );

-- Make the site's API see the changes straight away.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Recos: members' restaurant recommendations (see migrations/007_recos.sql for the full notes).
-- venues = a restaurant; reco_comments = a member's recommendation of it, posted as one of
-- their clubs, visible to 'everyone' (any club), 'club' (that club) or 'me' (the author).
-- ---------------------------------------------------------------------------

create table if not exists public.venues (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  address      text,
  lat          double precision not null,
  lng          double precision not null,
  external_id  text,             -- a map provider's id for the place (e.g. 'osm:N123'), when known
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint venues_name_shape    check (btrim(name) <> '' and char_length(name) <= 120),
  constraint venues_address_len   check (address is null or char_length(address) <= 300),
  constraint venues_lat_range     check (lat between -90 and 90),
  constraint venues_lng_range     check (lng between -180 and 180),
  constraint venues_external_len  check (external_id is null or char_length(external_id) <= 200)
);
create index if not exists venues_external_idx on public.venues (external_id);

create table if not exists public.reco_comments (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  club_id     integer not null references public.clubs (id),
  body        text not null,
  visibility  text not null default 'everyone',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint reco_comments_body_shape  check (btrim(body) <> '' and char_length(body) <= 300),
  constraint reco_comments_visibility  check (visibility in ('everyone', 'club', 'me'))
);
create index if not exists reco_comments_venue_idx   on public.reco_comments (venue_id);
create index if not exists reco_comments_profile_idx on public.reco_comments (profile_id);

alter table public.venues   enable row level security;
alter table public.reco_comments enable row level security;

-- ---------------------------------------------------------------------------
-- Who can see what
-- ---------------------------------------------------------------------------

-- Can the signed-in person see a comment with these settings?
create or replace function public.can_see_reco_comment(p_visibility text, p_club integer, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.has_any_access() then false
    when public.is_super_admin() then true
    when p_profile is not null and p_profile = public.current_profile_id() then true
    when p_visibility = 'everyone' then true
    when p_visibility = 'club' then public.is_member(p_club)
    else false
  end;
$$;

-- Can the signed-in person see this place? (one visible comment, or they created it)
create or replace function public.can_see_reco_place(p_place uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_access() and (
    exists (select 1 from public.reco_comments c
            where c.venue_id = p_place and public.can_see_reco_comment(c.visibility, c.club_id, c.profile_id))
    or exists (select 1 from public.venues p
               where p.id = p_place and p.created_by is not null and p.created_by = public.current_profile_id())
  );
$$;

-- "Name lower-cased, accents and punctuation removed", for comparing restaurant names.
create or replace function public.reco_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           translate(lower(coalesce(p_name, '')),
                     'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', 'aaaaaaceeeeiiiinooooouuuuyyoa'),
           '[^a-z0-9]+', '', 'g');
$$;

-- Distance in metres between two points (haversine).
create or replace function public.reco_distance_m(lat1 double precision, lng1 double precision,
                                                  lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
           + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- Does a stored place match what someone is adding? Same provider id, or within about 30 metres
-- with a similar name (equal, or one contained in the other, ignoring case, accents and punctuation).
create or replace function public.reco_place_matches(p_place public.venues, p_name text,
                                                     p_lat double precision, p_lng double precision,
                                                     p_external_id text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_external_id is not null and p_place.external_id = p_external_id)
      or (public.reco_distance_m(p_place.lat, p_place.lng, p_lat, p_lng) <= 30
          and length(public.reco_name_key(p_name)) >= 3
          and (public.reco_name_key(p_place.name) = public.reco_name_key(p_name)
               or strpos(public.reco_name_key(p_place.name), public.reco_name_key(p_name)) > 0
               or strpos(public.reco_name_key(p_name), public.reco_name_key(p_place.name)) > 0));
$$;

-- Duplicate check for the add form: a matching place the viewer can SEE, or nothing.
create or replace function public.find_reco_place(p_name text, p_lat double precision, p_lng double precision,
                                                  p_external_id text default null)
returns table (id uuid, name text, address text, lat double precision, lng double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.address, p.lat, p.lng
  from public.venues p
  where public.has_any_access()
    and public.reco_place_matches(p, p_name, p_lat, p_lng, nullif(btrim(p_external_id), ''))
    and public.can_see_reco_place(p.id)
  order by (p.external_id is not distinct from nullif(btrim(p_external_id), '')) desc,
           public.reco_distance_m(p.lat, p.lng, p_lat, p_lng)
  limit 1;
$$;

-- Add a reco. Attaches the comment to:
--   1. p_venue_id, when given and visible to the caller (they confirmed "Already recommended");
--   2. otherwise any matching place, visible or not (the caller is told nothing about a hidden one);
--   3. otherwise a new place.
-- The caller must have a profile and belong to p_club. Returns the place id and the comment id.
create or replace function public.add_reco(
  p_club integer,
  p_name text,
  p_address text,
  p_lat double precision,
  p_lng double precision,
  p_external_id text,
  p_body text,
  p_visibility text default 'everyone',
  p_venue_id uuid default null
)
returns table (venue_id uuid, comment_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_profile_id();
  ext text := nullif(btrim(p_external_id), '');
  pid uuid;
  cid uuid;
begin
  if me is null then
    raise exception 'You need a member profile to add a reco.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.club_access a
                 where a.club_id = p_club and a.email = public.current_confirmed_email()) then
    raise exception 'You can only post as a club you belong to.' using errcode = '42501';
  end if;
  if coalesce(p_visibility, '') not in ('everyone', 'club', 'me') then
    raise exception 'Visibility must be everyone, club or me.' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'The location is missing or not valid.' using errcode = '22023';
  end if;

  -- serialise adds so two members adding the same place at once share one place
  perform pg_advisory_xact_lock(hashtext('public.venues.add'));

  if p_venue_id is not null and public.can_see_reco_place(p_venue_id) then
    pid := p_venue_id;
  end if;

  if pid is null then
    select p.id into pid
    from public.venues p
    where public.reco_place_matches(p, p_name, p_lat, p_lng, ext)
    order by (p.external_id is not distinct from ext) desc, public.reco_distance_m(p.lat, p.lng, p_lat, p_lng)
    limit 1;
  end if;

  if pid is null then
    insert into public.venues (name, address, lat, lng, external_id, created_by)
    values (btrim(p_name), nullif(btrim(p_address), ''), p_lat, p_lng, ext, me)
    returning id into pid;
  end if;

  insert into public.reco_comments (venue_id, profile_id, club_id, body, visibility)
  values (pid, me, p_club, btrim(p_body), p_visibility)
  returning id into cid;

  return query select pid, cid;
end;
$$;

-- "Jean-Baptiste Solanet" -> "Jean-Baptiste S."; "Merry de Dreux-Brézé" -> "Merry D."
create or replace function public.reco_author_label(p_display_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[] := regexp_split_to_array(btrim(coalesce(p_display_name, '')), '\s+');
  i integer;
begin
  if coalesce(array_length(parts, 1), 0) = 0 or parts[1] = '' then
    return 'Member';
  end if;
  if array_length(parts, 1) = 1 then
    return parts[1];
  end if;
  -- the family name's first capitalised word (skips particles such as "de", "van")
  for i in 2 .. array_length(parts, 1) loop
    if left(parts[i], 1) <> lower(left(parts[i], 1)) then
      return parts[1] || ' ' || upper(left(parts[i], 1)) || '.';
    end if;
  end loop;
  return parts[1] || ' ' || upper(left(parts[array_length(parts, 1)], 1)) || '.';
end;
$$;

-- Everything the Recos map shows: the visible places and, for each, its visible comments, with the
-- author shown as "First L." and the club's name. Never emails or phones.
create or replace function public.reco_feed()
returns table (
  venue_id      uuid,
  venue_name    text,
  address       text,
  lat           double precision,
  lng           double precision,
  comment_id    uuid,
  author_label  text,
  club_id       integer,
  club_name     text,
  body          text,
  visibility    text,
  created_at    timestamptz,
  updated_at    timestamptz,
  is_mine       boolean,
  can_delete    boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.address, p.lat, p.lng,
         c.id, public.reco_author_label(pr.display_name), c.club_id, cl.name, c.body, c.visibility,
         c.created_at, c.updated_at,
         coalesce(c.profile_id = public.current_profile_id(), false),
         coalesce(c.profile_id = public.current_profile_id() or public.is_admin(c.club_id), false)
  from public.venues p
  left join public.reco_comments c
    on c.venue_id = p.id and public.can_see_reco_comment(c.visibility, c.club_id, c.profile_id)
  left join public.profiles pr on pr.id = c.profile_id
  left join public.clubs cl on cl.id = c.club_id
  where public.has_any_access()
    and public.can_see_reco_place(p.id)
  order by p.name, c.created_at desc nulls last;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Tidy text; only body and visibility change after posting.
create or replace function public.reco_comments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.body := btrim(new.body);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.venue_id := old.venue_id;
    new.profile_id := old.profile_id;
    new.club_id := old.club_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists reco_comments_before_write on public.reco_comments;
create trigger reco_comments_before_write
  before insert or update on public.reco_comments
  for each row execute function public.reco_comments_before_write();

-- Deleting the last comment on a place deletes the place.
create or replace function public.reco_comments_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- the last reco gone: remove the venue, unless a club event (a dinner) uses it
  delete from public.venues p
  where p.id = old.venue_id
    and not exists (select 1 from public.reco_comments c where c.venue_id = old.venue_id)
    and not exists (select 1 from public.club_events e where e.venue_id = old.venue_id);
  return old;
end;
$$;

drop trigger if exists reco_comments_after_delete on public.reco_comments;
create trigger reco_comments_after_delete
  after delete on public.reco_comments
  for each row execute function public.reco_comments_after_delete();

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------

drop policy if exists "people see reco places they can see"    on public.venues;
drop policy if exists "people see reco comments they can see"  on public.reco_comments;
drop policy if exists "authors edit their own reco comments"   on public.reco_comments;
drop policy if exists "authors, club admins and super admins delete reco comments" on public.reco_comments;

create policy "people see reco places they can see" on public.venues
  for select to authenticated
  using (public.can_see_reco_place(id));

create policy "people see reco comments they can see" on public.reco_comments
  for select to authenticated
  using (public.can_see_reco_comment(visibility, club_id, profile_id));

create policy "authors edit their own reco comments" on public.reco_comments
  for update to authenticated
  using (profile_id = (select public.current_profile_id()))
  with check (profile_id = (select public.current_profile_id()));

create policy "authors, club admins and super admins delete reco comments" on public.reco_comments
  for delete to authenticated
  using (
    profile_id = (select public.current_profile_id())
    or public.is_admin(club_id)
    or (select public.is_super_admin())
  );

revoke all on table public.venues, public.reco_comments from public, anon, authenticated;
-- places: never who created them or when (that would reveal a place's history)
grant select (id, name, address, lat, lng, external_id) on table public.venues to authenticated;
grant select (id, venue_id, club_id, body, visibility, created_at, updated_at) on table public.reco_comments to authenticated;
grant update (body, visibility) on table public.reco_comments to authenticated;
grant delete on table public.reco_comments to authenticated;
-- new places and comments only through add_reco()

revoke execute on function public.can_see_reco_comment(text, integer, uuid)          from public, anon;
revoke execute on function public.can_see_reco_place(uuid)                           from public, anon;
revoke execute on function public.reco_name_key(text)                                from public, anon, authenticated;
revoke execute on function public.reco_distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.reco_place_matches(public.venues, text, double precision, double precision, text) from public, anon, authenticated;
revoke execute on function public.reco_author_label(text)                            from public, anon, authenticated;
revoke execute on function public.find_reco_place(text, double precision, double precision, text) from public, anon;
revoke execute on function public.add_reco(integer, text, text, double precision, double precision, text, text, text, uuid) from public, anon;
revoke execute on function public.reco_feed()                                        from public, anon;
revoke execute on function public.reco_comments_before_write()                       from public, anon, authenticated;
revoke execute on function public.reco_comments_after_delete()                       from public, anon, authenticated;

grant execute on function public.can_see_reco_comment(text, integer, uuid)          to authenticated;
grant execute on function public.can_see_reco_place(uuid)                           to authenticated;
grant execute on function public.find_reco_place(text, double precision, double precision, text) to authenticated;
grant execute on function public.add_reco(integer, text, text, double precision, double precision, text, text, text, uuid) to authenticated;
grant execute on function public.reco_feed()                                        to authenticated;


-- ---------------------------------------------------------------------------
-- Club events, activity feed and the My clubs | All clubs scope (see migrations/009_activity_feed.sql)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Club events (dinners): ready for the two dinner maps' Google Sheets, not used by the site yet.
-- One row per dinner, at a venue (the same venues as Recos, so a restaurant is one pin for both).
-- Brigadiers are stored as the names written at the time (a JSON array of text), so later name
-- changes do not rewrite history. Ratings are out of the club's rating_scale (clubs table: The Nines
-- 10, Les Ronds 20); sheet columns: bottles = wine, plate = food, atmosphere = vibe.
-- Nobody can read or write it from the site yet (no permissions granted): it is filled by the
-- office in the SQL editor or by an import script.
-- ---------------------------------------------------------------------------
create table if not exists public.club_events (
  id            uuid primary key default gen_random_uuid(),
  club_id       integer not null references public.clubs (id),
  venue_id      uuid not null references public.venues (id) on delete restrict,
  event_date    date,                          -- when known
  season        text,                          -- as written in the sheet, e.g. "Season 3"
  month         text,                          -- as written in the sheet, e.g. "March 2025"
  brigadiers    jsonb not null default '[]'::jsonb,   -- ["First Last", ...]
  rating_wine   numeric(5,2),                  -- out of the club's rating_scale (clubs table)
  rating_food   numeric(5,2),
  rating_vibe   numeric(5,2),
  menu_url      text,
  notes         text,
  source_ref    text,                          -- the sheet's own id for the row, for re-runnable imports
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint club_events_brigadiers_shape check (
    jsonb_typeof(brigadiers) = 'array'
    and not jsonb_path_exists(brigadiers, '$[*] ? (@.type() != "string")')),
  constraint club_events_ratings_positive check (coalesce(rating_wine, 0) >= 0 and coalesce(rating_food, 0) >= 0 and coalesce(rating_vibe, 0) >= 0),
  constraint club_events_menu_url      check (menu_url is null or menu_url ~ '^https://'
                                              or menu_url ~ '^menus/[a-z0-9-]+/[A-Za-z0-9._-]+\.(pdf|jpe?g|png|webp|heic)$'),
  constraint club_events_text_lengths  check (char_length(coalesce(season, '')) <= 60 and char_length(coalesce(month, '')) <= 60
                                              and char_length(coalesce(notes, '')) <= 2000 and char_length(coalesce(source_ref, '')) <= 60),
  constraint club_events_source_ref_key unique (club_id, source_ref)
);
create index if not exists club_events_club_date_idx on public.club_events (club_id, event_date desc);
create index if not exists club_events_venue_idx     on public.club_events (venue_id);

create or replace function public.club_events_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  scale smallint;
begin
  new.season := nullif(btrim(new.season), '');
  new.month := nullif(btrim(new.month), '');
  new.notes := nullif(btrim(new.notes), '');
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  -- ratings may not exceed the club's scale (clubs.rating_scale: 10 for The Nines, 20 for Les Ronds)
  select c.rating_scale into scale from public.clubs c where c.id = new.club_id;
  if greatest(new.rating_wine, new.rating_food, new.rating_vibe) > scale then
    raise exception 'Ratings for this club are out of %.', scale using errcode = '23514';
  end if;
  if new.brigadier_group_id is not null and not exists (
       select 1 from public.brigadier_groups g where g.id = new.brigadier_group_id and g.club_id = new.club_id) then
    raise exception 'That brigadier group belongs to another club.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists club_events_before_write on public.club_events;
create trigger club_events_before_write
  before insert or update on public.club_events
  for each row execute function public.club_events_before_write();

alter table public.club_events enable row level security;
revoke all on table public.club_events from public, anon, authenticated;
revoke execute on function public.club_events_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists reco_comments_created_idx       on public.reco_comments (created_at desc, id desc);
create index if not exists reco_comments_venue_created_idx on public.reco_comments (venue_id, created_at, id);
create index if not exists reco_comments_profile_created_idx on public.reco_comments (profile_id, created_at desc);
create index if not exists club_access_email_idx           on public.club_access (email);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- For one comment the signed-in member can see: is it theirs, the author as "First L.", and does the
-- author belong to a club the member belongs to. Returns no row for a comment they cannot see.
-- (Signed-in members cannot read reco_comments.profile_id directly; this gives only these facts.)
create or replace function public.reco_comment_facts(p_comment uuid)
returns table (is_mine boolean, author_label text, shares_club boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(c.profile_id = public.current_profile_id(), false),
         public.reco_author_label(pr.display_name),
         exists (select 1 from public.club_access a where a.email = pr.email and public.is_member(a.club_id))
  from public.reco_comments c
  join public.profiles pr on pr.id = c.profile_id
  where c.id = p_comment
    and public.can_see_reco_comment(c.visibility, c.club_id, c.profile_id);
$$;

-- "Postcode or area" from a free-text address: a UK postcode ("EC1M 4AY"), a French postcode and town
-- ("75011 Paris"), otherwise the last part of the address.
create or replace function public.reco_area(p_address text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_address is null or btrim(p_address) = '' then null
    when p_address ~* '\m[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}\M'
      then upper(substring(p_address from '(?i)\m([A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2})\M'))
    when p_address ~ '\m[0-9]{5}\s+[^,]+'
      then btrim(substring(p_address from '\m([0-9]{5}\s+[^,]+)'))
    else left(btrim(regexp_replace(p_address, '^.*,', '')), 40)
  end;
$$;

-- ---------------------------------------------------------------------------
-- The home feed
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The member's own recos and comments (home page, "My activity"). Not affected by the scope.
-- Whether a comment counts as "added" is judged on the comments the member can see, so it never
-- hints at a hidden earlier comment.
-- ---------------------------------------------------------------------------
create or replace function public.my_reco_activity(
  p_limit  integer     default 20,
  p_before timestamptz default null
)
returns table (
  event_type   text,
  created_at   timestamptz,
  comment_id   uuid,
  venue_id     uuid,
  venue_name   text,
  area         text,
  club_name    text,
  visibility   text,
  stars        smallint,
  price_level  smallint,
  snippet      text,
  image_path   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when exists (
      select 1 from public.reco_comments e
      where e.venue_id = c.venue_id and (e.created_at, e.id) < (c.created_at, c.id)
        and public.can_see_reco_comment(e.visibility, e.club_id, e.profile_id)
    ) then 'comment_added' else 'reco_added' end,
    c.created_at, c.id, p.id, p.name, public.reco_area(p.address), cl.name, c.visibility,
    null::smallint, null::smallint,
    case when char_length(c.body) > 140 then rtrim(left(c.body, 139)) || '…' else c.body end,
    null::text
  from public.reco_comments c
  join public.venues p on p.id = c.venue_id
  left join public.clubs cl on cl.id = c.club_id
  where public.has_any_access()
    and public.current_profile_id() is not null
    and c.profile_id = public.current_profile_id()
    and (p_before is null or c.created_at < p_before)
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- The Recos map's "My clubs" view: the restaurants with at least one comment that is the member's own
-- or by a member of their clubs, under the same visibility rules as the feed. ("All clubs" on the map
-- shows every pin the member can see, as before.)
-- ---------------------------------------------------------------------------
create or replace function public.reco_scope_venue_ids(p_scope text default 'my_clubs')
returns setof uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_scope is null or p_scope not in ('my_clubs', 'all_clubs') then
    raise exception 'Scope must be my_clubs or all_clubs.' using errcode = '22023';
  end if;
  return query
  select distinct c.venue_id
  from public.reco_comments c
  cross join lateral public.reco_comment_facts(c.id) f
  where public.has_any_access()
    and (f.is_mine
         or (c.visibility <> 'me'
             and (c.visibility <> 'club' or public.is_member(c.club_id))
             and (f.shares_club or (p_scope = 'all_clubs' and c.visibility = 'everyone'))));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: signed-in people only
-- ---------------------------------------------------------------------------
revoke execute on function public.reco_comment_facts(uuid)                          from public, anon;
revoke execute on function public.reco_area(text)                                   from public, anon;
revoke execute on function public.my_reco_activity(integer, timestamptz)            from public, anon;
revoke execute on function public.reco_scope_venue_ids(text)                        from public, anon;
grant execute on function public.reco_comment_facts(uuid)                           to authenticated;
grant execute on function public.reco_area(text)                                    to authenticated;
grant execute on function public.my_reco_activity(integer, timestamptz)             to authenticated;
grant execute on function public.reco_scope_venue_ids(text)                         to authenticated;

-- ---------------------------------------------------------------------------
-- Dinner menus: private storage bucket, one folder per club (see migrations/010_menus.sql)
-- ---------------------------------------------------------------------------

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

revoke execute on function public.menu_club_from_path(text) from public, anon;
grant execute on function public.menu_club_from_path(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Dinner calendar and replies (see migrations/011_dinner_calendar.sql)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
alter table public.club_events add column if not exists brigadier_group_id integer
  references public.brigadier_groups (id) on delete set null;
alter table public.club_events add column if not exists rsvp_status text not null default 'not_open';
alter table public.club_events add column if not exists rsvp_deadline timestamptz;
alter table public.club_events drop constraint if exists club_events_rsvp_status;
alter table public.club_events add constraint club_events_rsvp_status check (rsvp_status in ('not_open', 'open', 'closed'));
alter table public.club_events alter column venue_id drop not null;
create index if not exists club_events_group_idx on public.club_events (brigadier_group_id);

alter table public.clubs add column if not exists timezone text not null default 'Europe/London';
update public.clubs set timezone = 'Europe/Paris' where id = 2 and timezone = 'Europe/London';

create table if not exists public.club_event_answers (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.club_events (id) on delete cascade,
  profile_id         uuid not null references public.profiles (id) on delete cascade,
  answer             text not null,
  first_answered_at  timestamptz not null default now(),
  last_changed_at    timestamptz not null default now(),
  set_by             text not null default 'member',
  locked_by_admin    boolean not null default false,
  constraint club_event_answers_answer check (answer in ('attending', 'not_attending')),
  constraint club_event_answers_set_by check (set_by in ('member', 'admin')),
  constraint club_event_answers_one_per_person unique (event_id, profile_id)
);
create index if not exists club_event_answers_profile_idx on public.club_event_answers (profile_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The club a dinner belongs to (for access rules; members cannot read club_events directly).
create or replace function public.club_event_club(p_event uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select e.club_id from public.club_events e where e.id = p_event;
$$;

-- Is this person a current member of the club (a card in the club and access to it)?
create or replace function public.is_club_member_profile(p_club integer, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.club_profiles cp
    join public.profiles p on p.id = cp.profile_id
    where cp.club_id = p_club and cp.profile_id = p_profile
      and exists (select 1 from public.club_access a where a.club_id = p_club and a.email = p.email)
  );
$$;


-- ---------------------------------------------------------------------------
-- Members: reply, and the home page panel
-- ---------------------------------------------------------------------------

-- Reply to a dinner. Returns 'ok', or why not: 'not_member', 'closed', 'deadline_passed', 'locked'.
-- Server time only. A change is allowed only within 1 hour of the FIRST reply and while not locked.
create or replace function public.rsvp_answer(p_event uuid, p_answer text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.current_profile_id();
  ev public.club_events%rowtype;
  cur public.club_event_answers%rowtype;
begin
  if p_answer is null or p_answer not in ('attending', 'not_attending') then
    raise exception 'The answer must be attending or not_attending.' using errcode = '22023';
  end if;
  select * into ev from public.club_events where id = p_event;
  if ev.id is null or me is null or not public.is_member(ev.club_id) then
    return 'not_member';
  end if;
  if ev.rsvp_status <> 'open' then
    return 'closed';
  end if;
  if ev.rsvp_deadline is not null and now() >= ev.rsvp_deadline then
    return 'deadline_passed';
  end if;

  insert into public.club_event_answers (event_id, profile_id, answer, first_answered_at, last_changed_at, set_by)
  values (p_event, me, p_answer, now(), now(), 'member')
  on conflict (event_id, profile_id) do nothing;
  if found then
    return 'ok';
  end if;

  select * into cur from public.club_event_answers
  where event_id = p_event and profile_id = me
  for update;
  if cur.locked_by_admin or now() - cur.first_answered_at >= interval '1 hour' then
    return 'locked';
  end if;
  if cur.answer <> p_answer then
    update public.club_event_answers
    set answer = p_answer, last_changed_at = now(), set_by = 'member'
    where id = cur.id;
  end if;
  return 'ok';
end;
$$;

-- The home page panel for one club: the nearest upcoming dinner that is open or closed for replies
-- (event_date today or later in the club's time zone); 'not_open' dinners are never shown. With none,
-- the most recent past dinner that has a venue ("Our last dinner at ..."), date and venue only.
create or replace function public.home_dinner_panel(p_club integer)
returns table (
  kind              text,          -- 'upcoming' or 'last'
  event_id          uuid,
  event_date        date,
  venue_name        text,
  rsvp_status       text,
  rsvp_deadline     timestamptz,
  my_answer         text,
  my_answer_set_by  text,
  locked            boolean,       -- the member can no longer change their reply
  can_answer        boolean,       -- the reply button works right now
  can_change_until  timestamptz,   -- first reply + 1 hour, while the member may still change it
  brigadiers        jsonb          -- [{"short_name": "First L.", "photo_path": "<path>" or null}]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := public.current_profile_id();
  today date;
  ev public.club_events%rowtype;
  ans public.club_event_answers%rowtype;
  open_now boolean;
begin
  if not public.is_member(p_club) then
    return;
  end if;
  select (now() at time zone c.timezone)::date into today from public.clubs c where c.id = p_club;

  select * into ev from public.club_events e
  where e.club_id = p_club and e.event_date >= today and e.rsvp_status in ('open', 'closed')
  order by e.event_date, e.created_at
  limit 1;

  if ev.id is null then
    return query
    select 'last'::text, e.id, e.event_date, v.name, null::text, null::timestamptz, null::text, null::text,
           null::boolean, false, null::timestamptz, '[]'::jsonb
    from public.club_events e
    join public.venues v on v.id = e.venue_id
    where e.club_id = p_club and e.event_date < today
    order by e.event_date desc, e.created_at desc
    limit 1;
    return;
  end if;

  if me is not null then
    select * into ans from public.club_event_answers a where a.event_id = ev.id and a.profile_id = me;
  end if;
  open_now := ev.rsvp_status = 'open' and (ev.rsvp_deadline is null or now() < ev.rsvp_deadline);

  return query
  select 'upcoming'::text, ev.id, ev.event_date,
         (select v.name from public.venues v where v.id = ev.venue_id),
         ev.rsvp_status, ev.rsvp_deadline,
         ans.answer, ans.set_by,
         case when ans.id is null then false
              else ans.locked_by_admin or now() - ans.first_answered_at >= interval '1 hour' or not open_now end,
         me is not null and open_now
           and (ans.id is null or (not ans.locked_by_admin and now() - ans.first_answered_at < interval '1 hour')),
         case when ans.id is not null and open_now and not ans.locked_by_admin
                   and now() - ans.first_answered_at < interval '1 hour'
              then ans.first_answered_at + interval '1 hour' end,
         case when ev.brigadier_group_id is not null then
           coalesce((select jsonb_agg(jsonb_build_object(
                        'short_name', public.reco_author_label(p.display_name),
                        'photo_path', coalesce(cp.override_photo_path, p.photo_path))
                      order by p.display_name)
                     from public.brigadier_group_members m
                     join public.profiles p on p.id = m.profile_id
                     left join public.club_profiles cp on cp.profile_id = p.id and cp.club_id = ev.club_id
                     where m.group_id = ev.brigadier_group_id), '[]'::jsonb)
         else
           coalesce((select jsonb_agg(jsonb_build_object('short_name', public.reco_author_label(n), 'photo_path', null))
                     from jsonb_array_elements_text(ev.brigadiers) n), '[]'::jsonb)
         end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admins (club admins of that club only; super admins count as admins of every club)
-- ---------------------------------------------------------------------------

-- Set, force or clear a member's reply. p_answer null clears it. A set reply is locked for the member.
create or replace function public.admin_set_answer(p_event uuid, p_profile uuid, p_answer text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  club integer := public.club_event_club(p_event);
begin
  if club is null or not public.is_admin(club) then
    raise exception 'Only admins of this club can set replies.' using errcode = '42501';
  end if;
  if p_answer is null then
    delete from public.club_event_answers where event_id = p_event and profile_id = p_profile;
    return 'ok';
  end if;
  if p_answer not in ('attending', 'not_attending') then
    raise exception 'The answer must be attending or not_attending.' using errcode = '22023';
  end if;
  if not public.is_club_member_profile(club, p_profile)
     and not exists (select 1 from public.club_event_answers where event_id = p_event and profile_id = p_profile) then
    raise exception 'That person is not a member of this club.' using errcode = 'P0002';
  end if;
  insert into public.club_event_answers (event_id, profile_id, answer, first_answered_at, last_changed_at, set_by, locked_by_admin)
  values (p_event, p_profile, p_answer, now(), now(), 'admin', true)
  on conflict (event_id, profile_id) do update
    set answer = excluded.answer, last_changed_at = now(), set_by = 'admin', locked_by_admin = true;
  return 'ok';
end;
$$;

-- Every current member of the dinner's club with their reply (or nulls), plus anyone who replied
-- and has since left the club (is_member false).
create or replace function public.admin_event_answers(p_event uuid)
returns table (
  profile_id         uuid,
  display_name       text,
  is_member          boolean,
  answer             text,
  first_answered_at  timestamptz,
  last_changed_at    timestamptz,
  set_by             text,
  locked_by_admin    boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  club integer := public.club_event_club(p_event);
begin
  if club is null or not public.is_admin(club) then
    raise exception 'Only admins of this club can see replies.' using errcode = '42501';
  end if;
  return query
  with people as (
    select p.id, p.display_name, true as is_current
    from public.club_profiles cp
    join public.profiles p on p.id = cp.profile_id
    where cp.club_id = club
      and exists (select 1 from public.club_access a where a.club_id = club and a.email = p.email)
    union
    select p.id, p.display_name, false
    from public.club_event_answers a
    join public.profiles p on p.id = a.profile_id
    where a.event_id = p_event and not public.is_club_member_profile(club, p.id)
  )
  select pe.id, pe.display_name, pe.is_current, a.answer, a.first_answered_at, a.last_changed_at, a.set_by, a.locked_by_admin
  from people pe
  left join public.club_event_answers a on a.event_id = p_event and a.profile_id = pe.id
  order by lower(pe.display_name);
end;
$$;

-- Create (p_event null) or edit a dinner: date, optional venue, optional brigadier group.
create or replace function public.admin_save_event(p_club integer, p_event_date date,
                                                   p_venue_id uuid default null,
                                                   p_brigadier_group_id integer default null,
                                                   p_event uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  id_out uuid;
begin
  if not public.is_admin(p_club) then
    raise exception 'Only admins of this club can change its dinners.' using errcode = '42501';
  end if;
  if p_event_date is null then
    raise exception 'Please choose a date.' using errcode = '22023';
  end if;
  if p_venue_id is not null and not exists (select 1 from public.venues v where v.id = p_venue_id) then
    raise exception 'That venue does not exist.' using errcode = 'P0002';
  end if;
  if p_event is null then
    insert into public.club_events (club_id, event_date, venue_id, brigadier_group_id)
    values (p_club, p_event_date, p_venue_id, p_brigadier_group_id)
    returning id into id_out;
  else
    update public.club_events
    set event_date = p_event_date, venue_id = p_venue_id, brigadier_group_id = p_brigadier_group_id
    where id = p_event and club_id = p_club
    returning id into id_out;
    if id_out is null then
      raise exception 'That dinner is not in this club.' using errcode = 'P0002';
    end if;
  end if;
  return id_out;
end;
$$;

create or replace function public.admin_set_rsvp_status(p_event uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  club integer := public.club_event_club(p_event);
begin
  if club is null or not public.is_admin(club) then
    raise exception 'Only admins of this club can change its dinners.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('not_open', 'open', 'closed') then
    raise exception 'The status must be not_open, open or closed.' using errcode = '22023';
  end if;
  update public.club_events set rsvp_status = p_status where id = p_event;
end;
$$;

-- p_deadline null removes the deadline.
create or replace function public.admin_set_rsvp_deadline(p_event uuid, p_deadline timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  club integer := public.club_event_club(p_event);
begin
  if club is null or not public.is_admin(club) then
    raise exception 'Only admins of this club can change its dinners.' using errcode = '42501';
  end if;
  update public.club_events set rsvp_deadline = p_deadline where id = p_event;
end;
$$;

-- The club's dinners for the admin screen, newest first, with reply totals.
create or replace function public.admin_club_events(p_club integer)
returns table (
  event_id            uuid,
  event_date          date,
  venue_id            uuid,
  venue_name          text,
  brigadier_group_id  integer,
  brigadiers          jsonb,      -- names: the group's members, or the names stored on a past dinner
  rsvp_status         text,
  rsvp_deadline       timestamptz,
  attending           integer,
  not_attending       integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin(p_club) then
    raise exception 'Only admins of this club can see its dinners.' using errcode = '42501';
  end if;
  return query
  select e.id, e.event_date, e.venue_id, v.name, e.brigadier_group_id,
         case when e.brigadier_group_id is not null then
           coalesce((select jsonb_agg(p.display_name order by p.display_name)
                     from public.brigadier_group_members m join public.profiles p on p.id = m.profile_id
                     where m.group_id = e.brigadier_group_id), '[]'::jsonb)
         else e.brigadiers end,
         e.rsvp_status, e.rsvp_deadline,
         (select count(*)::integer from public.club_event_answers a where a.event_id = e.id and a.answer = 'attending'),
         (select count(*)::integer from public.club_event_answers a where a.event_id = e.id and a.answer = 'not_attending')
  from public.club_events e
  left join public.venues v on v.id = e.venue_id
  where e.club_id = p_club
  order by e.event_date desc nulls last, e.created_at desc;
end;
$$;

-- Venues an admin may pick for a dinner: those already used by club dinners, plus those they can
-- see through Recos (never a venue known only from someone's private reco).
create or replace function public.admin_venue_options(p_query text)
returns table (id uuid, name text, address text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not exists (select 1 from public.clubs c where public.is_admin(c.id)) then
    raise exception 'Only club admins can choose venues.' using errcode = '42501';
  end if;
  return query
  select v.id, v.name, v.address
  from public.venues v
  where (exists (select 1 from public.club_events e where e.venue_id = v.id) or public.can_see_reco_place(v.id))
    and public.reco_name_key(v.name) like '%' || public.reco_name_key(coalesce(p_query, '')) || '%'
  order by v.name
  limit 20;
end;
$$;

-- The club's brigadier groups with their members' names, for choosing a dinner's group.
create or replace function public.admin_brigadier_group_options(p_club integer)
returns table (id integer, names jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin(p_club) then
    raise exception 'Only admins of this club can see its groups.' using errcode = '42501';
  end if;
  return query
  select g.id, coalesce((select jsonb_agg(p.display_name order by p.display_name)
                         from public.brigadier_group_members m join public.profiles p on p.id = m.profile_id
                         where m.group_id = g.id), '[]'::jsonb)
  from public.brigadier_groups g
  where g.club_id = p_club
  order by g.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security and permissions
-- ---------------------------------------------------------------------------
alter table public.club_event_answers enable row level security;
drop policy if exists "members read their own replies, club admins their club's" on public.club_event_answers;
create policy "members read their own replies, club admins their club's" on public.club_event_answers
  for select to authenticated
  using (profile_id = (select public.current_profile_id()) or public.is_admin(public.club_event_club(event_id)));
revoke all on table public.club_event_answers from public, anon, authenticated;
grant select on table public.club_event_answers to authenticated;   -- rows filtered by the policy above

revoke execute on function public.club_event_club(uuid)                    from public, anon;
revoke execute on function public.is_club_member_profile(integer, uuid)    from public, anon, authenticated;
revoke execute on function public.rsvp_answer(uuid, text)                  from public, anon;
revoke execute on function public.home_dinner_panel(integer)               from public, anon;
revoke execute on function public.admin_set_answer(uuid, uuid, text)       from public, anon;
revoke execute on function public.admin_event_answers(uuid)                from public, anon;
revoke execute on function public.admin_save_event(integer, date, uuid, integer, uuid) from public, anon;
revoke execute on function public.admin_set_rsvp_status(uuid, text)        from public, anon;
revoke execute on function public.admin_set_rsvp_deadline(uuid, timestamptz) from public, anon;
revoke execute on function public.admin_club_events(integer)               from public, anon;
revoke execute on function public.admin_venue_options(text)                from public, anon;
revoke execute on function public.admin_brigadier_group_options(integer)   from public, anon;
grant execute on function public.club_event_club(uuid)                     to authenticated;
grant execute on function public.rsvp_answer(uuid, text)                   to authenticated;
grant execute on function public.home_dinner_panel(integer)                to authenticated;
grant execute on function public.admin_set_answer(uuid, uuid, text)        to authenticated;
grant execute on function public.admin_event_answers(uuid)                 to authenticated;
grant execute on function public.admin_save_event(integer, date, uuid, integer, uuid) to authenticated;
grant execute on function public.admin_set_rsvp_status(uuid, text)         to authenticated;
grant execute on function public.admin_set_rsvp_deadline(uuid, timestamptz) to authenticated;
grant execute on function public.admin_club_events(integer)                to authenticated;
grant execute on function public.admin_venue_options(text)                 to authenticated;
grant execute on function public.admin_brigadier_group_options(integer)    to authenticated;

-- ---------------------------------------------------------------------------
-- Read-only access for Claude: one view, one role that can read nothing else.
-- No emails, phones or ids. The role cannot log in until the office gives it a password in the SQL
-- editor (never in this repo or in a chat): see the README, "Claude's read access to replies".
-- ---------------------------------------------------------------------------
create or replace view public.v_event_answers_for_claude as
select e.event_date, c.name as club, v.name as venue, p.display_name as member,
       a.answer, a.last_changed_at, a.set_by
from public.club_event_answers a
join public.club_events e on e.id = a.event_id
join public.clubs c on c.id = e.club_id
join public.profiles p on p.id = a.profile_id
left join public.venues v on v.id = e.venue_id;

revoke all on table public.v_event_answers_for_claude from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'claude_reader') then
    create role claude_reader nologin;
  end if;
end;
$$;
alter role claude_reader set default_transaction_read_only = on;
alter role claude_reader set statement_timeout = '15s';
grant usage on schema public to claude_reader;
grant select on table public.v_event_answers_for_claude to claude_reader;

-- ---------------------------------------------------------------------------
-- Club dinners on the Recos map; the feed following the current club (see migrations/012_events_map.sql)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The club's dinners for the map
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Feed: "My clubs" can follow the member's current club
-- ---------------------------------------------------------------------------

-- Is the author of this comment (which the caller can see) a member of that club?
create or replace function public.reco_comment_author_in_club(p_comment uuid, p_club integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reco_comments c
    join public.profiles pr on pr.id = c.profile_id
    join public.club_access a on a.email = pr.email and a.club_id = p_club
    where c.id = p_comment
      and public.can_see_reco_comment(c.visibility, c.club_id, c.profile_id)
  );
$$;

create or replace function public.activity_feed(
  p_scope  text        default 'my_clubs',
  p_limit  integer     default 20,
  p_before timestamptz default null,
  p_club   integer     default null   -- the member's current club: "My clubs" = members of this club
)
returns table (
  event_type   text,
  created_at   timestamptz,
  comment_id   uuid,
  venue_id     uuid,
  venue_name   text,
  area         text,
  author_label text,
  club_name    text,
  stars        smallint,
  price_level  smallint,
  snippet      text,
  image_path   text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_scope is null or p_scope not in ('my_clubs', 'all_clubs') then
    raise exception 'Scope must be my_clubs or all_clubs.' using errcode = '22023';
  end if;
  if p_club is not null and not public.is_member(p_club) then
    return;
  end if;
  return query
  select
    case when exists (
      select 1 from public.reco_comments e
      where e.venue_id = c.venue_id and (e.created_at, e.id) < (c.created_at, c.id)
    ) then 'comment_added' else 'reco_added' end,
    c.created_at,
    c.id,
    p.id,
    p.name,
    public.reco_area(p.address),
    f.author_label,
    cl.name,
    null::smallint,
    null::smallint,
    case when char_length(c.body) > 140 then rtrim(left(c.body, 139)) || '…' else c.body end,
    null::text
  from public.reco_comments c
  cross join lateral public.reco_comment_facts(c.id) f
  join public.venues p on p.id = c.venue_id
  left join public.clubs cl on cl.id = c.club_id
  where public.has_any_access()
    and (p_before is null or c.created_at < p_before)
    and not f.is_mine
    and c.visibility <> 'me'
    and (c.visibility <> 'club' or public.is_member(c.club_id))
    and (case when p_club is null then f.shares_club else public.reco_comment_author_in_club(c.id, p_club) end
         or (p_scope = 'all_clubs' and c.visibility = 'everyone'))
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke execute on function public.club_dinner_map(integer)                          from public, anon;
revoke execute on function public.reco_comment_author_in_club(uuid, integer)        from public, anon;
revoke execute on function public.activity_feed(text, integer, timestamptz, integer) from public, anon;
grant execute on function public.club_dinner_map(integer)                           to authenticated;
grant execute on function public.reco_comment_author_in_club(uuid, integer)         to authenticated;
grant execute on function public.activity_feed(text, integer, timestamptz, integer)  to authenticated;

commit;
