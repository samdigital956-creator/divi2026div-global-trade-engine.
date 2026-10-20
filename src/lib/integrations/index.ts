import { PLANNED_PROVIDERS } from "../extraction/registry";
import { KNOWN_TRACKING_PROVIDERS } from "../tracking/types";

export type IntegrationStatus = {
  category: "tracking" | "ai" | "ocr" | "tariff" | "messaging" | "billing";
  label: string;
  providers: string[];
  state: "not_configured" | "configured";
  note: string;
};

/** What the settings page shows. */
export function integrationOverview(aiConfigured: boolean, emailConfigured = false, trackingLabels: string[] = [], billingConfigured = false): IntegrationStatus[] {
  return [
    {
      category: "ai",
      label: "AI field extraction",
      providers: PLANNED_PROVIDERS.ai.map((p) => p.label),
      state: aiConfigured ? "configured" : "not_configured",
      note: aiConfigured
        ? "Google Gemini reads each upload; every value still requires human confirmation."
        : "No provider configured. Documents are reviewed with manual data entry.",
    },
    {
      category: "ocr",
      label: "OCR",
      providers: PLANNED_PROVIDERS.ocr.map((p) => p.label),
      state: "not_configured",
      note: "Optional pre-processing for scanned documents.",
    },
    {
      category: "tracking",
      label: "Container tracking",
      providers: KNOWN_TRACKING_PROVIDERS.map((p) => p.label),
      state: trackingLabels.length ? "configured" : "not_configured",
      note: trackingLabels.length
        ? `Live carrier milestones, ETA and vessel position via ${trackingLabels.join(", ")}. Other providers can be added alongside.`
        : "Shipment timelines show manual and system events only.",
    },
    {
      category: "tariff",
      label: "Tariff data",
      providers: ["Official / licensed tariff sources"],
      state: "not_configured",
      note: "No tariff data is shown. Classification decisions remain with your customs broker.",
    },
    {
      category: "messaging",
      label: "Email & WhatsApp",
      providers: ["Email (Resend)", "WhatsApp Business"],
      state: emailConfigured ? "configured" : "not_configured",
      note: emailConfigured ? "Invitation emails are sent through Resend. WhatsApp is not connected." : "No emails are sent. Set RESEND_API_KEY and EMAIL_FROM to send invitation emails.",
    },
    {
      category: "billing",
      label: "Billing",
      providers: ["Paddle (merchant of record)"],
      state: billingConfigured ? "configured" : "not_configured",
      note: billingConfigured
        ? "Owners can subscribe, change plan and manage payment under Settings → Billing."
        : "Plan limits are enforced from the plan catalogue. Set the PADDLE_* variables and BILLING_PLAN_PRICES to take payments.",
    },
  ];
}
