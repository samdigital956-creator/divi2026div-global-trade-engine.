# Roadmap — open work by phase

Living list of what is deliberately not done yet. Tick items off (and move them to
"Done") when they ship. **Owner** = waiting on the account owner (key, account, decision);
**Dev** = code work that can start any time.

## Phase 1 — Foundation (multi-tenant, auth, shipments, documents, audit)

| # | Item | Who | Notes |
|---|---|---|---|
| 1.1 | Delete organization (owner only, with confirmation) | Dev | Cascade is in the schema; needs UI + audit + storage cleanup |
| 1.2 | Clean up demo/test organizations from live testing ("Tara Tracker", "Alex Importer", Track Co …) | Dev | After 1.1, or a one-off admin script; never touch the RVT organization |
| 1.3 | Soft delete / archival of shipments and documents | Dev | |
| 1.4 | Content-Security-Policy header | Dev | Must allow map tiles and Firebase Auth |
| 1.5 | Unknown/cross-tenant page ids return HTTP 200 with the 404 page (streaming) | Dev | No data leaks; status code only |
| 1.6 | After email verification the user must sign in again | Dev | Refresh the session claim instead |
| 1.7 | Make the GitHub repository private | Owner | Before onboarding large customers |

## Phase 2 — AI extraction (Gemini)

| # | Item | Who | Notes |
|---|---|---|---|
| 2.1 | OCR provider for poor scans | Owner + Dev | Interface exists; needs a provider key (e.g. Google Document AI) |
| 2.2 | TIFF uploads cannot be read by Gemini | Dev | Convert to PDF/PNG before extraction |
| 2.3 | Confidence is the model's own estimate (not calibrated) | Dev | Calibrate against confirmed values once there is real data |

## Phase 3 — Emails, rate limits, malware scanning

| # | Item | Who | Notes |
|---|---|---|---|
| 3.1 | ClamAV malware scanning service on Railway | Owner | Needs a larger Railway plan; code is ready (`CLAMAV_HOST`, `CLAMAV_PORT`) |
| 3.2 | Live verification of rate limits (429) | Dev | Covered by tests; live check blocked by rotating test IPs |

## Phase 4 — Live container tracking

| # | Item | Who | Notes |
|---|---|---|---|
| 4.1 | Live test with a real container | Owner | Send a current container/B/L number + shipping line; uses 1 Traqo slot |
| 4.2 | Traqo webhook | Owner | Endpoint `https://<app>/api/webhooks/traqo`, events `*`; secret (`whsec_…`) → Railway `TRAQO_WEBHOOK_SECRET` |
| 4.3 | Confirm first scheduled run of `tracking-cron` | Dev | Railway logs after 15:17 UTC; schedule `17 */3 * * *` |
| 4.4 | More tracking providers (Vizion, SeaRates, Terminal49, Maersk DCSA) | Owner + Dev | Keys first; then one adapter each in `src/lib/tracking/`, verified against current docs |
| 4.5 | Traqo paid plan | Owner | When volume exceeds free plan (100 lookups/day, 30 req/min, no carrier auto-discovery) |
| 4.6 | Commercial map tiles | Owner | Key for MapTiler/Stadia → `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` |
| 4.7 | Per-user notification preferences | Dev | Today delay emails go to every owner/admin |
| 4.8 | README cron-image line not yet on GitHub | Owner | Docs only; goes up with the next upload |

## Phase 5 — Billing (Paddle)

| # | Item | Who | Notes |
|---|---|---|---|
| 5.1 | Paddle sandbox account + keys | Owner | sandbox-vendors.paddle.com → API key, client-side token, notification destination (`/api/webhooks/paddle`) → Railway `PADDLE_*` |
| 5.2 | Create products/prices in Paddle (Growth, optionally Enterprise) and decide the prices | Owner | Price ids → `BILLING_PLAN_PRICES` |
| 5.3 | Sandbox end-to-end test (test card) | Dev | After 5.1–5.2 |
| 5.4 | Public website pages Paddle requires for approval: pricing, terms, privacy, refund policy, contact | Dev + Owner | Dev drafts; owner/lawyer reviews legal text |
| 5.5 | Paddle live account verification (business details, payout via bank/Payoneer) | Owner | Confirm Pakistan payout with Paddle support before going live |
| 5.6 | Switch to production keys (`PADDLE_ENV=production`) | Owner + Dev | |
| 5.7 | Trial expiry policy (e.g. 14 days, then read-only) | Owner decision + Dev | Today Trial never expires; limits reset monthly |
| 5.8 | Seat-based or usage-based pricing, annual plans | Owner decision + Dev | Optional |
| 5.9 | `SALES_CONTACT_EMAIL` for "contact us" plans | Owner | |

## Future phases

| Phase | Scope | Who |
|---|---|---|
| 6 — Tariff data | Official/licensed tariff sources only; classification stays with the licensed broker | Owner (source/licence) + Dev |
| 7 — WhatsApp | WhatsApp Business notifications | Owner (Meta account) + Dev |

## Done

- Phase 1 — multi-tenant foundation, RLS, documents, signed URLs, audit.
- Phase 2 — Gemini field extraction with human review (background, ~4 s).
- Phase 3 — invitation emails (Resend, trade.divinersdigital.io), rate limiting, malware-scan hook.
- Phase 4 — live tracking (Traqo), check-digit validation, tracking dashboard, ETA-delay alerts + emails, signed webhook route, scheduled sync (`tracking-cron`).
- Phase 5 (code) — Paddle checkout, plan change, customer portal, signed webhook, owner-only billing, monthly usage reset for unbilled orgs.
