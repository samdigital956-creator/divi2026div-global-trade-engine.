# Global Trade & Customs AI Engine — Phase 1

Multi-tenant B2B SaaS foundation for importers: organizations, team roles, shipments,
private document upload and human review, audit history, and provider-neutral
interfaces for future AI/OCR, tracking, tariff, messaging and billing integrations.

> Phase 1 performs **no** automatic customs declarations, tariff classification, live
> tracking or AI extraction. Where a capability isn't configured, the UI says so.

## Stack

| Concern | Choice |
|---|---|
| App | Next.js 16 (App Router, Server Actions), React 19, TypeScript, Tailwind CSS 4 |
| Database | PostgreSQL (Railway Postgres in production) via `pg`, plain SQL migrations |
| Auth | Firebase Authentication — httpOnly, revocable **session cookies** (Admin SDK) |
| Storage | Private S3-compatible bucket (Railway Storage Bucket) · local disk in dev |
| Validation | zod |
| Tests | Vitest against a real Postgres · Playwright smoke test with the Firebase Auth emulator |
| Hosting | Railway (`railway.json`: build, pre-deploy migrations, health check) |

## Architecture

```
Browser ── Firebase Auth (sign-in only, in-memory) ──► ID token
   │                                                      │
   └── POST /api/auth/session ◄───────────────────────────┘
          verifies token, sets httpOnly __session cookie
Server Components / Server Actions / Route handlers
   └─ lib/auth/session.ts   verify cookie (revocation-checked) → user → membership → TenantContext
       └─ src/server/*      permission check (lib/authz.ts) → withTenant()
           └─ PostgreSQL    SET LOCAL ROLE gtc_app + app.org_id → Row Level Security
```

- **Two layers of tenant isolation.** Every service function calls `assertCan(role, …)`
  and runs its SQL inside `withTenant(ctx, …)`, which switches to the restricted
  `gtc_app` role and binds `app.org_id`. RLS policies (`db/migrations/0002_rls.sql`)
  then limit every row read or written to that org, with `FORCE ROW LEVEL SECURITY`.
  A bug that forgets a `WHERE org_id = …` still cannot cross tenants.
- **Trusted bootstrap path.** `systemTx()` (no RLS) is used only for sign-in user
  mapping, listing *my* memberships, creating an org and accepting an invitation; every
  query there filters by the verified user id/email.
- **Active organization** is an httpOnly cookie, but it is only honoured if the user
  is a member; otherwise the user's first org is used.
- **Audit log** is append-only for the app role (no UPDATE/DELETE grants). Document
  uploads, rejected uploads, views, downloads, field edits/confirmations, approvals,
  rejections, member and settings changes are recorded with actor, IP and user agent.
- **Documents.** Upload validation checks size (20 MB), extension **and** magic bytes
  (PDF, PNG, JPEG, TIFF). Object keys contain only ids (`orgs/{org}/shipments/{s}/{doc}`).
  Downloads go through `/api/documents/:id/file`, which authorises, audits and
  redirects to a **60-second signed URL**. Nothing is publicly reachable.
- **Extraction adapter** (`src/lib/extraction`). `OcrProvider` and
  `AiExtractionProvider` interfaces + a registry selected by env. No vendor is
  implemented yet, so documents get `extraction_status = not_configured` and go to
  manual entry. Any machine value is stored with source/provider/confidence and
  `requires_confirmation = true`; approval is blocked until a person confirms or
  edits each one and all required fields are filled. Unknown fields returned by a
  provider are discarded.
- **Cache Components / PPR are disabled** on purpose: all pages are per-tenant.

### Roles

| | Owner | Admin | Member | Viewer |
|---|:-:|:-:|:-:|:-:|
| View shipments, documents, team | ✓ | ✓ | ✓ | ✓ |
| Create/edit shipments, upload, edit values, tasks | ✓ | ✓ | ✓ | |
| Approve/reject documents, manage members & settings, custom doc types, audit log | ✓ | ✓ | | |
| Change/remove owners | ✓ | | | |

The last owner can't be demoted or removed. Invitations can only be accepted by a user
whose **verified** email matches.

### Data model (see `db/migrations/0001_init.sql`)

