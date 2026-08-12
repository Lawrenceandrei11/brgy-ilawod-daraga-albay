-- ============================================================
-- Write paths for the two tables clients cannot read back.
--
-- Postgres applies SELECT policies to `INSERT ... RETURNING`. Neither
-- anonymous_messages nor face_templates.descriptor is readable by a client,
-- so a direct insert could never return the reference code or confirm the
-- write. Routing both through SECURITY DEFINER functions fixes that and
-- buys two further things:
--
--   * an explicit column allowlist — a client cannot smuggle in `status`,
--     `handled_by` or `confirmed_at` by posting extra fields
--   * server-side validation that cannot be skipped by calling the API
--     directly instead of using the app
-- ============================================================

-- ------------------------------------------------------------
-- Anonymous message submission
-- ------------------------------------------------------------
drop policy if exists anon_insert_anyone on anonymous_messages;

create or replace function submit_anonymous_message(
  p_category       text,
  p_message        text,
  p_contact_optin  boolean default false,
  p_contact_detail text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if p_category is null or btrim(p_category) = '' then
    raise exception 'Please choose a category so the message can be routed.';
  end if;

  if p_message is null or length(btrim(p_message)) < 10 then
    raise exception 'Please describe the concern in at least 10 characters.';
  end if;

  if length(p_message) > 4000 then
    raise exception 'Message is too long. Please keep it under 4000 characters.';
  end if;

  if p_contact_optin and (p_contact_detail is null or btrim(p_contact_detail) = '') then
    raise exception 'You asked to be contacted but did not leave a contact detail.';
  end if;

  insert into anonymous_messages (category, message, contact_optin, contact_detail)
  values (
    btrim(p_category),
    btrim(p_message),
    coalesce(p_contact_optin, false),
    -- If the reporter did not opt in, any contact detail sent by the client
    -- is discarded rather than stored. Silence stays the safe choice.
    case when coalesce(p_contact_optin, false) then btrim(p_contact_detail) else null end
  )
  returning ref_code into v_code;

  return v_code;
end;
$$;

revoke all on function submit_anonymous_message(text, text, boolean, text) from public;
grant execute on function submit_anonymous_message(text, text, boolean, text) to anon, authenticated;

comment on function submit_anonymous_message(text, text, boolean, text) is
  'The only write path into anonymous_messages. Returns the one-time reference code. Records nothing that could identify the sender.';

-- ------------------------------------------------------------
-- Face enrollment
-- ------------------------------------------------------------
-- Descriptors now arrive only through this function, which checks the
-- dimensionality. A raw table insert could have stored a malformed or
-- adversarial vector.
drop policy if exists face_insert_own on face_templates;

create or replace function enroll_face(
  p_angle      face_angle,
  p_descriptor real[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_len int  := coalesce(array_length(p_descriptor, 1), 0);
begin
  if v_uid is null then
    raise exception 'You must be signed in to enrol your face.';
  end if;

  if v_len <> 128 then
    raise exception 'A face descriptor must have exactly 128 dimensions (received %).', v_len;
  end if;

  insert into face_templates (profile_id, angle, descriptor)
  values (v_uid, p_angle, p_descriptor::extensions.vector(128))
  on conflict (profile_id, angle) do update
    set descriptor   = excluded.descriptor,
        created_at   = now(),
        -- Re-enrolling replaces the biometric, so any previous in-person
        -- confirmation no longer applies to it.
        confirmed_at = null,
        confirmed_by = null;
end;
$$;

revoke all on function enroll_face(face_angle, real[]) from public, anon;
grant execute on function enroll_face(face_angle, real[]) to authenticated;

comment on function enroll_face(face_angle, real[]) is
  'The only write path into face_templates. Validates the 128-dimension descriptor and resets in-person confirmation when a template is replaced.';
