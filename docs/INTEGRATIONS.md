# Integration plan

Interfaces live in `src/lib/integrations/*` and `src/lib/extraction/types.ts`. Nothing
below is implemented or called in Phase 1. Before building each adapter:
**verify current API documentation, pricing, licensing/data-processing terms, required
credentials and permissions**, then add the adapter behind its interface with tests that
use recorded *real* responses (never invented fixtures presented as real).

| Area | Candidates | Interface | Notes / prerequisites |
|---|---|---|---|
| AI field extraction | Anthropic Claude, OpenAI | `AiExtractionProvider` | Choose model + region; review data retention and zero-retention options; values always stored as `source=ai`, `requires_confirmation=true`. |
| OCR | Google Document AI, Azure AI Document Intelligence | `OcrProvider` | Processor/endpoint per region; optional if the AI provider reads PDFs natively. |
| Container tracking | **Traqo (live)**; Vizion, SeaRates, Terminal49, Maersk DCSA (planned) | `TrackingProvider` in `src/lib/tracking/types.ts` | Traqo adapter, webhook (HMAC) and scheduled sync are implemented. A new provider = one adapter mapping to `TrackingSnapshot` + registration in `registry.ts`; events stored with `source` = provider id. |
| Tariff data | Official national tariff publications, licensed commercial datasets | `TariffDataSource` | Licence terms for storage/display; suggestions only — no final classification. |
| Messaging | Transactional email provider, WhatsApp Business Platform | `MessagingChannel` | WhatsApp requires approved templates and a verified business. |
| Billing | Subscription billing provider (TBD) | `BillingProvider` | Webhooks update `subscriptions`; prices remain in the provider. |

Secrets for every provider go in server environment variables (or a secret manager);
`integration_configs.secret_ref` only stores the *name* of the secret.
