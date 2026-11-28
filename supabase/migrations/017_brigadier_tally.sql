-- ===========================================================================
-- STEP 17: the reply tally for the brigadiers of an upcoming dinner (counts only)
-- ===========================================================================
--
-- Run once in the Supabase SQL Editor, after 016. Safe to run again. Adds one function; no table is
-- changed and no data is written.
--
-- dinner_tally(event): for an upcoming dinner (event_date today or later, club time), and only for the
-- members of that dinner's brigadier group (club_events.brigadier_group_id, today's members of the
-- group), three numbers:
--   attending      replies 'attending'
--   not_attending  replies 'not_attending'
--   no_answer      current members of the club (card + access, as on the admin Replies screen) with
--                  no reply
-- Counts only: no names, no replies. Everyone else (other members, admins who are not in the group,
-- the other club, past dinners, dinners with no group) gets nothing. Admins keep the Replies screen.
-- Members still read only their own reply; nothing else about replies changes.

begin;

create or replace function public.dinner_tally(p_event uuid)
returns table (
  attending      integer,
  not_attending  integer,
  no_answer      integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.club_events%rowtype;
  today date;
  me uuid := public.current_profile_id();
begin
  select * into ev from public.club_events where id = p_event;
  if ev.id is null or me is null or ev.brigadier_group_id is null or not public.is_member(ev.club_id) then
    return;
  end if;
  select (now() at time zone c.timezone)::date into today from public.clubs c where c.id = ev.club_id;
  if ev.event_date < today then
    return;
  end if;
  if not exists (select 1 from public.brigadier_group_members m
                 where m.group_id = ev.brigadier_group_id and m.profile_id = me) then
    return;
  end if;
  return query
  select
    (select count(*)::integer from public.club_event_answers a where a.event_id = ev.id and a.answer = 'attending'),
    (select count(*)::integer from public.club_event_answers a where a.event_id = ev.id and a.answer = 'not_attending'),
    (select count(*)::integer
     from public.club_profiles cp
     join public.profiles p on p.id = cp.profile_id
     where cp.club_id = ev.club_id
       and exists (select 1 from public.club_access x where x.club_id = ev.club_id and x.email = p.email)
       and not exists (select 1 from public.club_event_answers a where a.event_id = ev.id and a.profile_id = cp.profile_id));
end;
$$;

revoke execute on function public.dinner_tally(uuid) from public, anon;
grant execute on function public.dinner_tally(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
