-- Migration 27: removing things from the notification bell.
--
-- The bell still has no notifications table and still derives what it shows
-- from the resident's own records (migration 26). What it gains here is the
-- ability to take a line off the list -- one at a time, or the lot -- without
-- that meaning anything at all to the records behind it. Removing the notice
-- "Ready for pickup" from the bell must never touch the request, and clearing
-- the whole list must never touch a request, an appointment, an announcement,
-- a blotter report, an SMS log row or a resident.
--
-- So nothing here deletes from those tables, and nothing here can: the only
-- delete this feature ever issues is against notification_dismissals, and it
-- only removes rows that a later watermark has already made redundant.
--
-- Two pieces, because the two actions want different shapes:
--
--   Clear all  -> one timestamp. Everything at or below it is hidden, so a
--                 list of any length costs a single column and never grows.
--   Remove one -> one row per removed line, because a timestamp cannot say
--                 "hide item 47 but keep item 48".
--
-- Both live in Postgres rather than the browser, so a removal made on a phone
-- is still a removal when the resident signs in on a desktop.

alter table profiles
  add column if not exists notifications_cleared_at timestamptz;

comment on column profiles.notifications_cleared_at is
  'Bell history cleared up to this moment. Notices at or older than this are hidden from the bell. Nothing is deleted: the records behind them are untouched.';

create table if not exists notification_dismissals (
  profile_id   uuid not null references profiles(id) on delete cascade,
  -- The derived notice, as the portal keys it: 'req-1842', 'ann-<uuid>'.
  -- Deliberately not a foreign key: these point at four different tables, and
  -- a row that disappears should leave a dismissal that simply matches
  -- nothing rather than a constraint that has to be satisfied.
  item_key     text not null,
  -- When the notice itself is dated. This is what lets "clear all" prune the
  -- rows it has just made redundant, so this table stays small for good.
  item_at      timestamptz not null,
  dismissed_at timestamptz not null default now(),
  primary key (profile_id, item_key)
);

comment on table notification_dismissals is
  'Single notices a resident removed from their bell. A record of what to hide; never a copy of the notice, and never a reason to delete anything.';

create index if not exists notification_dismissals_prune_idx
  on notification_dismissals (profile_id, item_at);

-- ------------------------------------------------------------
-- Row Level Security
--
-- Narrower than the policies on the four sources this bell reads. Those all
-- end in "or is_staff()", which is why the portal filters by profile as well;
-- here there is no reason for one account to reach another's, staff or not,
-- so the policy does not offer it.
-- ------------------------------------------------------------
alter table notification_dismissals enable row level security;

revoke all on table notification_dismissals from anon, authenticated;
grant select, insert, delete on table notification_dismissals to authenticated;

drop policy if exists dismissals_own on notification_dismissals;
create policy dismissals_own on notification_dismissals
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
