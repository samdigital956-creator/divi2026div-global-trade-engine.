import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type RequestMeta } from "@/lib/audit";
import { assertCan } from "@/lib/authz";
import { withTenant, type TenantContext, type Tx } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { runExtraction } from "@/lib/extraction/registry";
import type { FieldDefinition } from "@/lib/extraction/types";
import { storage, storageKeyFor } from "@/lib/storage";
import { validateUpload } from "@/lib/uploads";
import { assertWithinLimit, recordUsage } from "./usage";
import { zodFieldErrors } from "./validation";

export const DOCUMENT_STATUS_LABELS = {
  uploaded: "Uploaded",
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
} as const;

export const EXTRACTION_STATUS_LABELS = {
  pending: "Pending",
  not_configured: "AI not configured",
  processing: "Processing",
  completed: "Extracted — confirm values",
  failed: "Extraction failed",
  manual: "Manual entry",
} as const;

/** AI/OCR values below this confidence are flagged in the UI; all machine values need confirmation. */
export const LOW_CONFIDENCE = 0.85;

export type DocumentType = { id: string; key: string; name: string; isCustom: boolean; fields: FieldDefinition[] };

export type DocumentSummary = {
  id: string;
  shipmentId: string;
  shipmentReference: string;
  typeName: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: keyof typeof DOCUMENT_STATUS_LABELS;
  extractionStatus: keyof typeof EXTRACTION_STATUS_LABELS;
  createdAt: Date;
  uploadedBy: string | null;
};

export type ExtractedField = {
  key: string;
  value: string | null;
  source: "manual" | "ai" | "ocr";
  provider: string | null;
  confidence: number | null;
  requiresConfirmation: boolean;
  confirmedBy: string | null;
  confirmedAt: Date | null;
};

