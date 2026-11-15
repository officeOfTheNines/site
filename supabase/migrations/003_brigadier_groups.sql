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
