import "server-only";
import type { AiExtractionProvider, ExtractionInput, FieldCandidate, ProviderStatus } from "./types";

/**
 * Google Gemini via the Interactions API (POST /v1beta/interactions).
 * The document is sent inline (base64) and the model returns JSON matching
 * a schema built from the document type's field list. Gemini reads PDFs and
 * images natively, so no separate OCR step is needed.
 *
 * Confidence is the model's own estimate, not a calibrated probability; every
 * value is still stored as unconfirmed and must be checked by a person.
 */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_MODEL = "gemini-3.8-flash";
const TIMEOUT_MS = 150_000;
// Field capture needs little reasoning; "low" keeps latency down on 3.x Flash models.
const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || "low";

const INPUT_TYPE: Record<string, "document" | "image"> = {
  "application/pdf": "document",
  "image/png": "image",
  "image/jpeg": "image",
};

export class UnsupportedFileError extends Error {}

export class GeminiExtractionProvider implements AiExtractionProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini";

  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY,
    private readonly model = process.env.GEMINI_MODEL || DEFAULT_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(): ProviderStatus {
    return this.apiKey
      ? { configured: true }
      : { configured: false, reason: "GEMINI_API_KEY is not set", requiredEnv: ["GEMINI_API_KEY"] };
  }

  async extractFields(input: ExtractionInput): Promise<FieldCandidate[]> {
    if (!this.apiKey) throw new Error("Gemini is not configured");
    const inputType = INPUT_TYPE[input.mimeType];
    if (!inputType) throw new UnsupportedFileError(`${input.mimeType} files cannot be read by Gemini`);

    const keys = input.fields.map((f) => f.key);
    const res = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: this.model,
        input: [
          { type: inputType, data: Buffer.from(input.bytes).toString("base64"), mime_type: input.mimeType },
          { type: "text", text: buildPrompt(input) },
        ],
        generation_config: { thinking_level: THINKING_LEVEL },
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              fields: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    key: { type: "string", enum: keys },
                    value: { type: "string", description: "Value exactly as it appears, normalised per the instructions." },
                    confidence: { type: "number", description: "0 to 1: how sure you are this value is printed on the document." },
                  },
                  required: ["key", "value", "confidence"],
                },
              },
            },
            required: ["fields"],
          },
        },
      }),
    });

    if (!res.ok) {
      // Never log the request (it contains the document); the status is enough.
      throw new Error(`Gemini request failed with HTTP ${res.status}`);
    }
    return parseInteraction(await res.json(), keys);
  }
}

function buildPrompt(input: ExtractionInput) {
  const lines = input.fields.map((f) => `- ${f.key}: ${f.label} (${f.type})`);
  return [
    `You are reading a shipping document of type "${input.documentTypeKey.replace(/_/g, " ")}".`,
    "Extract only the fields listed below, and only when the value is clearly printed on the document.",
    "If a field is missing, unreadable or you would have to guess, leave it out. Never invent or infer values.",
    "Formatting: dates as YYYY-MM-DD; numbers as plain digits with an optional decimal point (no currency symbols or thousands separators);",
    "currency as a 3-letter ISO code; country as it is written. Keep names and descriptions verbatim.",
    "This is data capture for human review, not a customs classification or declaration.",
    "Fields:",
    ...lines,
  ].join("\n");
}

type InteractionResponse = {
  status?: string;
  steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
};

/** Pull the JSON text out of an Interactions API response and validate it. */
export function parseInteraction(body: unknown, allowedKeys: string[]): FieldCandidate[] {
  const r = body as InteractionResponse;
  if (r.status && r.status !== "completed") throw new Error(`Gemini interaction status: ${r.status}`);
  const text = (r.steps ?? [])
    .filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
  if (!text) throw new Error("Gemini returned no output");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned output that is not valid JSON");
  }
  const fields = (parsed as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) throw new Error("Gemini output is missing the fields array");

  const allowed = new Set(allowedKeys);
  const seen = new Set<string>();
  const out: FieldCandidate[] = [];
  for (const f of fields as { key?: unknown; value?: unknown; confidence?: unknown }[]) {
    if (typeof f.key !== "string" || !allowed.has(f.key) || seen.has(f.key)) continue;
    if (typeof f.value !== "string" || f.value.trim() === "") continue;
    const confidence = typeof f.confidence === "number" && Number.isFinite(f.confidence) ? Math.min(Math.max(f.confidence, 0), 1) : 0;
    seen.add(f.key);
    out.push({ key: f.key, value: f.value.trim().slice(0, 4000), confidence });
  }
  return out;
}
