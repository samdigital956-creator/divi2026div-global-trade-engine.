/**
 * Provider-neutral contracts for document understanding.
 *
 * The pipeline is: stored file → OcrProvider (text + layout) → AiExtractionProvider
 * (structured field candidates) → human review. Either stage can be swapped by
 * registering another implementation in ./registry.ts; nothing else in the app
 * depends on a concrete vendor.
 *
 * Providers must never fabricate values: if they cannot read a field they omit it.
 * All machine output is stored with source/provider/confidence and
 * requires human confirmation before a document can be approved.
 */

export type FieldDefinition = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date";
  required: boolean;
};

export type ExtractionInput = {
  documentId: string;
  documentTypeKey: string;
  mimeType: string;
  bytes: Uint8Array;
  fields: FieldDefinition[];
};

export type OcrResult = {
  provider: string;
  text: string;
  pages: number;
};

export type FieldCandidate = {
  key: string;
  value: string;
  /** 0..1 as reported (or calibrated) by the provider. */
  confidence: number;
};

export type ProviderStatus =
  | { configured: true }
  | { configured: false; reason: string; requiredEnv: string[] };

export interface OcrProvider {
  readonly id: string; // e.g. "google-document-ai", "azure-document-intelligence"
  readonly label: string;
  status(): ProviderStatus;
  recognise(input: ExtractionInput): Promise<OcrResult>;
}

export interface AiExtractionProvider {
  readonly id: string; // e.g. "anthropic", "openai"
  readonly label: string;
  status(): ProviderStatus;
  /** `ocr` is null when the provider reads the file natively (e.g. multimodal PDF input). */
  extractFields(input: ExtractionInput, ocr: OcrResult | null): Promise<FieldCandidate[]>;
}

export type ExtractionOutcome =
  | { status: "not_configured"; message: string }
  | { status: "completed"; provider: string; candidates: FieldCandidate[] }
  | { status: "failed"; provider: string; message: string };
