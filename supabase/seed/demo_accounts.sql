-- ============================================================
-- Demo accounts — development convenience, NOT part of the schema.
--
-- Kept out of migrations/ deliberately: seeding auth.users directly is
-- something you do to get a demo running, not something that should happen
-- to a production barangay database.
--
-- Run from the Supabase SQL editor after `supabase db push`.
-- Every account uses the password: Ilawod!2026demo
--
-- guard_profile_columns() is disabled around the insert because it correctly
-- refuses role/status changes from a non-staff caller, and a SQL console has
-- no auth.uid() to satisfy it. It is re-enabled at the end.
-- ============================================================

alter table public.profiles disable trigger profiles_guard_columns;

do $$
declare
  v_uid uuid;
  v_pw  text := extensions.crypt('Ilawod!2026demo', extensions.gen_salt('bf'));
  r record;
begin
  for r in
    select * from (values
      ('captain@brgyilawod.ph',       'Rodrigo A. Mabini',     'captain',   'approved', 2),
      ('secretary@brgyilawod.ph',     'Elena V. Bautista',     'secretary', 'approved', 1),
      ('treasurer@brgyilawod.ph',     'Marisol T. Ocampo',     'treasurer', 'approved', 4),
      ('juan.delacruz@brgyilawod.ph', 'Juan Miguel Dela Cruz', 'resident',  'approved', 3),
      ('maria.santos@brgyilawod.ph',  'Maria Clara Santos',    'resident',  'approved', 5),
      ('pedro.reyes@brgyilawod.ph',   'Pedro Luis Reyes',      'resident',  'pending',  2)
    ) as t(email, full_name, role, status, purok)
  loop
    -- Skip anyone already seeded, so this can be re-run safely.
    if exists (select 1 from auth.users u where u.email = r.email) then
      continue;
    end if;

    v_uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      r.email, v_pw, now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', r.full_name),
      false, '', '', '', ''
    );

    -- Password sign-in needs a matching identity row in current GoTrue.
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', r.email, 'email_verified', true),
      'email', v_uid::text, now(), now(), now()
    );

    -- handle_new_user() already created the profile; fill in the rest.
    update public.profiles set
      role        = r.role::user_role,
      status      = r.status::profile_status,
      email       = r.email,
      resident_id = case when r.status = 'approved' then next_ref('resident', 'ILW', 4) end,
      approved_at = case when r.status = 'approved' then now() end,
      mobile      = '0917' || lpad((floor(random() * 9000000) + 1000000)::int::text, 7, '0'),
      purok       = r.purok,
      address_line       = (100 + floor(random() * 400))::int || ' Rizal Street',
      date_of_birth      = date '1978-01-01' + (floor(random() * 9000))::int,
      sex                = case when random() < 0.5 then 'Female' else 'Male' end,
      civil_status       = case when random() < 0.5 then 'Married' else 'Single' end,
      years_of_residency = 5 + floor(random() * 25)::int,
      household_size     = 2 + floor(random() * 5)::int,
      valid_id_type      = 'Philippine National ID (PhilSys)',
      valid_id_number    = lpad((floor(random() * 9999))::int::text, 4, '0') || '-' ||
                           lpad((floor(random() * 9999))::int::text, 4, '0') || '-' ||
                           lpad((floor(random() * 9999))::int::text, 4, '0')
    where id = v_uid;
  end loop;
end $$;

alter table public.profiles enable trigger profiles_guard_columns;

select full_name, email, role, status, resident_id, purok
from public.profiles
order by case role
           when 'captain' then 1 when 'secretary' then 2
           when 'treasurer' then 3 else 4 end,
         full_name;
