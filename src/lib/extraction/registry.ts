import "server-only";
import type { AiExtractionProvider, ExtractionInput, ExtractionOutcome, OcrProvider, ProviderStatus } from "./types";

/**
 * Provider registry. Phase 1 ships NO live provider: vendor adapters will be
 * added after their current API docs, pricing, data-processing terms and
 * credentials have been reviewed (see docs/INTEGRATIONS.md). Until then every
 * document is routed to manual entry and the UI states that clearly.
 *
 * To add one: implement OcrProvider / AiExtractionProvider in this folder and
 * add it to the arrays below, selected by EXTRACTION_OCR_PROVIDER /
 * EXTRACTION_AI_PROVIDER.
 */
const ocrProviders: OcrProvider[] = [];
const aiProviders: AiExtractionProvider[] = [];

export const PLANNED_PROVIDERS = {
  ocr: [
    { id: "google-document-ai", label: "Google Document AI", env: ["GOOGLE_DOCUMENT_AI_PROCESSOR", "GOOGLE_APPLICATION_CREDENTIALS"] },
    { id: "azure-document-intelligence", label: "Azure AI Document Intelligence", env: ["AZURE_DOCINTEL_ENDPOINT", "AZURE_DOCINTEL_KEY"] },
  ],
  ai: [
    { id: "anthropic", label: "Anthropic Claude", env: ["ANTHROPIC_API_KEY"] },
    { id: "openai", label: "OpenAI", env: ["OPENAI_API_KEY"] },
  ],
} as const;

let overrides: { ocr?: OcrProvider | null; ai?: AiExtractionProvider | null } | null = null;

export function setExtractionProvidersForTesting(p: typeof overrides) {
  overrides = p;
}

function select<T extends { id: string; status(): ProviderStatus }>(list: T[], envName: string): T | null {
  const wanted = process.env[envName];
  const p = wanted ? list.find((x) => x.id === wanted) : undefined;
  return p && p.status().configured ? p : null;
}

export function activeProviders() {
  if (overrides) return { ocr: overrides.ocr ?? null, ai: overrides.ai ?? null };
  return {
    ocr: select(ocrProviders, "EXTRACTION_OCR_PROVIDER"),
    ai: select(aiProviders, "EXTRACTION_AI_PROVIDER"),
  };
}

export function extractionConfigured(): boolean {
  return activeProviders().ai !== null;
}

export async function runExtraction(input: ExtractionInput): Promise<ExtractionOutcome> {
  const { ocr, ai } = activeProviders();
  if (!ai) {
    return {
      status: "not_configured",
      message: "No AI extraction provider is configured. Enter the values from the document manually.",
    };
  }
  try {
    const text = ocr ? await ocr.recognise(input) : null;
    const allowed = new Set(input.fields.map((f) => f.key));
    const candidates = (await ai.extractFields(input, text)).filter(
      (c) => allowed.has(c.key) && typeof c.value === "string" && c.value.trim() !== "",
    );
    return { status: "completed", provider: ocr ? `${ocr.id}+${ai.id}` : ai.id, candidates };
  } catch (err) {
    console.error("[extraction] provider error", err);
    return { status: "failed", provider: ai.id, message: "The extraction provider returned an error. Enter values manually or retry later." };
  }
}
