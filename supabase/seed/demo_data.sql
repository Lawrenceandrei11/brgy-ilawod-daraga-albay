-- ============================================================
-- Demo dataset — extra residents, requests, blotter reports,
-- appointments and anonymous messages.
--
-- Development convenience, NOT part of the schema. Run from the Supabase
-- SQL editor after demo_accounts.sql.
--
-- Requests are backdated across several months so the reports module has a
-- real shape rather than a single bar, and each one is walked to its final
-- status by UPDATE so request_status_history is written by the trigger
-- exactly as it would be in production.
-- ============================================================

-- ---------- extra residents ----------
alter table public.profiles disable trigger profiles_guard_columns;

do $$
declare
  v_uid uuid;
  v_pw  text := extensions.crypt('Ilawod!2026demo', extensions.gen_salt('bf'));
  r record;
begin
  for r in
    select * from (values
      ('ana.villanueva@brgyilawod.ph',   'Ana Marie Villanueva',    1),
      ('carlo.mendoza@brgyilawod.ph',    'Carlo Miguel Mendoza',    2),
      ('lorna.dimaguiba@brgyilawod.ph',  'Lorna Grace Dimaguiba',   3),
      ('nestor.delosreyes@brgyilawod.ph','Nestor De Los Reyes',     4),
      ('teresa.aquino@brgyilawod.ph',    'Teresa Isabel Aquino',    5),
      ('ramon.delrosario@brgyilawod.ph', 'Ramon Del Rosario',       6),
      ('grace.pascual@brgyilawod.ph',    'Grace Antonette Pascual', 7),
      ('bern.sanjuan@brgyilawod.ph',     'Bernardo San Juan',       3)
    ) as t(email, full_name, purok)
  loop
    if exists (select 1 from auth.users u where u.email = r.email) then continue; end if;

    v_uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      r.email, v_pw, now(), now() - (random() * interval '200 days'), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', r.full_name),
      false, '', '', '', ''
    );

    insert into auth.identities (id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', r.email, 'email_verified', true),
      'email', v_uid::text, now(), now(), now());

    update public.profiles set
      status = 'approved',
      email = r.email,
      resident_id = next_ref('resident', 'ILW', 4),
      approved_at = now() - (random() * interval '180 days'),
      mobile = '0917' || lpad((floor(random()*9000000)+1000000)::int::text, 7, '0'),
      purok = r.purok,
      address_line = (100 + floor(random()*400))::int || ' ' ||
        (array['Rizal Street','Mabini Street','Bonifacio Street','Del Pilar Street','Luna Street'])[1+floor(random()*5)],
      date_of_birth = date '1965-01-01' + (floor(random()*14000))::int,
      sex = case when random() < 0.5 then 'Female' else 'Male' end,
      civil_status = (array['Single','Married','Widowed'])[1+floor(random()*3)],
      years_of_residency = 3 + floor(random()*35)::int,
      household_size = 1 + floor(random()*6)::int,
      valid_id_type = (array['Philippine National ID (PhilSys)','Driver''s License','UMID / SSS','Voter''s ID'])[1+floor(random()*4)],
      valid_id_number = lpad((floor(random()*9999))::int::text,4,'0') || '-' ||
                        lpad((floor(random()*9999))::int::text,4,'0') || '-' ||
                        lpad((floor(random()*9999))::int::text,4,'0')
    where id = v_uid;
  end loop;
end $$;

alter table public.profiles enable trigger profiles_guard_columns;

-- ---------- document requests ----------
do $$
declare
  r_id uuid;
  v_res uuid[];
  v_sec uuid;
  i int;
  v_service text;
  v_status request_status;
  v_filed timestamptz;
  services_list text[] := array['barangay-clearance','certificate-residency','certificate-indigency','business-clearance'];
  statuses_list request_status[] := array['pending','processing','approved','ready','released','released','released','rejected'];
  purposes text[] := array['Local employment','Scholarship or school requirement','Bank or loan requirement',
                           'Government transaction','Police or NBI clearance requirement','Business permit'];
