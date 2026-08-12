-- ============================================================
-- Reference data — the barangay's actual service catalogue,
-- council roster and standing notices.
-- ============================================================

-- The landing page shows six cards, but only four of them produce a
-- document_request. `kind` lets one query drive the whole grid while the
-- foreign key still only ever points at a real document type.
alter table services add column if not exists kind text not null default 'document';

insert into services (code, name, description, fee, processing_days, requires_council_review, icon, requirements, sort_order, kind)
values
  ('barangay-clearance',
   'Barangay Clearance',
   'The standard clearance for employment, permits, and most government transactions.',
   50, 2, false, 'service-clearance.png',
   array['A valid government ID', 'Proof of residency', 'Payment of the ₱50 fee'],
   1, 'document'),

  ('certificate-residency',
   'Certificate of Residency',
   'Proof that you live in Barangay Ilawod, with your length of stay on record.',
   50, 2, false, 'service-residency.png',
   array['A valid government ID', 'At least six months of residency on record'],
   2, 'document'),

  ('certificate-indigency',
   'Certificate of Indigency',
   'For medical, educational and legal assistance. No fee, and reviewed by the barangay council.',
   0, 3, true, 'service-indigency.png',
   array['A valid government ID', 'Reason for the request', 'Household income declaration'],
   3, 'document'),

  ('business-clearance',
   'Business Clearance',
   'Barangay endorsement for a new or renewing business inside the barangay.',
   200, 3, false, 'service-business.png',
   array['A valid government ID', 'DTI or SEC registration', 'Business address inside the barangay'],
   4, 'document'),

  ('blotter',
   'Blotter Report',
   'Record an incident or dispute officially, and follow what the barangay does about it.',
   0, 1, false, 'service-blotter.png',
   array['Details of the incident: what, where and when'],
   5, 'report'),

  ('anonymous',
   'Anonymous Message',
   'Report a safety concern without giving your name. No sign-in, no contact details required.',
   0, 1, false, 'service-anonymous.png',
   array['Nothing — no account and no identity is required'],
   6, 'anonymous')
on conflict (code) do nothing;

-- ---------- barangay council ----------
insert into officials (name, position, photo_path, sort_order, active) values
  ('To be confirmed', 'Punong Barangay',            'official-placeholder.png', 1, true),
  ('To be confirmed', 'Barangay Secretary',         'official-placeholder.png', 2, true),
  ('To be confirmed', 'Barangay Treasurer',         'official-placeholder.png', 3, true),
  ('To be confirmed', 'Kagawad · Peace & Order',    'official-placeholder.png', 4, true),
  ('To be confirmed', 'SK Chairperson',             'official-placeholder.png', 5, true)
on conflict do nothing;

-- ---------- standing notices ----------
insert into announcements (title, slug, excerpt, body, category, cover_path, published_at) values
  ('Free anti-rabies vaccination at the barangay hall',
   'free-anti-rabies-vaccination',
   'Bring your pets on Saturday, 8:00 AM to 3:00 PM. Registration is at the covered court.',
   'The barangay, together with the city veterinary office, will hold a free anti-rabies vaccination drive at the barangay hall covered court.

Bring your pets on Saturday, 8:00 AM to 3:00 PM. Registration is at the covered court. Dogs must be leashed and cats must be in carriers. One handler per animal, please.

Households with more than three pets are asked to come in the morning session so the afternoon queue stays manageable.',
   'Health & sanitation', 'announcement-placeholder.png', '2026-08-08 08:00+08'),

  ('Scheduled water interruption, Purok 3 and 4',
   'water-interruption-purok-3-4',
   'Service will be cut from 9:00 PM to 4:00 AM for main line repair. Store water in advance.',
   'The water district will carry out main line repair affecting Purok 3 and Purok 4.

Service will be cut from 9:00 PM to 4:00 AM. Residents are advised to store enough water for the evening and early morning.

If service has not returned by 6:00 AM, please report it to the barangay hall so we can follow up with the water district on your behalf.',
   'Utilities', 'announcement-placeholder.png', '2026-08-06 17:00+08'),

  ('Barangay assembly and 2027 budget hearing',
   'barangay-assembly-2027-budget',
   'All residents are invited to review the proposed 2027 barangay budget and raise concerns.',
   'All residents are invited to the barangay assembly, where the proposed 2027 barangay budget will be presented line by line.

This is the meeting where the budget can still be changed. Concerns raised here are recorded in the minutes and must be answered by the council before the budget is passed.

Copies of the draft budget are available at the barangay secretary''s desk during office hours.',
   'Governance', 'announcement-placeholder.png', '2026-08-01 09:00+08')
on conflict (slug) do nothing;

-- ---------- runtime settings ----------
insert into settings (key, value) values
  ('face_match_threshold',
   jsonb_build_object(
     'value', 0.5,
     'note', 'L2 distance ceiling for a face match. Lower is stricter. face-api.js convention is 0.6; this system is deliberately tighter.'
   )),
  ('face_lockout_attempts',
   jsonb_build_object('value', 5, 'note', 'Failed face sign-ins before a temporary lock.')),
  ('face_lockout_minutes',
   jsonb_build_object('value', 15, 'note', 'How long the lock lasts.')),
  ('barangay',
   jsonb_build_object(
     'name', 'Barangay Ilawod',
     'office_hours', 'Monday to Friday, 8:00 AM – 5:00 PM',
     'puroks', 7
   ))
on conflict (key) do nothing;
