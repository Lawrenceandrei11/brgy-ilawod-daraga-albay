# Barangay E-Assist

A web-based barangay services system for **Barangay Ilawod**, with facial
biometric sign-in. Residents request clearances and certificates, file blotter
reports, book appointments at the hall, and send anonymous concerns; barangay
staff carry each request from filing through to release.

Built from an approved UI prototype; the design tokens still mirror the Figma
collections `E-Assist / Color` and `E-Assist / Scale` one-for-one.

---

## Running it

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill `.env.local` with your Supabase project URL and publishable key
(Project Settings → API), then:

```bash
npm run dev
```

Open http://localhost:5173.

> **The camera only works on `localhost` or over HTTPS.** `getUserMedia`
> requires a secure context, so opening the dev server from a phone at
> `http://192.168.x.x:5173` will silently fail to start the camera. Use the
> deployed HTTPS URL to demo face sign-in on a phone.

### Demo accounts

All use the password `Ilawod!2026demo`:

| Account | Role |
|---|---|
| `captain@brgyilawod.ph` | Punong Barangay |
| `secretary@brgyilawod.ph` | Barangay Secretary — approves registrations, moves requests |
| `treasurer@brgyilawod.ph` | Barangay Treasurer — records payments |
| `juan.delacruz@brgyilawod.ph` | Resident, approved |
| `maria.santos@brgyilawod.ph` | Resident, approved |
| `pedro.reyes@brgyilawod.ph` | Resident, **pending** — for demonstrating approval |

Database setup, including these accounts, is documented in
[`supabase/README.md`](supabase/README.md).

---

## How it is put together

```
Browser (React + Vite)              Supabase
├─ face-api.js, in-browser          ├─ Postgres + Row Level Security
│  └─ 128-float descriptor;         ├─ pgvector (face matching)
│     images never uploaded         ├─ Storage (private ID photos)
├─ @supabase/supabase-js            └─ Edge Function: face-login
└─ React Router                        (holds the service role key)
```

| Concern | Choice |
|---|---|
| Build | Vite + React (plain JS) |
| Styling | Plain CSS using the prototype's tokens — no framework |
| Data | `@tanstack/react-query` |
| Forms | `react-hook-form` + `zod` |
| Face engine | `@vladmandic/face-api`, weights served from `/public/models` |

### Face sign-in

The browser turns a webcam frame into 128 numbers and sends **only those
numbers**. Matching runs in Postgres via pgvector, inside an Edge Function that
holds the service role key. Doing it in the browser would have meant sending
every enrolled resident's template to anyone who opened the sign-in page.

Verifying someone who has no session yet is solved by minting a single-use
magic-link token for the matched resident, which the client exchanges for an
ordinary Supabase session.

Model weights are committed and served locally, so the system works with no
internet — the realistic condition in a barangay hall.

---

## What is actually enforced

Security lives in the database, not in hidden buttons. A resident holding a
valid token and calling the REST API directly still cannot:

- read another resident's requests, profile, blotter reports or appointments
- change their own role, status or Resident ID
- change the fee on their own request, or mark it paid
- read anyone's facial descriptor, including their own
- read an anonymous message, or discover who sent one

Availability without identity: a resident can see that a 9:00 appointment slot
is taken, but not who took it or why.

### The biometric data, stated precisely

- **No client role holds `SELECT` on `face_templates.descriptor`** — not the
  resident it belongs to, not the barangay secretary. This is a column grant;
  Row Level Security is row-level and cannot hide a column.
- A resident **can** read their own enrollment *metadata* — which angles, when,
  whether confirmed. Staff can read that metadata for everyone.
- Descriptors leave the database only through `match_face()`, granted to
  `service_role` alone.

So "nobody can read the face data" is true of the vector and false of the
metadata.

### Two honest limitations

1. **A face template is not reversible by ordinary means, but the stronger
   claim is not made.** Published research has partially reconstructed faces
   from embeddings of this kind. The privacy notice says what is true.
2. **Face verification does not prove physical presence.** A steady printed
   photograph can defeat it. Multi-frame stability rejects motion blur and
   half-turned heads, not a photo. This is why collecting a document at the
   hall still needs the secretary's in-person check — and why the UI says so
   rather than hiding it.

---

## Deploying

Both configs are in the repo; the SPA rewrite matters, because without it every
deep link 404s on refresh.

**Vercel** — import the repo, then set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` under Settings → Environment Variables. `vercel.json`
handles the rest.

**Netlify** — `netlify.toml` sets the build command, publish directory and
redirect. Add the same two environment variables under Site settings → Build &
deploy → Environment.

After the first deploy, add the deployed origin to Supabase under
Authentication → URL Configuration → Redirect URLs, or magic-link exchange
during face sign-in will be rejected.

---

## Layout

```
public/models/        face-api weights (committed, offline-safe)
public/assets/        artwork; missing files degrade to a labelled slot
src/styles/           tokens.css mirrors Figma; base.css; components.css
src/components/ui/    Button, Card, Badge, Field, Notice, Stepper, PngSlot
src/components/biometric/  FaceScanner + useFaceApi
src/pages/public/     landing, services, announcements, map, track, anonymous, privacy
src/pages/auth/       login, face login, register, enrol
src/pages/resident/   dashboard, requests, blotter, appointments, profile
src/pages/admin/      queue, review, residents, inbox, reports, content
supabase/migrations/  the schema, in the order it was applied
supabase/functions/   the face-login Edge Function
```

Artwork is still placeholder. Every image renders as a labelled dashed slot
until the real file is dropped into `public/assets/` under the name shown —
no code change needed.
