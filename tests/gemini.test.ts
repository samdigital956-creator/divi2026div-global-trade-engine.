import { afterEach, describe, expect, it } from "vitest";
import { GeminiExtractionProvider, parseInteraction, UnsupportedFileError } from "@/lib/extraction/gemini";
import { runExtraction, setExtractionProvidersForTesting } from "@/lib/extraction/registry";
import type { ExtractionInput } from "@/lib/extraction/types";
import { getDocument, listDocumentTypes, retryExtraction, saveDocumentFields, uploadDocument } from "@/server/documents";
import { createShipment } from "@/server/shipments";
import { makeOrg, PDF_BYTES } from "./support/fixtures";

const input: ExtractionInput = {
  documentId: "d",
  documentTypeKey: "commercial_invoice",
  mimeType: "application/pdf",
  bytes: PDF_BYTES,
  fields: [
    { key: "invoice_number", label: "Invoice number", type: "text", required: true },
    { key: "total_value", label: "Total", type: "number", required: true },
  ],
};

// Shape documented for POST /v1beta/interactions.
const reply = (json: unknown, status = "completed") => ({
  status,
  steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(json) }] }],
});

describe("Gemini provider", () => {
  it("is not configured without an API key", () => {
    expect(new GeminiExtractionProvider("").status().configured).toBe(false);
  });

  it("sends the document inline with a JSON schema and parses the reply", async () => {
    let sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify(reply({ fields: [{ key: "invoice_number", value: " INV-1 ", confidence: 0.93 }] })), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new GeminiExtractionProvider("test-key", "gemini-3.8-flash", fakeFetch);
    const out = await p.extractFields(input);
    expect(out).toEqual([{ key: "invoice_number", value: "INV-1", confidence: 0.93 }]);
    expect(sent!.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(sent!.headers["x-goog-api-key"]).toBe("test-key");
    const body = sent!.body as { model: string; input: { type: string; mime_type?: string; data?: string }[]; response_format: { mime_type: string; schema: { properties: { fields: { items: { properties: { key: { enum: string[] } } } } } } } };
    expect(body.model).toBe("gemini-3.8-flash");
    expect(body.input[0]).toMatchObject({ type: "document", mime_type: "application/pdf" });
    expect(Buffer.from(body.input[0].data!, "base64").equals(Buffer.from(PDF_BYTES))).toBe(true);
    expect(body.response_format.mime_type).toBe("application/json");
    expect(body.response_format.schema.properties.fields.items.properties.key.enum).toEqual(["invoice_number", "total_value"]);
  });

  it("drops unknown, duplicate and empty fields and clamps confidence", () => {
    const out = parseInteraction(
      reply({
        fields: [
          { key: "invoice_number", value: "A", confidence: 7 },
          { key: "invoice_number", value: "B", confidence: 0.5 },
          { key: "hs_code", value: "8471", confidence: 1 },
          { key: "total_value", value: "  ", confidence: 0.9 },
        ],
      }),
      ["invoice_number", "total_value"],
    );
    expect(out).toEqual([{ key: "invoice_number", value: "A", confidence: 1 }]);
  });

  it("rejects malformed or incomplete responses", () => {
    expect(() => parseInteraction({ steps: [] }, ["a"])).toThrow(/no output/);
    expect(() => parseInteraction({ steps: [{ type: "model_output", content: [{ type: "text", text: "not json" }] }] }, ["a"])).toThrow(/not valid JSON/);
    expect(() => parseInteraction(reply({}, "failed"), ["a"])).toThrow(/status/);
  });

  it("surfaces HTTP errors without leaking the document", async () => {
    const fakeFetch = (async () => new Response("quota", { status: 429 })) as unknown as typeof fetch;
    await expect(new GeminiExtractionProvider("k", "m", fakeFetch).extractFields(input)).rejects.toThrow("HTTP 429");
  });

  it("refuses file types Gemini cannot read", async () => {
    await expect(new GeminiExtractionProvider("k").extractFields({ ...input, mimeType: "image/tiff" })).rejects.toBeInstanceOf(UnsupportedFileError);
  });
});

describe("registry with Gemini", () => {
  afterEach(() => setExtractionProvidersForTesting(null));

  it("reports unsupported files as a manual-entry failure", async () => {
    setExtractionProvidersForTesting({ ai: new GeminiExtractionProvider("k") });
    const out = await runExtraction({ ...input, mimeType: "image/tiff" });
    expect(out).toMatchObject({ status: "failed", message: expect.stringMatching(/can't be read/) });
  });

  it("retry fills AI values but never overwrites values a person typed", async () => {
    const o = await makeOrg();
    const sid = await createShipment(o.ctx, { reference: "G-1", transportMode: "ocean" });
    const type = (await listDocumentTypes(o.ctx)).find((t) => t.key === "commercial_invoice")!;
    const id = await uploadDocument(o.ctx, { shipmentId: sid, documentTypeId: type.id, filename: "i.pdf", bytes: PDF_BYTES });
    expect((await getDocument(o.ctx, id)).extractionStatus).toBe("not_configured");
    await saveDocumentFields(o.ctx, id, { invoice_number: "TYPED-BY-HUMAN" });

    setExtractionProvidersForTesting({
      ai: {
        id: "gemini",
        label: "Gemini (test)",
        status: () => ({ configured: true }),
        extractFields: async () => [
          { key: "invoice_number", value: "AI-VALUE", confidence: 0.99 },
          { key: "currency", value: "USD", confidence: 0.9 },
        ],
      },
    });
    await retryExtraction(o.ctx, id);
    const doc = await getDocument(o.ctx, id);
    expect(doc.extractionStatus).toBe("completed");
    expect(doc.values.invoice_number).toMatchObject({ value: "TYPED-BY-HUMAN", source: "manual" });
    expect(doc.values.currency).toMatchObject({ value: "USD", source: "ai", requiresConfirmation: true });
  });
});
