# Database

Everything the Barangay E-Assist database is made of, in the order it was applied.

## Rebuilding from scratch

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

`db push` applies `migrations/` in filename order, which is timestamp order,
which is the order they were originally applied. There is no manual step.

Then create the demo accounts (see below), and set the two things that are not
in migrations because they are project settings rather than schema:

1. **Turn off email confirmation** — Authentication → Sign In / Providers →
   Email → uncheck *Confirm email*. Without this a new resident cannot sign in
   until they click a link, and Supabase's built-in mail only reliably reaches
   your own address.
2. **Deploy the Edge Function** — `supabase functions deploy face-login
   --no-verify-jwt`. The `--no-verify-jwt` is required, not sloppiness: face
   sign-in happens *before* the resident has a session, so there is no JWT to
   verify. The function does its own input validation, IP-keyed lockout,
   distance thresholding and audit logging.

## The migrations

| # | File | What it does |
|---|---|---|
| 01 | `..._01_extensions_enums_helpers` | pgvector + pgcrypto, the enums, yearly reference-number counters |
| 02 | `..._02_profiles_and_services` | `profiles` (1:1 with `auth.users`), `is_staff()`, the service catalogue |
| 03 | `..._03_requests_and_history` | `document_requests` + the trigger-written audit trail |
| 04 | `..._04_blotter_anonymous_appointments_content` | blotter, anonymous messages, appointments, announcements, officials, settings |
| 05 | `..._05_biometrics` | `face_templates`, `auth_attempts`, `match_face()` |
| 06 | `..._06_row_level_security` | RLS on all 13 tables |
| 07 | `..._07_seed_reference_data` | the six services, five council seats, three notices, runtime settings |
| 08 | `..._08_storage_buckets` | private `valid-ids`, public `public-assets` |
| 09a | `..._09_security_hardening` | search_path pinning, trigger functions off the REST API, **column grants on `face_templates`** |
| 09b | `..._09_harden_functions_and_grants` | second advisor pass; swaps the enrollment view for `face_enrollment_status()` |
| 10 | `..._10_write_rpcs_for_no_select_tables` | `submit_anonymous_message()`, `enroll_face()` |
| 11 | `..._11_public_request_tracking` | `track_request()`, `track_blotter()` |
| 12 | `..._12_appointment_slot_availability` | `slot_counts()`, double-booking index |
| 13 | `..._13_guard_request_columns` | stops residents editing their own fee |
| 14 | `..._14_fix_compound_surname_matching` | fixes tracking for Filipino compound surnames |
| 15 | `..._15_admin_operations` | `approve_resident()`, `confirm_face_enrollment()`, `admin_stats()` |

### Why there are two migrations numbered 09

They were applied about an hour apart and overlap: both pin `search_path` and
revoke the trigger functions, which is harmless because every one of those
statements is idempotent. Where they genuinely differ is the enrollment-status
read path — 09a built a `security_invoker` view, 09b replaced it with the
`face_enrollment_status()` function the application actually calls.

They are kept as-is rather than squashed, because the applied history is what
the live database contains and rewriting it would make the files a fiction.
A fresh `db push` produces the same end state.

## What protects the biometric data

Worth stating precisely, because it is easy to overclaim:

- **No client role holds `SELECT` on `face_templates.descriptor`.** Not the
  resident it belongs to, not the barangay secretary. This is a *column* grant
  (09a) — Row Level Security is row-level and cannot hide a column.
- **A resident can read their own enrollment metadata** — which angles, when
  they were captured, whether the secretary has confirmed them. Staff can read
  that metadata for everyone. Neither can read the vector.
- **Descriptors leave the database only through `match_face()`**, which is
  granted to `service_role` alone and reached only from the `face-login` Edge
  Function.

So "nobody can read the face data" is true of the vector and false of the
metadata. The paper should say the former.

## Demo accounts

Not a migration, because seeding `auth.users` directly is a development
convenience rather than part of the schema. Run it from the SQL editor after
`db push`. All six accounts use the password `Ilawod!2026demo`.

`guard_profile_columns` has to be disabled around the seed: it correctly
refuses role and status changes from a non-staff caller, and a SQL console has
no `auth.uid()` to satisfy it.

See `seed/demo_accounts.sql`.
