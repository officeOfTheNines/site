-- ===========================================================================
-- STEP 14: directory details, per-field privacy and sponsor (godfather / godson) pairs
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 013. Safe to run again. Adds columns and replaces
-- functions; no data is changed or deleted.
--
-- club_profiles (a person's card in one club) gets:
--   member_number  the club's membership number (unique within the club)      admins only
--   club_role      e.g. "Fondateur et président du Diner des Ronds"           admins only
--   occupation     free text                                                  the member or an admin
--   other_clubs    text[]: other clubs the person belongs to                  the member or an admin
--   address        home address, free text                                    the member or an admin
--   show_address   like show_email / show_phone: shown to other members only when true
-- Phone and email stay on profiles (the same person in every club).
--
-- brigadier_group_members gets is_godson: 0 = the godfather (sponsor), 1 = the godson, null = an
-- ordinary brigadier group. Existing groups keep null (everyone shows as "co_brigadier").
--
-- directory(club) also returns these fields (address only where show_address, or to the club's
-- admins), private_fields (admins only: which of email / phone / address other members cannot see)
-- and relations: for each group the card shares with another listed member,
--   { "profile_id", "display_name", "relation", "group_id" } with relation 'godson' (the other person
--   is this member's godson), 'godfather' or 'co_brigadier'. The page translates these codes.
--
-- admin_save_brigadier_group(...) takes an optional p_is_godson smallint[] (same order as
-- p_profile_ids; values 0, 1 or null). Left out, the members' current values are kept.

begin;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.club_profiles add column if not exists member_number integer;
alter table public.club_profiles add column if not exists club_role     text;
alter table public.club_profiles add column if not exists occupation    text;
alter table public.club_profiles add column if not exists other_clubs   text[] not null default '{}';
alter table public.club_profiles add column if not exists address       text;
alter table public.club_profiles add column if not exists show_address  boolean not null default false;

alter table public.club_profiles drop constraint if exists club_profiles_member_number;
alter table public.club_profiles add constraint club_profiles_member_number check (member_number is null or member_number > 0);
alter table public.club_profiles drop constraint if exists club_profiles_text_lengths;
alter table public.club_profiles add constraint club_profiles_text_lengths check (
  char_length(coalesce(club_role, '')) <= 120 and char_length(coalesce(occupation, '')) <= 200
  and char_length(coalesce(address, '')) <= 300);
alter table public.club_profiles drop constraint if exists club_profiles_other_clubs;
alter table public.club_profiles add constraint club_profiles_other_clubs check (
  cardinality(other_clubs) <= 12 and char_length(array_to_string(other_clubs, '|')) <= 600);

create unique index if not exists club_profiles_member_number_idx
  on public.club_profiles (club_id, member_number) where member_number is not null;

alter table public.brigadier_group_members add column if not exists is_godson smallint;
alter table public.brigadier_group_members drop constraint if exists brigadier_group_members_is_godson;
alter table public.brigadier_group_members add constraint brigadier_group_members_is_godson check (is_godson in (0, 1));

-- ---------------------------------------------------------------------------
-- Card trigger: tidies the new fields; only the club's admins change member_number and club_role
-- (as for listed and foreign_member, other people's attempts keep the old values).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Relations between members who share a brigadier group in a club
-- ---------------------------------------------------------------------------
-- For member p_profile_id in club p_club: one entry per (group, other listed member).
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

-- ---------------------------------------------------------------------------
-- Directory
-- ---------------------------------------------------------------------------
-- A club's directory: listed cards only, for members of that club only. Email, phone and address
-- appear where the person chose to show them, and always for that club's admins.
drop function if exists public.directory(integer);
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
-- Brigadier groups: save with godfather / godson roles
-- ---------------------------------------------------------------------------
drop function if exists public.admin_save_brigadier_group(integer, integer, uuid[]);
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Members edit their own occupation, other clubs, address and show_address (row-level security
-- already limits updates to their own card, or any card of the club for its admins); member_number
-- and club_role are kept as they were unless an admin saves them (trigger above).
grant update (occupation, other_clubs, address, show_address, member_number, club_role)
  on table public.club_profiles to authenticated;

revoke execute on function public.member_relations(integer, uuid)                                from public, anon, authenticated;
revoke execute on function public.directory(integer)                                             from public, anon;
revoke execute on function public.admin_save_brigadier_group(integer, integer, uuid[], smallint[]) from public, anon;
grant execute on function public.directory(integer)                                              to authenticated;
grant execute on function public.admin_save_brigadier_group(integer, integer, uuid[], smallint[]) to authenticated;

commit;

notify pgrst, 'reload schema';