`organizations`, `users` (maps Firebase uid → internal id; **no passwords**),
`organization_memberships`, `organization_invitations`, `subscription_plans`,
`subscriptions`, `usage_records`, `shipments`, `shipment_events`, `document_types`
(built-in + per-org custom with a JSON field schema), `shipment_documents`,
`extracted_fields`, `tasks`, `alerts`, `integration_configs` (non-secret settings only),
`audit_logs`. Child tables use composite `(org_id, id)` foreign keys so a row can never
reference another tenant's parent.

Plan limits (shipments/month, documents/month, storage, seats) are enforced from
`subscription_plans`; new orgs start on `trial`.

## Local setup (macOS)

```bash
# 1. Prerequisites
brew install node@22 postgresql@16 && brew services start postgresql@16
createdb gtc_dev && createdb gtc_test

# 2. Install
npm install
cp .env.example .env.local      # fill APP_SECRET (openssl rand -base64 48)

# 3. Database
export $(grep -v '^#' .env.local | xargs)   # or use direnv
npm run db:migrate
npm run db:seed                 # optional, development only

# 4. Auth — choose one
#  a) Firebase Auth emulator (no Google account needed; needs Java for some emulators, not auth)
npm run emulator                # in another terminal
#     and in .env.local:
#     FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
#     FIREBASE_PROJECT_ID=demo-gtc  FIREBASE_WEB_API_KEY=demo-key  FIREBASE_AUTH_DOMAIN=localhost
#  b) Real Firebase project — see "Authentication" below.

# 5. Run
npm run dev                     # http://localhost:3000
```

Local `DATABASE_URL` must use a superuser (default `postgres`) because migrations
create the `gtc_app` role and the bootstrap path must bypass RLS.

### Authentication (Firebase)

1. Firebase console → create project → **Authentication → Sign-in method → Email/Password** (enable).
2. **Authentication → Settings → Authorized domains**: add your Railway domain.
3. Project settings → *Your apps* → add a **Web app** → copy `apiKey`, `authDomain`,
   `projectId`, `appId` → `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`,
   `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`.
4. Project settings → **Service accounts → Generate new private key** → put the JSON
   (or its base64) in `FIREBASE_SERVICE_ACCOUNT_JSON`. This is a secret: server env only.

Without these the login page shows an "Authentication is not configured" state.

## Testing

```bash
npm run lint && npm run typecheck
npm test              # Vitest — drops & recreates the schema in TEST_DATABASE_URL
npm run build

# End-to-end (needs emulator + running app):
npm run emulator &
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_PROJECT_ID=demo-gtc \
FIREBASE_WEB_API_KEY=demo-key FIREBASE_AUTH_DOMAIN=localhost npm run dev &
npm run test:e2e -- http://localhost:3000 ./e2e-screenshots
```

What is covered:

- `tests/tenant-isolation.test.ts` — two orgs: list/read/update/upload/download/approve/
  task/member operations across tenants fail; raw SQL under RLS returns nothing,
  updates/deletes affect 0 rows, cross-tenant INSERT violates RLS, unbound context sees
  nothing, audit log is append-only, subscriptions are read-only, users are scoped.
- `tests/authorization.test.ts` — role matrix; viewer/member/admin/owner boundaries; last-owner protection.
- `tests/shipments.test.ts` — CRUD, search/filter, validation messages, duplicate refs, timeline, plan limit.
- `tests/documents.test.ts` — file type/size/content-spoofing rejection, filename sanitising,
  rejected-upload audit, not-configured extraction, field validation, approval blockers,
  AI values requiring confirmation (test double), provider failure, signed URL expiry and tampering, custom types.
- `tests/accounts-and-routes.test.ts` — session route (httpOnly/SameSite cookie, bad token,
  cross-site origin, revocation on sign-out), org creation, invitation acceptance rules,
  unauthenticated/forged/cross-site upload & download requests, org-cookie spoofing.
- `e2e/smoke.mjs` — real browser: register → onboarding → create org → shipment (with
  validation) → invalid & valid upload → signed download → manual values → approve →
  invite → audit → mobile layout → second org gets "not found" and no data → sign out → login.

## Deploying to Railway

`railway.json` builds with Railpack, runs `node scripts/migrate.mjs` as the pre-deploy
step, starts the standalone server and health-checks `/api/health`.

