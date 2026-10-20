import "server-only";
import { z } from "zod";
import { audit, type RequestMeta } from "@/lib/audit";
import { assertCan } from "@/lib/authz";
import { withTenant, type TenantContext } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertWithinLimit, recordUsage } from "./usage";
import { zodFieldErrors } from "./validation";

export const SHIPMENT_STATUSES = ["draft", "booked", "in_transit", "at_port", "customs_review", "cleared", "delivered", "cancelled"] as const;
export const TRANSPORT_MODES = ["ocean", "air", "road", "rail", "multimodal"] as const;
export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;

export const STATUS_LABELS: Record<(typeof SHIPMENT_STATUSES)[number], string> = {
  draft: "Draft",
  booked: "Booked",
  in_transit: "In transit",
  at_port: "At port",
  customs_review: "Customs review",
  cleared: "Cleared",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const country = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code (e.g. CN).");
const opt = (s: z.ZodString, max = 200) => s.trim().max(max).optional();
const date = z.iso.date("Use a valid date.").optional();

export const shipmentSchema = z
  .object({
    reference: z.string().trim().min(1, "Reference is required.").max(64),
    transportMode: z.enum(TRANSPORT_MODES, "Select a transport mode."),
    status: z.enum(SHIPMENT_STATUSES).default("draft"),
    supplierName: opt(z.string()),
    originCountry: country.optional(),
    destinationCountry: country.optional(),
    originLocation: opt(z.string()),
    destinationLocation: opt(z.string()),
    carrierName: opt(z.string()),
    containerNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}\d{7}$/, "Container numbers look like MSCU1234567.")
      .optional(),
    billOfLadingNumber: opt(z.string(), 64),
    incoterm: z.enum(INCOTERMS).optional(),
    estimatedDeparture: date,
    estimatedArrival: date,
    notes: opt(z.string(), 4000),
  })
  .refine((s) => !s.estimatedDeparture || !s.estimatedArrival || s.estimatedArrival >= s.estimatedDeparture, {
    path: ["estimatedArrival"],
    message: "Arrival must be on or after departure.",
  });

export type ShipmentInput = z.input<typeof shipmentSchema>;

export type Shipment = {
  id: string;
  reference: string;
  status: (typeof SHIPMENT_STATUSES)[number];
  transportMode: string;
  supplierName: string | null;
  originCountry: string | null;
  destinationCountry: string | null;
  originLocation: string | null;
  destinationLocation: string | null;
  carrierName: string | null;
  containerNumber: string | null;
  billOfLadingNumber: string | null;
  incoterm: string | null;
  estimatedDeparture: string | null;
  estimatedArrival: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  documentCount?: number;
};

const COLUMNS = `s.id, s.reference, s.status, s.transport_mode, s.supplier_name, s.origin_country, s.destination_country,
  s.origin_location, s.destination_location, s.carrier_name, s.container_number, s.bill_of_lading_number, s.incoterm,
  to_char(s.estimated_departure, 'YYYY-MM-DD') AS estimated_departure, to_char(s.estimated_arrival, 'YYYY-MM-DD') AS estimated_arrival,
  s.notes, s.created_at, s.updated_at`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapShipment(r: any): Shipment {
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    transportMode: r.transport_mode,
    supplierName: r.supplier_name,
    originCountry: r.origin_country,
    destinationCountry: r.destination_country,
    originLocation: r.origin_location,
    destinationLocation: r.destination_location,
    carrierName: r.carrier_name,
    containerNumber: r.container_number,
    billOfLadingNumber: r.bill_of_lading_number,
    incoterm: r.incoterm,
    estimatedDeparture: r.estimated_departure,
    estimatedArrival: r.estimated_arrival,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    documentCount: r.document_count === undefined ? undefined : Number(r.document_count),
  };
}

function parse(input: unknown) {
  const parsed = shipmentSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  return parsed.data;
}

function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export async function listShipments(
  ctx: TenantContext,
  opts: { q?: string; status?: string; page?: number; pageSize?: number } = {},
) {
  assertCan(ctx.role, "shipments:read");
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const status = SHIPMENT_STATUSES.find((s) => s === opts.status);
  const q = opts.q?.trim().slice(0, 100) || null;
  return withTenant(ctx, async (tx) => {
    const where = `WHERE ($1::text IS NULL OR s.status = $1)
      AND ($2::text IS NULL OR s.reference ILIKE '%' || $2 || '%' OR s.supplier_name ILIKE '%' || $2 || '%'
           OR s.container_number ILIKE '%' || $2 || '%' OR s.bill_of_lading_number ILIKE '%' || $2 || '%')`;
    const { rows } = await tx.query(
      `SELECT ${COLUMNS}, (SELECT count(*) FROM shipment_documents d WHERE d.shipment_id = s.id) AS document_count
         FROM shipments s ${where}
        ORDER BY s.created_at DESC LIMIT $3 OFFSET $4`,
      [status ?? null, q, pageSize, (page - 1) * pageSize],
    );
    const total = await tx.query(`SELECT count(*)::int AS n FROM shipments s ${where}`, [status ?? null, q]);
    return { items: rows.map(mapShipment), total: total.rows[0].n as number, page, pageSize };
  });
}

