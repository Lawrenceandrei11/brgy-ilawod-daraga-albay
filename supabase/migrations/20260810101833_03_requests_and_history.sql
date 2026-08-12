-- ============================================================
-- Document requests + the immutable status audit trail
-- ============================================================

create table document_requests (
  id           uuid primary key default gen_random_uuid(),
  ref_no       text unique not null,
  profile_id   uuid not null references profiles(id) on delete cascade,
  service_code text not null references services(code),

  purpose      text not null,
  -- Service-specific extras (business name, OR number, and so on) live here
  -- so adding a new service does not require a schema change.
  details      jsonb not null default '{}'::jsonb,

  status       request_status not null default 'pending',
  remarks      text,
  assigned_to  uuid references profiles(id) on delete set null,

  fee          numeric(10,2) not null default 0,
  fee_paid     boolean not null default false,

  filed_at     timestamptz not null default now(),
  released_at  timestamptz,
  updated_at   timestamptz not null default now()
);

create index document_requests_profile_idx on document_requests (profile_id, filed_at desc);
create index document_requests_status_idx  on document_requests (status, filed_at desc);
create index document_requests_service_idx on document_requests (service_code);

create trigger document_requests_touch
  before update on document_requests
  for each row execute function touch_updated_at();

-- Reference number and fee are stamped by the database, not the client, so a
-- resident cannot file a request under someone else's number or set their own fee.
create or replace function stamp_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ref_no is null then
    new.ref_no := next_ref('request', 'ILW', 5);
  end if;
  select s.fee into new.fee from services s where s.code = new.service_code;
  return new;
end;
$$;

create trigger document_requests_stamp
  before insert on document_requests
  for each row execute function stamp_request();

-- ---------- audit trail ----------
create table request_status_history (
  id          bigserial primary key,
  request_id  uuid not null references document_requests(id) on delete cascade,
  from_status request_status,
  to_status   request_status not null,
  changed_by  uuid references profiles(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create index request_status_history_request_idx
  on request_status_history (request_id, created_at);

-- History is written by a trigger rather than the application. That means the
-- trail cannot be skipped by a buggy screen or a direct API call, which is
-- what makes it worth calling an audit trail at all.
create or replace function log_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into request_status_history (request_id, from_status, to_status, changed_by, note)
    values (new.id, null, new.status, new.profile_id, 'Request filed');

  elsif new.status is distinct from old.status then
    insert into request_status_history (request_id, from_status, to_status, changed_by, note)
    values (new.id, old.status, new.status, auth.uid(), new.remarks);

    if new.status = 'released' and new.released_at is null then
      new.released_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger document_requests_log_insert
  after insert on document_requests
  for each row execute function log_request_status();

create trigger document_requests_log_update
  before update on document_requests
  for each row execute function log_request_status();