Services: **Postgres**, a **Storage Bucket**, and this app. App variables:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
APP_SECRET=<random 48+ chars>
STORAGE_DRIVER=s3
S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY  (from the bucket's credentials)
FIREBASE_WEB_API_KEY / FIREBASE_AUTH_DOMAIN / FIREBASE_PROJECT_ID / FIREBASE_APP_ID
FIREBASE_SERVICE_ACCOUNT_JSON=<secret>
```

## Phase 2 — AI extraction (Google Gemini)

Set `GEMINI_API_KEY`. Uploads return immediately and Gemini reads the file in the
background (Interactions API, inline PDF/PNG/JPEG, JSON-schema output); the review page
shows "AI is reading…" and refreshes. Every AI value is stored as unconfirmed with the
model's self-reported confidence and must be confirmed or corrected before approval.
"Read with AI" re-runs extraction without overwriting values a person typed. TIFF files
are not supported by Gemini and fall back to manual entry. Documents are sent to Google
for processing.

## Phase 3 — Emails, rate limits, malware scanning

- **Invitation emails** via Resend (`RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`). Delivery
  status is stored per invitation; failed emails can be resent. Without configuration,
  invitations are still created and the UI says no email was sent.
- **Rate limits** (Postgres fixed windows, shared across instances): sign-in 20/10 min
  per IP, uploads 60/10 min per user, invitations 30/hour per organization. Responses are
  HTTP 429 with `Retry-After`.
- **Malware scanning** with ClamAV (`CLAMAV_HOST`/`CLAMAV_PORT`, clamd INSTREAM). Files are
  scanned before storage; infected files are refused and audited; if a configured scanner
  is unreachable the upload fails closed (HTTP 503). Each document shows its scan result.

## Phase 4 — Live container tracking

- **Provider-neutral layer** (`src/lib/tracking`): every provider maps into one snapshot
  shape. Traqo is implemented (170+ lines per the provider); Vizion, SeaRates, Terminal49
  and Maersk DCSA are listed and plug in as adapters once keys exist. `TRACKING_PROVIDERS`
  sets the order; the first provider that recognises a reference wins.
- **On a shipment**, enter a container or B/L (prefilled from the shipment) and optionally
  the carrier SCAC (recommended on Traqo's free plan, which has no auto-discovery). The page
  shows carrier status, ETA/ATA, vessel, route and last reported position on a map.
- **Timeline**: carrier milestones are de-duplicated by the provider's event id and badged
  "Carrier · Traqo"; planned (estimated) milestones are marked "Planned".
- **ETA**: the shipment ETA follows the carrier; a slip of 1+ day raises a warning alert,
  3+ days a critical one.
- **Status** only moves forward on proven data (in transit, at port, delivered). Customs
  states are never set or skipped by carrier data, except a verified delivery.
- **Freshness**: opening a shipment refreshes references not checked for 2h (after the
  response). `POST /api/webhooks/traqo` (HMAC-verified with `TRAQO_WEBHOOK_SECRET`,
  de-duplicated by `X-Traqo-Delivery`) re-reads the provider on push; the payload itself is
  never stored. `POST /api/cron/tracking` with `Authorization: Bearer $CRON_SECRET`
  refreshes stale references (50 per run).
- **Limits**: plan `monthly_tracking_limit` (Trial 5, Growth 200, Enterprise unlimited) is
  checked before any provider call; 30 starts and 120 manual refreshes per org per hour.
- **No fake data**: provider demo/sandbox responses are refused in production.
- `node e2e/tracking.mjs` walks through the flow against Traqo's sandbox.

## Known limitations

- Tariff, WhatsApp and billing providers are interfaces only (`docs/INTEGRATIONS.md`). Tracking adapters other than Traqo are not built yet.
- Map tiles default to OpenStreetMap's public servers, which are meant for light use; set `NEXT_PUBLIC_MAP_TILE_URL` to a commercial tile service before heavy use.
- After verifying their email a user must sign in again for the new status to apply.
- Malware scanning needs a ClamAV service; documents uploaded while it is not configured are marked "not scanned".
- Invitation emails need a verified sending domain in Resend.
- No Content-Security-Policy header yet (other security headers are set).
- With `loading.tsx` streaming, a cross-tenant/unknown id renders the 404 page but may return HTTP 200 for page routes (API routes return 404). No data is rendered.
- Soft delete / archival of shipments and documents is not implemented.