const uuid = z.uuid();
const assertUuid = (id: string, what: string) => {
  if (!uuid.safeParse(id).success) throw new NotFoundError(`${what} not found.`);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapType = (r: any): DocumentType => ({
  id: r.id,
  key: r.key,
  name: r.name,
  isCustom: r.org_id !== null,
  fields: r.field_schema,
});

export async function listDocumentTypes(ctx: TenantContext): Promise<DocumentType[]> {
  assertCan(ctx.role, "documents:read");
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, org_id, key, name, field_schema FROM document_types
        WHERE is_active ORDER BY org_id NULLS FIRST, CASE key WHEN 'other' THEN 1 ELSE 0 END, name`,
    );
    return rows.map(mapType);
  });
}

const fieldDefSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/),
  label: z.string().trim().min(1).max(80),
  type: z.enum(["text", "textarea", "number", "date"]),
  required: z.boolean(),
});

export const documentTypeSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(80),
  // One field per line: "Label" or "Label | type | required"
  fields: z.string().trim().min(1, "Add at least one field.").max(4000),
});

export function parseFieldLines(text: string): FieldDefinition[] {
  const seen = new Set<string>();
  const out: FieldDefinition[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const [label, rawType, rawReq] = line.split("|").map((p) => p.trim());
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 48);
    const type = (["text", "textarea", "number", "date"].includes(rawType ?? "") ? rawType : "text") as FieldDefinition["type"];
    const def = { key, label: label.slice(0, 80), type, required: /^(required|yes|true)$/i.test(rawReq ?? "") };
    if (!fieldDefSchema.safeParse(def).success || seen.has(key)) {
      throw new ValidationError("Invalid field list.", { fields: `Check the line “${line.slice(0, 40)}”.` });
    }
    seen.add(key);
    out.push(def);
  }
  if (out.length > 40) throw new ValidationError("Too many fields.", { fields: "Use at most 40 fields." });
  return out;
}

export async function createDocumentType(ctx: TenantContext, input: unknown, meta: RequestMeta = {}) {
  assertCan(ctx.role, "document_types:manage");
  const parsed = documentTypeSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  const fields = parseFieldLines(parsed.data.fields);
  const key = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "custom";
  return withTenant(ctx, async (tx) => {
    const clash = await tx.query(`SELECT 1 FROM document_types WHERE key = $1 AND (org_id IS NULL OR org_id = $2)`, [key, ctx.orgId]);
    if (clash.rowCount) throw new ConflictError("A document type with this name already exists.");
    const { rows } = await tx.query(
      `INSERT INTO document_types (org_id, key, name, field_schema) VALUES ($1, $2, $3, $4) RETURNING id`,
      [ctx.orgId, key, parsed.data.name, JSON.stringify(fields)],
    );
    await audit(tx, ctx, "document_type.created", { type: "document_type", id: rows[0].id }, { name: parsed.data.name, fields: fields.length }, meta);
    return rows[0].id as string;
  });
}

const SUMMARY_SQL = `SELECT d.id, d.shipment_id, s.reference, t.name AS type_name, d.original_filename, d.mime_type, d.size_bytes,
    d.status, d.extraction_status, d.created_at, COALESCE(u.display_name, u.email) AS uploaded_by
  FROM shipment_documents d
  JOIN shipments s ON s.id = d.shipment_id
  JOIN document_types t ON t.id = d.document_type_id
  LEFT JOIN users u ON u.id = d.uploaded_by`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapSummary = (r: any): DocumentSummary => ({
  id: r.id,
  shipmentId: r.shipment_id,
  shipmentReference: r.reference,
  typeName: r.type_name,
  originalFilename: r.original_filename,
  mimeType: r.mime_type,
  sizeBytes: Number(r.size_bytes),
  status: r.status,
  extractionStatus: r.extraction_status,
  createdAt: r.created_at,
  uploadedBy: r.uploaded_by,
});

export async function listDocuments(ctx: TenantContext, opts: { shipmentId?: string; status?: string; limit?: number } = {}) {
  assertCan(ctx.role, "documents:read");
  if (opts.shipmentId) assertUuid(opts.shipmentId, "Shipment");
  const status = Object.keys(DOCUMENT_STATUS_LABELS).find((s) => s === opts.status) ?? null;
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      `${SUMMARY_SQL}
        WHERE ($1::uuid IS NULL OR d.shipment_id = $1) AND ($2::text IS NULL OR d.status = $2)
        ORDER BY d.created_at DESC LIMIT $3`,
      [opts.shipmentId ?? null, status, Math.min(opts.limit ?? 100, 200)],
    );
    return rows.map(mapSummary);
  });
}

export type UploadInput = { shipmentId: string; documentTypeId: string; filename: string; bytes: Uint8Array };

export async function uploadDocument(ctx: TenantContext, input: UploadInput, meta: RequestMeta = {}) {
  assertCan(ctx.role, "documents:upload");
  if (!uuid.safeParse(input.shipmentId).success) throw new ValidationError("Choose a shipment.", { shipmentId: "Choose a shipment." });
  if (!uuid.safeParse(input.documentTypeId).success) throw new ValidationError("Choose a document type.", { documentTypeId: "Choose a document type." });

  let file;
  try {
    file = validateUpload(input.filename, input.bytes);
  } catch (err) {
    // Rejected uploads are security-relevant; record them (without content).
    await withTenant(ctx, (tx) =>
      audit(tx, ctx, "upload.rejected", { type: "shipment", id: input.shipmentId }, {
        filename: input.filename.slice(0, 200),
        size: input.bytes.byteLength,
        reason: err instanceof AppError ? err.message : "invalid",
      }, meta),
    ).catch(() => {});
    throw err;
  }

  const store = storage();
  if (!store) throw new AppError("Document storage is not configured. Contact your administrator.", 503, "storage_not_configured");

  const documentId = randomUUID();
  const storageKey = storageKeyFor(ctx.orgId, input.shipmentId, documentId);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");

  const docType = await withTenant(ctx, async (tx) => {
    const sh = await tx.query("SELECT reference FROM shipments WHERE id = $1", [input.shipmentId]);
    if (!sh.rowCount) throw new NotFoundError("Shipment not found.");
    const t = await tx.query(`SELECT id, org_id, key, name, field_schema FROM document_types WHERE id = $1 AND is_active`, [input.documentTypeId]);
    if (!t.rowCount) throw new ValidationError("Choose a valid document type.", { documentTypeId: "Choose a valid document type." });
    await assertWithinLimit(tx, ctx, "document_uploaded");
    await assertWithinLimit(tx, ctx, "storage_bytes", input.bytes.byteLength);
    return { ...mapType(t.rows[0]), shipmentReference: sh.rows[0].reference as string };
  });

  await store.put(storageKey, input.bytes, file.mime);
  try {
    await withTenant(ctx, async (tx) => {
      await tx.query(
        `INSERT INTO shipment_documents (id, org_id, shipment_id, document_type_id, original_filename, storage_key, mime_type,
            size_bytes, sha256, status, extraction_status, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'uploaded','pending',$10)`,
        [documentId, ctx.orgId, input.shipmentId, input.documentTypeId, file.filename, storageKey, file.mime, input.bytes.byteLength, sha256, ctx.userId],
      );
      await tx.query(
        `INSERT INTO shipment_events (org_id, shipment_id, event_type, description, source, created_by)
         VALUES ($1, $2, 'document_uploaded', $3, 'system', $4)`,
        [ctx.orgId, input.shipmentId, `${docType.name} uploaded (${file.filename})`, ctx.userId],
      );
      await tx.query(
        `INSERT INTO tasks (org_id, shipment_id, document_id, title, priority, created_by)
         VALUES ($1, $2, $3, $4, 'normal', $5)`,
        [ctx.orgId, input.shipmentId, documentId, `Review ${docType.name.toLowerCase()} for ${docType.shipmentReference}`, ctx.userId],
      );
      await recordUsage(tx, ctx, "document_uploaded", 1, documentId);
      await recordUsage(tx, ctx, "storage_bytes", input.bytes.byteLength, documentId);
      await audit(tx, ctx, "document.uploaded", { type: "document", id: documentId }, {
        shipmentId: input.shipmentId,
        documentType: docType.key,
        filename: file.filename,
        size: input.bytes.byteLength,
        sha256,
      }, meta);
    });
  } catch (err) {
    await store.delete(storageKey).catch(() => {});
    throw err;
  }

  await extract(ctx, documentId, docType.key, docType.fields, file.mime, input.bytes, meta);
  return documentId;
}

async function extract(
  ctx: TenantContext,
  documentId: string,
  typeKey: string,
  fields: FieldDefinition[],
  mimeType: string,
  bytes: Uint8Array,
  meta: RequestMeta,
) {
  const outcome = await runExtraction({ documentId, documentTypeKey: typeKey, mimeType, bytes, fields });
  await withTenant(ctx, async (tx) => {
    if (outcome.status === "completed") {
      for (const c of outcome.candidates) {
        await tx.query(
          `INSERT INTO extracted_fields (org_id, document_id, field_key, value, source, provider, confidence, requires_confirmation)
           VALUES ($1, $2, $3, $4, 'ai', $5, $6, true)
           ON CONFLICT (document_id, field_key) DO UPDATE
             SET value = EXCLUDED.value, source = 'ai', provider = EXCLUDED.provider, confidence = EXCLUDED.confidence,
                 requires_confirmation = true, confirmed_by = NULL, confirmed_at = NULL
           WHERE extracted_fields.source <> 'manual'`,
          [ctx.orgId, documentId, c.key, c.value.slice(0, 4000), outcome.provider, Math.min(Math.max(c.confidence, 0), 1)],
        );
      }
      await tx.query(
        `UPDATE shipment_documents SET status = 'needs_review', extraction_status = 'completed', extraction_provider = $2, extraction_error = NULL WHERE id = $1`,
        [documentId, outcome.provider],
      );
    } else {
      await tx.query(
        `UPDATE shipment_documents SET status = 'needs_review', extraction_status = $2, extraction_provider = $3, extraction_error = $4 WHERE id = $1`,
        [documentId, outcome.status, outcome.status === "failed" ? outcome.provider : null, outcome.message],
      );
    }
    await audit(tx, ctx, "document.extraction_attempted", { type: "document", id: documentId }, {
      outcome: outcome.status,
      provider: outcome.status === "not_configured" ? null : outcome.provider,
      fields: outcome.status === "completed" ? outcome.candidates.length : 0,
    }, meta);
  });
}

export type DocumentDetail = DocumentSummary & {
  documentTypeId: string;
  typeKey: string;
  fields: FieldDefinition[];
  values: Record<string, ExtractedField>;
  sha256: string;
  extractionProvider: string | null;
  extractionError: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
};

async function loadDetail(tx: Tx, id: string): Promise<DocumentDetail> {
  const { rows } = await tx.query(
    `SELECT d.*, s.reference, t.name AS type_name, t.key AS type_key, t.field_schema,
            COALESCE(u.display_name, u.email) AS uploaded_by_name, COALESCE(r.display_name, r.email) AS reviewed_by_name
       FROM shipment_documents d
       JOIN shipments s ON s.id = d.shipment_id
       JOIN document_types t ON t.id = d.document_type_id
       LEFT JOIN users u ON u.id = d.uploaded_by
       LEFT JOIN users r ON r.id = d.reviewed_by
      WHERE d.id = $1`,
    [id],
  );
  const d = rows[0];
  if (!d) throw new NotFoundError("Document not found.");
  const f = await tx.query(
    `SELECT f.*, COALESCE(u.display_name, u.email) AS confirmed_by_name
       FROM extracted_fields f LEFT JOIN users u ON u.id = f.confirmed_by WHERE f.document_id = $1`,
    [id],
  );
  const values: Record<string, ExtractedField> = {};
  for (const r of f.rows) {
    values[r.field_key] = {
      key: r.field_key,
      value: r.value,
      source: r.source,
      provider: r.provider,
      confidence: r.confidence === null ? null : Number(r.confidence),
      requiresConfirmation: r.requires_confirmation,
      confirmedBy: r.confirmed_by_name,
      confirmedAt: r.confirmed_at,
    };
  }
  return {
    ...mapSummary({ ...d, uploaded_by: d.uploaded_by_name }),
    documentTypeId: d.document_type_id,
    typeKey: d.type_key,
    fields: d.field_schema,
    values,
    sha256: d.sha256,
    extractionProvider: d.extraction_provider,
    extractionError: d.extraction_error,
    reviewNote: d.review_note,
    reviewedBy: d.reviewed_by_name,
    reviewedAt: d.reviewed_at,
  };
}

export async function getDocument(ctx: TenantContext, id: string) {
  assertCan(ctx.role, "documents:read");
  assertUuid(id, "Document");
  return withTenant(ctx, (tx) => loadDetail(tx, id));
}

function normaliseValue(def: FieldDefinition, raw: string | undefined): { value: string | null; error?: string } {
  const v = (raw ?? "").trim();
  if (v === "") return { value: null };
  if (v.length > 4000) return { value: null, error: "Too long." };
  if (def.type === "number") {
    const n = v.replace(/[,\s]/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(n)) return { value: null, error: "Enter a number." };
    return { value: n };
  }
  if (def.type === "date") {
    if (!z.iso.date().safeParse(v).success) return { value: null, error: "Use YYYY-MM-DD." };
  }
  return { value: v };
}

export async function saveDocumentFields(ctx: TenantContext, id: string, input: Record<string, string | undefined>, meta: RequestMeta = {}) {
  assertCan(ctx.role, "documents:edit_fields");
  assertUuid(id, "Document");
  await withTenant(ctx, async (tx) => {
    const doc = await loadDetail(tx, id);
    if (doc.status === "approved") throw new ConflictError("Approved documents are locked. Reopen the document to edit values.");
    const errors: Record<string, string> = {};
    const changed: string[] = [];
    for (const def of doc.fields) {
      if (!(def.key in input)) continue;
      const { value, error } = normaliseValue(def, input[def.key]);
      if (error) {
        errors[def.key] = error;
        continue;
      }
      const existing = doc.values[def.key];
      if ((existing?.value ?? null) === value) continue;
      changed.push(def.key);
      // A value typed by a person is confirmed by that person.
      await tx.query(
        `INSERT INTO extracted_fields (org_id, document_id, field_key, value, source, requires_confirmation, confirmed_by, confirmed_at, updated_by)
         VALUES ($1, $2, $3, $4, 'manual', false, $5, now(), $5)
         ON CONFLICT (document_id, field_key) DO UPDATE
           SET value = EXCLUDED.value, source = 'manual', provider = NULL, confidence = NULL,
               requires_confirmation = false, confirmed_by = $5, confirmed_at = now(), updated_by = $5`,
        [ctx.orgId, id, def.key, value, ctx.userId],
      );
    }
    if (Object.keys(errors).length) throw new ValidationError("Some values are invalid.", errors);
    if (changed.length) {
      await tx.query(
        `UPDATE shipment_documents SET status = 'needs_review',
           extraction_status = CASE WHEN extraction_status = 'not_configured' THEN 'manual' ELSE extraction_status END
         WHERE id = $1`,
        [id],
      );
      await audit(tx, ctx, "document.fields_updated", { type: "document", id }, { fields: changed }, meta);
    }
  });
}

export async function confirmField(ctx: TenantContext, id: string, fieldKey: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "documents:edit_fields");
  assertUuid(id, "Document");
  await withTenant(ctx, async (tx) => {
    const doc = await loadDetail(tx, id);
    if (doc.status === "approved") throw new ConflictError("Approved documents are locked.");
    const r = await tx.query(
      `UPDATE extracted_fields SET requires_confirmation = false, confirmed_by = $3, confirmed_at = now()
        WHERE document_id = $1 AND field_key = $2 RETURNING value`,
      [id, fieldKey, ctx.userId],
    );
    if (!r.rowCount) throw new NotFoundError("Field not found.");
    await audit(tx, ctx, "document.field_confirmed", { type: "document", id }, { field: fieldKey }, meta);
  });
}

export function approvalBlockers(doc: DocumentDetail): string[] {
  const blockers: string[] = [];
  for (const def of doc.fields) {
    const v = doc.values[def.key];
    if (def.required && !v?.value) blockers.push(`${def.label} is required.`);
    if (v?.value && v.requiresConfirmation) blockers.push(`${def.label} needs confirmation.`);
  }
  return blockers;
}

export async function approveDocument(ctx: TenantContext, id: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "documents:approve");
  assertUuid(id, "Document");
  await withTenant(ctx, async (tx) => {
    await tx.query("SELECT 1 FROM shipment_documents WHERE id = $1 FOR UPDATE", [id]);
    const doc = await loadDetail(tx, id);
    if (doc.status === "approved") throw new ConflictError("This document is already approved.");
    const blockers = approvalBlockers(doc);
    if (blockers.length) throw new ValidationError(`Cannot approve yet: ${blockers.join(" ")}`);
    await tx.query(
      `UPDATE shipment_documents SET status = 'approved', reviewed_by = $2, reviewed_at = now(), review_note = NULL WHERE id = $1`,
      [id, ctx.userId],
    );
    await tx.query(`UPDATE tasks SET status = 'done', completed_at = now() WHERE document_id = $1 AND status = 'open'`, [id]);
    await tx.query(
      `INSERT INTO shipment_events (org_id, shipment_id, event_type, description, source, created_by)
       VALUES ($1, $2, 'document_approved', $3, 'system', $4)`,
      [ctx.orgId, doc.shipmentId, `${doc.typeName} approved`, ctx.userId],
    );
    await audit(tx, ctx, "document.approved", { type: "document", id }, {
      fields: Object.fromEntries(doc.fields.map((f) => [f.key, doc.values[f.key]?.value ?? null])),
    }, meta);
  });
}

export async function rejectDocument(ctx: TenantContext, id: string, note: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "documents:approve");
  assertUuid(id, "Document");
  const reason = note.trim();
  if (reason.length < 3) throw new ValidationError("Give a reason for rejecting.", { note: "Give a reason for rejecting." });
  await withTenant(ctx, async (tx) => {
    const doc = await loadDetail(tx, id);
    if (doc.status === "approved") throw new ConflictError("Reopen the document before rejecting it.");
    await tx.query(
      `UPDATE shipment_documents SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3 WHERE id = $1`,
      [id, ctx.userId, reason.slice(0, 1000)],
    );
    await tx.query(
      `INSERT INTO alerts (org_id, shipment_id, document_id, severity, kind, message)
       VALUES ($1, $2, $3, 'warning', 'document_rejected', $4)`,
      [ctx.orgId, doc.shipmentId, id, `${doc.typeName} for ${doc.shipmentReference} was rejected: ${reason.slice(0, 200)}`],
    );
    await audit(tx, ctx, "document.rejected", { type: "document", id }, { note: reason.slice(0, 1000) }, meta);
  });
}

export async function reopenDocument(ctx: TenantContext, id: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "documents:approve");
  assertUuid(id, "Document");
  await withTenant(ctx, async (tx) => {
    const r = await tx.query(
      `UPDATE shipment_documents SET status = 'needs_review' WHERE id = $1 AND status IN ('approved','rejected') RETURNING shipment_id`,
      [id],
    );
    if (!r.rowCount) throw new ConflictError("Only approved or rejected documents can be reopened.");
    await tx.query(`UPDATE alerts SET resolved_at = now(), resolved_by = $2 WHERE document_id = $1 AND resolved_at IS NULL`, [id, ctx.userId]);
    await audit(tx, ctx, "document.reopened", { type: "document", id }, {}, meta);
  });
}

/**
 * Authorise access and issue a short-lived signed URL. Every call is audited,
 * so the audit log shows who viewed or downloaded which document and when.
 */
export async function documentAccessUrl(ctx: TenantContext, id: string, mode: "view" | "download", meta: RequestMeta = {}) {
  assertCan(ctx.role, "documents:read");
  assertUuid(id, "Document");
  const store = storage();
  if (!store) throw new AppError("Document storage is not configured.", 503, "storage_not_configured");
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(`SELECT storage_key, original_filename, mime_type FROM shipment_documents WHERE id = $1`, [id]);
    const d = rows[0];
    if (!d) throw new NotFoundError("Document not found.");
    await audit(tx, ctx, mode === "view" ? "document.viewed" : "document.downloaded", { type: "document", id }, {}, meta);
    return store.signedDownloadUrl(d.storage_key, {
      filename: d.original_filename,
      contentType: d.mime_type,
      inline: mode === "view",
      expiresInSeconds: 60,
    });
  });
}