begin
  select array_agg(id) into v_res from profiles where role='resident' and status='approved';
  select id into v_sec from profiles where role='secretary';

  for i in 1..26 loop
    v_service := services_list[1 + (i % 4)];
    v_status  := statuses_list[1 + (i % 8)];
    v_filed   := now() - ((150 - i*5) || ' days')::interval;

    insert into document_requests (profile_id, service_code, purpose, details, filed_at, status)
    values (
      v_res[1 + (i % array_length(v_res,1))],
      v_service,
      purposes[1 + (i % 6)],
      jsonb_build_object('purpose', purposes[1 + (i % 6)]),
      v_filed,
      'pending'
    )
    returning id into r_id;

    if v_status <> 'pending' then
      update document_requests set status = 'processing', updated_at = v_filed + interval '1 day' where id = r_id;
    end if;
    if v_status in ('approved','ready','released') then
      update document_requests set status = 'approved', updated_at = v_filed + interval '2 days' where id = r_id;
    end if;
    if v_status in ('ready','released') then
      update document_requests set status = 'ready', updated_at = v_filed + interval '3 days' where id = r_id;
    end if;
    if v_status = 'released' then
      update document_requests set status = 'released', fee_paid = true,
        released_at = v_filed + interval '4 days' where id = r_id;
    end if;
    if v_status = 'rejected' then
      update document_requests set status = 'rejected',
        remarks = 'The purpose given is too general — please state the employer or institution.'
        where id = r_id;
    end if;
  end loop;

  -- The seed runs with no auth.uid(), so the trigger recorded no actor for
  -- the staff-side moves. Attribute them to the secretary so the demo shows a
  -- realistic trail. This is synthetic: real transitions carry the real actor.
  update request_status_history set changed_by = v_sec
  where changed_by is null and from_status is not null;
end $$;

-- ---------- blotter and appointments ----------
do $$
declare
  v_res uuid[];
  i int;
  types text[] := array['Neighbour dispute','Noise complaint','Theft','Boundary or land dispute',
                        'Physical injury or assault','Property damage','Scam or estafa'];
  places text[] := array['Rizal Street corner Mabini','Purok 3 basketball court','Near the public market',
                         'Along the riverbank path','Bonifacio Street'];
  b_status blotter_status[] := array['filed','under_mediation','resolved','resolved','referred','dismissed'];
begin
  select array_agg(id) into v_res from profiles where role='resident' and status='approved';

  for i in 1..9 loop
    insert into blotter_reports (complainant_id, incident_type, incident_at, location, narrative,
                                 respondent_name, created_at, status)
    values (
      v_res[1 + (i % array_length(v_res,1))],
      types[1 + (i % 7)],
      now() - ((90 - i*7) || ' days')::interval,
      places[1 + (i % 5)],
      'Recorded during the barangay''s normal intake. Details were taken from the complainant at the hall and read back before filing.',
      case when i % 3 = 0 then null else 'Withheld pending mediation' end,
      now() - ((90 - i*7) || ' days')::interval,
      b_status[1 + (i % 6)]
    );
  end loop;

  for i in 1..7 loop
    insert into appointments (profile_id, scheduled_at, window_no, purpose, status)
    select
      v_res[1 + (i % array_length(v_res,1))],
      d + time '09:00' + ((i % 6) * interval '30 minutes'),
      1 + (i % 2),
      (array['Clearance pickup','Certificate pickup','Business permit enquiry','General enquiry'])[1+(i%4)],
      'booked'
    from (select (current_date + (i || ' days')::interval) d) x
    where extract(dow from d) between 1 and 5
    on conflict do nothing;
  end loop;
end $$;

-- ---------- anonymous messages ----------
-- Through the sanctioned RPC, exactly as the public form does.
select submit_anonymous_message('Sanitation',
  'Rubbish has not been collected along the riverbank path for over two weeks and it is starting to smell. Several households nearby have small children.');
select submit_anonymous_message('Noise or nuisance',
  'There is loud videoke every night past midnight near the covered court. People have to work in the morning and nobody wants to be the one to complain in person.');
select submit_anonymous_message('Safety or crime concern',
  'The street light at the corner of Mabini has been out for a month. It is very dark and a few people have been followed walking home from the market.');

select
  (select count(*) from profiles where role='resident') as residents,
  (select count(*) from document_requests)              as requests,
  (select count(*) from blotter_reports)                as blotter,
  (select count(*) from appointments)                   as appointments,
  (select count(*) from anonymous_messages)             as anon_messages;
