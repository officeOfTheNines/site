-- ===========================================================================
-- STEP 16: who attended past dinners (short names, for every member of the club)
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 015. Safe to run again. Adds functions and two grants;
-- no table is changed and no data is written or deleted.
--
-- Reuses club_event_answers: an attendee of a past dinner is a row with answer = 'attending'.
-- Rows for past dinners are written by admins (set_by = 'admin', locked_by_admin = true).
-- The rules for upcoming dinners are unchanged: members still read only their own reply
-- (row-level security on club_event_answers is not touched) and the 1-hour window stays.
--
--   past_dinner_attendees(event)               any member of the dinner's club; past dinners only
--                                              (event_date before today in the club's time zone);
--                                              'attending' rows only; short names + the count.
--   admin_past_attendee_options(event)         admins: the club's people (current and former card
--                                              holders, plus anyone with a reply) and who attended.
--   admin_save_past_attendees(event, ids[])    admins, past dinners only: the attendee list becomes
--                                              exactly these people (see below).
-- service_role (the secret key, used only by the one-off load script run outside the site) may read
-- and add replies: it had no rights on club_event_answers at all.

begin;

-- ---------------------------------------------------------------------------
-- Members: the attendees of a past dinner
-- ---------------------------------------------------------------------------
-- Short names ("Jean-Baptiste S.", the brigadiers' rule: reco_author_label), alphabetical, and the
-- total on every row. Nothing for an upcoming dinner (today included), for people who are not members
-- of the dinner's club, or for an unknown dinner. Former members who attended are listed too: they were
-- there. Never 'not_attending' and never people without a reply.
create or replace function public.past_dinner_attendees(p_event uuid)
returns table (
  short_name      text,
  attendee_count  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  ev_club integer;
  ev_date date;
  today date;
begin
  select e.club_id, e.event_date, (now() at time zone c.timezone)::date
    into ev_club, ev_date, today
  from public.club_events e join public.clubs c on c.id = e.club_id
  where e.id = p_event;
  if ev_club is null or not public.is_member(ev_club) or ev_date >= today then
    return;
  end if;
  return query
  select n.short_name, (count(*) over ())::integer
  from (select public.reco_author_label(p.display_name) as short_name
        from public.club_event_answers a
        join public.profiles p on p.id = a.profile_id
        where a.event_id = p_event and a.answer = 'attending') n
  order by lower(n.short_name), n.short_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admins: edit the attendees of a past dinner
-- ---------------------------------------------------------------------------
-- Everyone who can be listed: people with a card in the club (current members and former ones), plus
-- anyone who already has a reply to this dinner. attending = has an 'attending' reply.
create or replace function public.admin_past_attendee_options(p_event uuid)
returns table (
  profile_id    uuid,
  display_name  text,
  is_member     boolean,     -- has access to the club today
  attending     boolean
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
    raise exception 'Only admins of this club can edit attendees.' using errcode = '42501';
  end if;
  return query
  with people as (
    select cp.profile_id as id from public.club_profiles cp where cp.club_id = club
    union
    select a.profile_id from public.club_event_answers a where a.event_id = p_event
  )
  select p.id, p.display_name, public.is_club_member_profile(club, p.id),
         exists (select 1 from public.club_event_answers a
                 where a.event_id = p_event and a.profile_id = p.id and a.answer = 'attending')
  from people pe
  join public.profiles p on p.id = pe.id
  order by lower(p.display_name);
end;
$$;

-- The attendees of a past dinner become exactly p_profile_ids:
--   listed people get an 'attending' reply (set_by 'admin', locked); a new reply is dated the dinner
--     date (midnight, club time), an existing one keeps its first date and its last change is now;
--   'attending' replies of people not listed are removed (they were not there);
--   'not_attending' replies of people not listed are kept as they are.
-- Only past dinners (event_date before today, club time): upcoming dinners keep the Replies screen.
-- Everyone listed needs a card in the club (current or former) or an existing reply to this dinner.
-- Returns the number of attendees after saving.
create or replace function public.admin_save_past_attendees(p_event uuid, p_profile_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  club integer;
  ev_date date;
  today date;
  stamp timestamptz;
  ids uuid[] := array(select distinct x from unnest(coalesce(p_profile_ids, '{}'::uuid[])) as x where x is not null);
  n integer;
begin
  select e.club_id, e.event_date, (now() at time zone c.timezone)::date, (e.event_date::timestamp at time zone c.timezone)
    into club, ev_date, today, stamp
  from public.club_events e join public.clubs c on c.id = e.club_id
  where e.id = p_event;
  if club is null or not public.is_admin(club) then
    raise exception 'Only admins of this club can edit attendees.' using errcode = '42501';
  end if;
  if ev_date >= today then
    raise exception 'Attendees can only be edited once the dinner has taken place. For an upcoming dinner, use Replies.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(ids) as x
             where not exists (select 1 from public.club_profiles cp where cp.club_id = club and cp.profile_id = x)
               and not exists (select 1 from public.club_event_answers a where a.event_id = p_event and a.profile_id = x)) then
    raise exception 'Everyone listed must have a card in this club. Reload and try again.' using errcode = '23503';
  end if;

  delete from public.club_event_answers
  where event_id = p_event and answer = 'attending' and not (profile_id = any (ids));

  insert into public.club_event_answers (event_id, profile_id, answer, first_answered_at, last_changed_at, set_by, locked_by_admin)
  select p_event, x, 'attending', stamp, stamp, 'admin', true from unnest(ids) as x
  on conflict (event_id, profile_id) do update
    set answer = 'attending', set_by = 'admin', locked_by_admin = true,
        last_changed_at = case when public.club_event_answers.answer = 'attending'
                               then public.club_event_answers.last_changed_at else now() end;

  select count(*) into n from public.club_event_answers where event_id = p_event and answer = 'attending';
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.past_dinner_attendees(uuid)                  from public, anon;
revoke execute on function public.admin_past_attendee_options(uuid)            from public, anon;
revoke execute on function public.admin_save_past_attendees(uuid, uuid[])      from public, anon;
grant execute on function public.past_dinner_attendees(uuid)                   to authenticated;
grant execute on function public.admin_past_attendee_options(uuid)             to authenticated;
grant execute on function public.admin_save_past_attendees(uuid, uuid[])       to authenticated;

-- the one-off load script (secret key, run outside the site): read and add replies; no delete
grant select, insert, update on table public.club_event_answers to service_role;

commit;

notify pgrst, 'reload schema';
