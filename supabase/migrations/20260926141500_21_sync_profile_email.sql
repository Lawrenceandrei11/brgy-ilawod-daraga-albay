-- ============================================================
-- The profile's email follows the sign-in email
--
-- Supabase Auth owns the email address: it is what you sign in with, and only
-- it can confirm a change. profiles.email is a copy, kept so the admin lists,
-- the masterlist and the request screens can show an address without reaching
-- into auth.users.
--
-- A copy drifts unless something keeps it. This is that something, and it
-- sits on auth.users rather than in the page, so it holds however the address
-- changed: the Admin profile page, a confirmation link clicked hours later in
-- an email client, or an edit made straight from the Supabase dashboard.
-- ============================================================

create or replace function sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- AFTER UPDATE OF email fires whenever the column is written, not only when
  -- the value moves, so compare before touching the profile.
  if new.email is distinct from old.email then
    update profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function sync_profile_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function sync_profile_email();

-- Anything that drifted before the trigger existed.
update profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;
