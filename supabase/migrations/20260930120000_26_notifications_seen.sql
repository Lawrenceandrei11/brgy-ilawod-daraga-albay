-- Migration 26: how far down the notification bell a resident has read.
--
-- The bell in the resident portal does not have a table of its own. What it
-- shows is derived from records the resident can already open -- the status
-- history of their own requests, their appointments, their blotter reports
-- and the published announcements -- so the feed is the real record rather
-- than a copy of it that can drift when a trigger misses a path.
--
-- The only thing that cannot be derived is how much of it has been read, and
-- that is this column: one timestamp per account, moved forward when the
-- resident opens the bell. Anything newer is unread.
--
-- The default matters more than it looks. `add column` with a now() default
-- stamps every existing row with the time of this migration, so nobody opens
-- the bell to a wall of announcements from months ago marked as new. New
-- accounts get the same default on insert, so handle_new_user() is unchanged.

alter table profiles
  add column if not exists notifications_seen_at timestamptz not null default now();

comment on column profiles.notifications_seen_at is
  'Everything the resident had seen in the notification bell up to this moment. Anything newer counts as unread.';

-- No policy is added. profiles_update_own already lets an account write its
-- own row, and guard_profile_columns() guards only role, status, resident ID
-- and the approval fields, so this column is the owner's to move and grants
-- nothing by being moved.
