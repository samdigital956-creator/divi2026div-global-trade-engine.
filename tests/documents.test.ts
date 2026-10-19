import { afterEach, describe, expect, it } from "vitest";
import { ValidationError, ConflictError } from "@/lib/errors";
import { setExtractionProvidersForTesting } from "@/lib/extraction/registry";
import type { AiExtractionProvider } from "@/lib/extraction/types";
import { storage } from "@/lib/storage";
import { LocalStorageDriver } from "@/lib/storage/local";
import { MAX_UPLOAD_BYTES, validateUpload } from "@/lib/uploads";
import {
  approvalBlockers,
  approveDocument,
  confirmField,
  createDocumentType,
  documentAccessUrl,
  getDocument,
  listDocumentTypes,
  rejectDocument,
  reopenDocument,
  saveDocumentFields,
  uploadDocument,
} from "@/server/documents";
import { listAuditLogs } from "@/server/organization";
import { createShipment } from "@/server/shipments";
import { listOpenAlerts, listTasks } from "@/server/work";
import { makeOrg, PDF_BYTES, PNG_BYTES } from "./support/fixtures";

async function setup() {
  const o = await makeOrg();
  const shipmentId = await createShipment(o.ctx, { reference: "DOC-1", transportMode: "ocean" });
  const types = await listDocumentTypes(o.ctx);
  const type = (key: string) => types.find((t) => t.key === key)!;
  return { ...o, shipmentId, type };
}

describe("upload validation", () => {
  it("accepts real PDFs and images", () => {
    expect(validateUpload("invoice.PDF", PDF_BYTES).mime).toBe("application/pdf");
    expect(validateUpload("scan.png", PNG_BYTES).mime).toBe("image/png");
  });

  it("rejects disallowed types, spoofed content, empty and oversized files", () => {
    expect(() => validateUpload("evil.exe", new Uint8Array([0x4d, 0x5a, 1, 2]))).toThrow(/Unsupported/);
    expect(() => validateUpload("page.html", new TextEncoder().encode("<html>"))).toThrow(/Unsupported/);
    expect(() => validateUpload("fake.pdf", new TextEncoder().encode("<script>alert(1)</script>"))).toThrow(/does not match/);
    expect(() => validateUpload("empty.pdf", new Uint8Array())).toThrow(/empty/);
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PDF_BYTES);
    expect(() => validateUpload("big.pdf", big)).toThrow(/20 MB/);
  });

  it("strips paths and control characters from filenames", () => {
    expect(validateUpload("../../etc/pass\u0000wd.pdf", PDF_BYTES).filename).toBe("passwd.pdf");
  });

  it("audits rejected uploads and stores nothing", async () => {
    const { ctx, shipmentId, type } = await setup();
    await expect(
      uploadDocument(ctx, { shipmentId, documentTypeId: type("other").id, filename: "x.pdf", bytes: new TextEncoder().encode("nope") }),
    ).rejects.toBeInstanceOf(ValidationError);
    const logs = await listAuditLogs(ctx, { action: "upload.rejected" });
    expect(logs.items).toHaveLength(1);
  });
});

describe("document workflow without an AI provider", () => {
  it("uploads privately, marks extraction as not configured, and requires manual values before approval", async () => {
    const { ctx, shipmentId, type } = await setup();
    const id = await uploadDocument(ctx, { shipmentId, documentTypeId: type("commercial_invoice").id, filename: "inv.pdf", bytes: PDF_BYTES });
    const doc = await getDocument(ctx, id);
    expect(doc).toMatchObject({ status: "needs_review", extractionStatus: "not_configured", mimeType: "application/pdf" });
    expect(doc.values).toEqual({}); // nothing invented
    expect(approvalBlockers(doc).length).toBeGreaterThan(0);
    await expect(approveDocument(ctx, id)).rejects.toThrow(/Cannot approve yet/);

    // Review task was created
    expect((await listTasks(ctx, { status: "open" })).some((t) => t.documentId === id)).toBe(true);

    await expect(saveDocumentFields(ctx, id, { total_value: "abc", invoice_date: "31/12/2026" })).rejects.toMatchObject({
      fieldErrors: { total_value: "Enter a number.", invoice_date: "Use YYYY-MM-DD." },
    });

    await saveDocumentFields(ctx, id, {
      invoice_number: "INV-77",
      invoice_date: "2026-10-01",
      seller_name: "Shenzhen Widgets Ltd",
      buyer_name: "Acme Imports Inc",
      currency: "USD",
      total_value: "12,500.00",
      goods_description: "Plastic widgets",
    });
    const filled = await getDocument(ctx, id);
    expect(filled.extractionStatus).toBe("manual");
    expect(filled.values.total_value).toMatchObject({ value: "12500.00", source: "manual", requiresConfirmation: false });

    await approveDocument(ctx, id);
    expect((await getDocument(ctx, id)).status).toBe("approved");
    expect((await listTasks(ctx, { status: "open" })).some((t) => t.documentId === id)).toBe(false);
    await expect(saveDocumentFields(ctx, id, { invoice_number: "CHANGED" })).rejects.toBeInstanceOf(ConflictError);

    await reopenDocument(ctx, id);
    await rejectDocument(ctx, id, "Invoice total does not match PO");
    expect((await getDocument(ctx, id)).status).toBe("rejected");
    expect((await listOpenAlerts(ctx)).length).toBe(1);

    const actions = (await listAuditLogs(ctx)).items.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["document.uploaded", "document.extraction_attempted", "document.fields_updated", "document.approved", "document.reopened", "document.rejected"]),
    );
  });

  it("issues short-lived signed links, audits every access, and rejects tampered or expired tokens", async () => {
    const { ctx, shipmentId, type } = await setup();
    const id = await uploadDocument(ctx, { shipmentId, documentTypeId: type("packing_list").id, filename: "pl.pdf", bytes: PDF_BYTES });
    const url = await documentAccessUrl(ctx, id, "view");
    expect(url).toMatch(/^\/api\/storage\/local\?t=/);
    const store = storage() as LocalStorageDriver;
    const token = new URL(url, "http://x").searchParams.get("t")!;
    const payload = store.verify(token)!;
    expect(payload.e - Date.now() / 1000).toBeLessThanOrEqual(60);
    expect(Buffer.from(await store.read(payload.k)).equals(Buffer.from(PDF_BYTES))).toBe(true);
    expect(payload.k).not.toContain("pl.pdf");

    expect(store.verify(token.slice(0, -2) + "xx")).toBeNull();
    const expired = store.sign({ ...payload, e: Math.floor(Date.now() / 1000) - 1 });
    expect(store.verify(expired)).toBeNull();

    await documentAccessUrl(ctx, id, "download");
    const actions = (await listAuditLogs(ctx, { action: "document." })).items.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["document.viewed", "document.downloaded"]));
  });
});

