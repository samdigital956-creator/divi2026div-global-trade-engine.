# Roadmap — open work

Living list of what is deliberately not done yet. Update it when something ships.

## Waiting on the owner (keys / accounts)

| Item | What is needed | Then |
|---|---|---|
| Live test with a real container | A container or B/L number of a current shipment + shipping line | Verify map, ETA, milestones on production (uses 1 Traqo slot) |
| Traqo webhook | Create an endpoint in the Traqo dashboard → `https://<app>/api/webhooks/traqo`, events `*`; put the `whsec_…` secret in Railway as `TRAQO_WEBHOOK_SECRET` | Pushes update trackings within minutes instead of on page view / cron |
| More tracking providers | API keys for Vizion, SeaRates, Terminal49 or a carrier (Maersk DCSA) | Write an adapter in `src/lib/tracking/` mapping to `TrackingSnapshot`, register it in `registry.ts`, verify against the provider's current docs |
| Traqo paid plan | When volume exceeds the free plan (100 lookups/day, 30 req/min, no carrier auto-discovery) | No code change; consider `TRACKING_PROVIDERS` order |
| Malware scanning | ClamAV service on Railway (needs a larger plan) | Set `CLAMAV_HOST` / `CLAMAV_PORT`; code is ready |
| Billing | Choose a provider (Paddle suggested; confirm Pakistan eligibility) and create the account | Checkout, webhooks → `subscriptions`, plan changes, invoices |
| Map tiles at scale | A tile service (e.g. MapTiler, Stadia) key | Set `NEXT_PUBLIC_MAP_TILE_URL` / `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` and rebuild |

## Product work (no external dependency)

- Tariff data integration (official/licensed sources only) — Phase 5 candidate.
- WhatsApp Business notifications.
- Per-user notification preferences (today delay emails go to all owners/admins).
- Delete organization; clean up demo/test organizations created during live testing.
- Soft delete / archival of shipments and documents.
- Content-Security-Policy header.
- Make the GitHub repository private before onboarding large customers.

## Done (for reference)

- Phase 1 — multi-tenant foundation, RLS, documents, audit.
- Phase 2 — Gemini field extraction with human review.
- Phase 3 — invitation emails, rate limiting, malware-scan hook.
- Phase 4 — live tracking (Traqo), tracking dashboard, ETA-delay alerts + emails, webhook, scheduled sync (Railway `tracking-cron`, every 3 h at :17).