export async function getShipment(ctx: TenantContext, id: string) {
  assertCan(ctx.role, "shipments:read");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Shipment not found.");
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(`SELECT ${COLUMNS} FROM shipments s WHERE s.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError("Shipment not found.");
    return mapShipment(rows[0]);
  });
}

export async function createShipment(ctx: TenantContext, input: unknown, meta: RequestMeta = {}) {
  assertCan(ctx.role, "shipments:write");
  const s = parse(input);
  try {
    return await withTenant(ctx, async (tx) => {
      await assertWithinLimit(tx, ctx, "shipment_created");
      const { rows } = await tx.query(
        `INSERT INTO shipments (org_id, reference, status, transport_mode, supplier_name, origin_country, destination_country,
           origin_location, destination_location, carrier_name, container_number, bill_of_lading_number, incoterm,
           estimated_departure, estimated_arrival, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [
          ctx.orgId, s.reference, s.status, s.transportMode, s.supplierName ?? null, s.originCountry ?? null,
          s.destinationCountry ?? null, s.originLocation ?? null, s.destinationLocation ?? null, s.carrierName ?? null,
          s.containerNumber ?? null, s.billOfLadingNumber ?? null, s.incoterm ?? null, s.estimatedDeparture ?? null,
          s.estimatedArrival ?? null, s.notes ?? null, ctx.userId,
        ],
      );
      const id = rows[0].id as string;
      await tx.query(
        `INSERT INTO shipment_events (org_id, shipment_id, event_type, description, source, created_by)
         VALUES ($1, $2, 'created', 'Shipment record created', 'system', $3)`,
        [ctx.orgId, id, ctx.userId],
      );
      await recordUsage(tx, ctx, "shipment_created", 1, id);
      await audit(tx, ctx, "shipment.created", { type: "shipment", id }, { reference: s.reference }, meta);
      return id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError(`A shipment with reference “${s.reference}” already exists.`);
    throw err;
  }
}

export async function updateShipment(ctx: TenantContext, id: string, input: unknown, meta: RequestMeta = {}) {
  assertCan(ctx.role, "shipments:write");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Shipment not found.");
  const s = parse(input);
  try {
    await withTenant(ctx, async (tx) => {
      const before = await tx.query(`SELECT status FROM shipments WHERE id = $1 FOR UPDATE`, [id]);
      if (!before.rows[0]) throw new NotFoundError("Shipment not found.");
      await tx.query(
        `UPDATE shipments SET reference=$2, status=$3, transport_mode=$4, supplier_name=$5, origin_country=$6,
           destination_country=$7, origin_location=$8, destination_location=$9, carrier_name=$10, container_number=$11,
           bill_of_lading_number=$12, incoterm=$13, estimated_departure=$14, estimated_arrival=$15, notes=$16
         WHERE id = $1`,
        [
          id, s.reference, s.status, s.transportMode, s.supplierName ?? null, s.originCountry ?? null,
          s.destinationCountry ?? null, s.originLocation ?? null, s.destinationLocation ?? null, s.carrierName ?? null,
          s.containerNumber ?? null, s.billOfLadingNumber ?? null, s.incoterm ?? null, s.estimatedDeparture ?? null,
          s.estimatedArrival ?? null, s.notes ?? null,
        ],
      );
      const prev = before.rows[0].status as string;
      if (prev !== s.status) {
        await tx.query(
          `INSERT INTO shipment_events (org_id, shipment_id, event_type, description, source, created_by)
           VALUES ($1, $2, 'status_changed', $3, 'manual', $4)`,
          [ctx.orgId, id, `Status changed from ${STATUS_LABELS[prev as keyof typeof STATUS_LABELS]} to ${STATUS_LABELS[s.status]}`, ctx.userId],
        );
        await audit(tx, ctx, "shipment.status_changed", { type: "shipment", id }, { from: prev, to: s.status }, meta);
      }
      await audit(tx, ctx, "shipment.updated", { type: "shipment", id }, { reference: s.reference }, meta);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError(`A shipment with reference “${s.reference}” already exists.`);
    throw err;
  }
}

export const eventSchema = z.object({
  eventType: z.string().trim().min(1).max(48).default("note"),
  description: z.string().trim().min(1, "Describe the event.").max(1000),
  location: z.string().trim().max(200).optional(),
  occurredAt: z.iso.datetime({ local: true, message: "Use a valid date and time." }).optional(),
});

export async function addShipmentEvent(ctx: TenantContext, shipmentId: string, input: unknown, meta: RequestMeta = {}) {
  assertCan(ctx.role, "shipments:write");
  if (!z.uuid().safeParse(shipmentId).success) throw new NotFoundError("Shipment not found.");
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  const e = parsed.data;
  await withTenant(ctx, async (tx) => {
    const exists = await tx.query("SELECT 1 FROM shipments WHERE id = $1", [shipmentId]);
    if (!exists.rowCount) throw new NotFoundError("Shipment not found.");
    const { rows } = await tx.query(
      `INSERT INTO shipment_events (org_id, shipment_id, event_type, description, location, occurred_at, source, created_by)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamp AT TIME ZONE 'UTC', now()), 'manual', $7) RETURNING id`,
      [ctx.orgId, shipmentId, e.eventType, e.description, e.location ?? null, e.occurredAt ?? null, ctx.userId],
    );
    await audit(tx, ctx, "shipment.event_added", { type: "shipment", id: shipmentId }, { eventId: rows[0].id }, meta);
  });
}

export async function listShipmentEvents(ctx: TenantContext, shipmentId: string) {
  assertCan(ctx.role, "shipments:read");
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      `SELECT e.id, e.event_type, e.description, e.location, e.occurred_at, e.source, e.is_actual, u.display_name, u.email
         FROM shipment_events e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.shipment_id = $1 ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 200`,
      [shipmentId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      eventType: r.event_type as string,
      description: r.description as string,
      location: r.location as string | null,
      occurredAt: r.occurred_at as Date,
      source: r.source as string,
      isActual: r.is_actual as boolean | null,
      actor: (r.display_name ?? r.email ?? null) as string | null,
    }));
  });
}
