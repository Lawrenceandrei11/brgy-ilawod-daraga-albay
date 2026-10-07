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
2. **Deploy the Edge Functions** — `supabase functions deploy face-login` and
   `supabase functions deploy sms-dispatch`. Both are pinned to
   `verify_jwt = false` in `config.toml`, which is why the flag no longer
   appears here. For `face-login` that is required, not sloppiness: face
   sign-in happens *before* the resident has a session, so there is no JWT to
   verify. The function does its own input validation, IP-keyed lockout,
   distance thresholding and audit logging.

3. **Turn on SMS** — see below. Until you do, migration 16 leaves
   `settings.sms_enabled` at `false` and nothing is ever sent.

## Switching SMS on

Migration 16 adds the outbox, the trigger and the schedule, but ships dark on
purpose: a deploy that immediately texted the whole barangay would be a bad
first impression. Five steps, in order.

1. **Enable the extensions** — Dashboard → Database → Extensions → turn on
   `pg_cron` and `pg_net`. The migration tries to create them itself and
   downgrades to a warning if it lacks the privilege, so check they are on.

2. **Set the function secrets.** These never enter the repository, the
   database, or the browser bundle. `SMS_API_KEY` is your **Semaphore** API
   key — `sms-dispatch` calls Semaphore's official API
   (`api.semaphore.co/api/v4/messages`) directly:

   ```bash
   supabase secrets set SMS_API_KEY=<your Semaphore API key> SMS_DISPATCH_SECRET=$(openssl rand -hex 32)
   ```

   Setting it in Dashboard → Edge Functions → Secrets instead keeps the key
   out of your shell history.

3. **Give the cron job the same dispatch secret**, from the SQL editor. It is
   stored in Vault rather than in the migration for the obvious reason:

   ```sql
   select vault.create_secret('<the same hex>', 'sms_dispatch_secret', 'cron -> sms-dispatch');
   update settings set value = jsonb_build_object('value',
     'https://<project-ref>.supabase.co/functions/v1/sms-dispatch')
   where key = 'sms_dispatch_url';
   ```

4. **Test against one handset before anyone else gets a text:**

   ```sql
   update settings set value = '{"value": "09XXXXXXXXX"}'::jsonb where key = 'sms_test_recipient';
   update settings set value = '{"value": 20}'::jsonb            where key = 'sms_daily_cap';
   update settings set value = '{"value": true}'::jsonb          where key = 'sms_enabled';
   ```

   Every message now goes to that number, whoever it was addressed to. The
   admin **Text messages** screen shows both: `recipient` is who it was for,
   `sent_to` is where it actually went.

   Three Semaphore facts worth knowing before the first test:

   - **Every text costs a credit, redirected tests included.** Test with one
     queued message, not an announcement: in test mode a notice to twenty
     residents is twenty paid texts to your own phone. `sms_daily_cap` is the
     spending guard.
   - **Sender Name** comes from `settings.sms_semaphore_sendername`. Left
     unset, none is sent and Semaphore uses the account's default; an account
     with no approved name has none and refuses the text. Use `SEMAPHORE`
     until the barangay's own name is approved, then set it to that name. A
     name still pending approval is refused.
   - **Accepted is not delivered.** `status = sent` means Semaphore took the
     message. `provider_response.message_id` is the one to look up in the
     Semaphore dashboard, which shows whether the network delivered it.
     Messages beginning with the word "TEST" are silently dropped by the
     networks.

5. **Go live** — clear `sms_test_recipient` back to `{"value": null}` and
   raise `sms_daily_cap`. `sms_enabled` can be switched off again at any time
   by the captain; nothing queues while it is off.

### Why SMS is a queue

Texts go out at most **one every ten seconds**. Semaphore itself accepts far
more (120 requests a minute), but every text costs a credit, so this pacing,
together with `sms_daily_cap`, is what stops a runaway loop from spending the
barangay's balance. A notice sent to two hundred residents therefore takes
over half an hour, which cannot happen inside one HTTP request. So `sms_messages` is an outbox: the trigger and the
announcement RPC only ever write a row, `pg_cron` ticks every ten seconds, and
`claim_sms()` hands out at most one message at a time.

The consequence worth knowing: **queueing a text never touches the network.**
If the provider is down, rows sit in the queue and approving a clearance,
releasing a document and publishing a notice all carry on exactly as before.

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
| 16 | `..._16_sms_notifications` | the `sms_messages` outbox, `profiles.sms_opt_in`, the status trigger, `claim_sms()` and the pg_cron tick |

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

## SMS providers

Two providers are wired in and exactly one is active, chosen by the
`sms_provider` setting. Nothing else about SMS changes with the provider:
the queue, the pacing, the retry policy, the daily cap, the test redirect and
the `sms_messages` log are all provider-neutral.

| Setting | Value | Meaning |
| --- | --- | --- |
| `sms_provider` | `semaphore` | `httpsms` | Which one sends. Anything unrecognised falls back to `semaphore`. |
| `sms_semaphore_sendername` | e.g. `BRGYILAWOD` | Semaphore only. The approved Sender Name. |
| `httpsms_from` | e.g. `+639XXXXXXXXX` | httpSMS only. The number of the Android phone signed in to the account. |

Each provider has its own secret, so switching back does not mean putting the
other one's key back:

```
supabase secrets set SMS_API_KEY=<Semaphore key>
supabase secrets set HTTPSMS_API_KEY=<httpSMS key>
```

**Semaphore** is the barangay's real provider. It refuses to send until the
telcos approve the Sender Name, which is why `httpsms` is active for now.

**httpSMS** relays through an Android handset on an ordinary SIM, so it needs
nobody's approval. The cost is that residents see that handset's mobile
number rather than `BRGYILAWOD`: the message is a real SMS from a real SIM,
and no app on a phone can set an alphanumeric sender. The phone also has to be
on, in signal and in credit, or messages sit in the queue.

Switching back once BRGYILAWOD is approved is two rows and no deploy, because
the function re-reads its settings on every invocation:

```sql
update settings set value = '{"value": "semaphore"}'::jsonb  where key = 'sms_provider';
update settings set value = '{"value": "BRGYILAWOD"}'::jsonb where key = 'sms_semaphore_sendername';
```

## Demo accounts

Not a migration, because seeding `auth.users` directly is a development
convenience rather than part of the schema. Run it from the SQL editor after
`db push`. All six accounts use the password `Ilawod!2026demo`.

`guard_profile_columns` has to be disabled around the seed: it correctly
refuses role and status changes from a non-staff caller, and a SQL console has
no `auth.uid()` to satisfy it.

See `seed/demo_accounts.sql`.