describe("document workflow with an AI provider (test double)", () => {
  afterEach(() => setExtractionProvidersForTesting(null));

  it("stores machine values as unconfirmed and blocks approval until a person confirms them", async () => {
    const fake: AiExtractionProvider = {
      id: "test-ai",
      label: "Test",
      status: () => ({ configured: true }),
      extractFields: async () => [
        { key: "bl_number", value: "MEDU123", confidence: 0.97 },
        { key: "shipper", value: "Widgets Ltd", confidence: 0.6 },
        { key: "not_in_schema", value: "ignored", confidence: 1 },
      ],
    };
    setExtractionProvidersForTesting({ ai: fake });
    const { ctx, shipmentId, type } = await setup();
    const id = await uploadDocument(ctx, { shipmentId, documentTypeId: type("bill_of_lading").id, filename: "bl.pdf", bytes: PDF_BYTES });
    const doc = await getDocument(ctx, id);
    expect(doc.extractionStatus).toBe("completed");
    expect(Object.keys(doc.values).sort()).toEqual(["bl_number", "shipper"]);
    expect(doc.values.shipper).toMatchObject({ source: "ai", requiresConfirmation: true, confidence: 0.6 });

    await saveDocumentFields(ctx, id, { consignee: "Acme", port_of_loading: "Yantian", port_of_discharge: "Long Beach" });
    expect(approvalBlockers(await getDocument(ctx, id))).toEqual(["B/L number needs confirmation.", "Shipper needs confirmation."]);

    await confirmField(ctx, id, "bl_number");
    await saveDocumentFields(ctx, id, { shipper: "Widgets Limited" }); // human correction counts as confirmation
    const ready = await getDocument(ctx, id);
    expect(ready.values.shipper).toMatchObject({ source: "manual", requiresConfirmation: false });
    expect(approvalBlockers(ready)).toEqual([]);
    await approveDocument(ctx, id);
  });

  it("records provider failures without inventing values", async () => {
    setExtractionProvidersForTesting({
      ai: { id: "broken", label: "Broken", status: () => ({ configured: true }), extractFields: async () => { throw new Error("boom"); } },
    });
    const { ctx, shipmentId, type } = await setup();
    const id = await uploadDocument(ctx, { shipmentId, documentTypeId: type("other").id, filename: "o.pdf", bytes: PDF_BYTES });
    const doc = await getDocument(ctx, id);
    expect(doc).toMatchObject({ extractionStatus: "failed", status: "needs_review" });
    expect(doc.values).toEqual({});
  });
});

describe("custom document types", () => {
  it("lets admins configure additional types visible only to their org", async () => {
    const A = await makeOrg();
    const B = await makeOrg();
    await createDocumentType(A.ctx, { name: "Import permit", fields: "Permit number | text | required\nExpiry date | date\nNotes | textarea" });
    const a = await listDocumentTypes(A.ctx);
    const permit = a.find((t) => t.key === "import_permit")!;
    expect(permit.fields).toEqual([
      { key: "permit_number", label: "Permit number", type: "text", required: true },
      { key: "expiry_date", label: "Expiry date", type: "date", required: false },
      { key: "notes", label: "Notes", type: "textarea", required: false },
    ]);
    expect((await listDocumentTypes(B.ctx)).some((t) => t.key === "import_permit")).toBe(false);
    await expect(createDocumentType(A.ctx, { name: "Import permit", fields: "Number" })).rejects.toBeInstanceOf(ConflictError);
  });
});
