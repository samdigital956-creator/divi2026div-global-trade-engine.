import { PLANNED_PROVIDERS } from "../extraction/registry";

export type IntegrationStatus = {
  category: "tracking" | "ai" | "ocr" | "tariff" | "messaging" | "billing";
  label: string;
  providers: string[];
  state: "not_configured" | "configured";
  note: string;
};

/** What the settings page shows. Nothing here is "connected" in Phase 1. */
export function integrationOverview(aiConfigured: boolean): IntegrationStatus[] {
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
      providers: ["Vizion", "SeaRates"],
      state: "not_configured",
      note: "Shipment timelines show manual and system events only.",
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
      providers: ["Email", "WhatsApp Business"],
      state: "not_configured",
      note: "No notifications are sent yet.",
    },
    {
      category: "billing",
      label: "Billing",
      providers: ["Subscription billing provider (TBD)"],
      state: "not_configured",
      note: "Plan limits are enforced from the plan catalogue.",
    },
  ];
}
