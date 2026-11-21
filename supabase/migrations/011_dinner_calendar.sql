-- ===========================================================================
-- STEP 11: dinner calendar and replies
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 010. Safe to run again. Nothing is deleted and existing
-- dinners keep their data (the 107 past dinners get rsvp_status 'not_open', the default).
--
--   club_events        + brigadier_group_id, rsvp_status ('not_open' | 'open' | 'closed'), rsvp_deadline;
--                        venue_id becomes optional (a dinner can be planned before its venue is chosen).
--                        event_date stays the only date: no start time is stored anywhere.
--   clubs              + timezone (Europe/London for The Nines, Europe/Paris for Les Ronds), used to
--                        decide which dinners are still upcoming.
--   club_event_answers   one reply per member per dinner: attending / not attending. No guests.
--                        Members read only their own; club admins read their club's; nobody writes
--                        directly: only through the functions below.
--
-- Rules, all enforced here (not only in the page):
--   * a member replies with rsvp_answer(): only in their own club, only while the dinner is 'open' and
--     before its deadline; they may change their reply only within 1 hour of their FIRST reply (changing
--     it does not restart the hour), and never once an admin has set it;
--   * admins set, force or clear a reply with admin_set_answer(); a forced reply is locked for the member;
--   * 'not_open' dinners are never shown to members.

begin;

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

-- A dinner's brigadier group must belong to the dinner's club (keeps the existing rating check).
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

commit;

notify pgrst, 'reload schema';
