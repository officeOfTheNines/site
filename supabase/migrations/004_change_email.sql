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
