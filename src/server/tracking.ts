import "server-only";
import { z } from "zod";
import { audit, type RequestMeta } from "@/lib/audit";
import { assertCan } from "@/lib/authz";
import { systemTx, withTenant, type TenantContext, type Tx } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { trackingProvider, trackingProviders } from "@/lib/tracking/registry";
import type { ReferenceType, TrackingSnapshot, TrackOutcome } from "@/lib/tracking/types";
import { assertWithinLimit, recordUsage } from "./usage";

/** Context for background jobs (webhooks, scheduled sync): tenant-bound, no human actor. */
type SyncContext = { orgId: string; userId: string };

export type Tracking = {
  id: string;
  shipmentId: string;
  provider: string;
  reference: string;
  referenceType: ReferenceType;
  sealine: string | null;
  sealineName: string | null;
  state: "pending" | "active" | "not_found" | "failed" | "delivered" | "stopped";
  carrierStatus: string | null;
  eta: Date | null;
  ata: Date | null;
  deliveredAt: Date | null;
  isDelayed: boolean;
  position: { lat: number; lng: number } | null;
  route: [number, number][];
  vessel: { name: string | null; imo: string | null; mmsi: string | null } | null;
  origin: string | null;
  destination: string | null;
  lastSyncedAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
};

const CONTAINER_RE = /^[A-Z]{4}\d{7}$/;
const BL_RE = /^[A-Z0-9./-]{3,50}$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any): Tracking {
  return {
    id: r.id,
    shipmentId: r.shipment_id,
    provider: r.provider,
    reference: r.reference,
    referenceType: r.reference_type,
    sealine: r.sealine,
    sealineName: r.sealine_name,
    state: r.state,
    carrierStatus: r.carrier_status,
    eta: r.eta,
    ata: r.ata,
    deliveredAt: r.delivered_at,
    isDelayed: r.is_delayed,
    position: r.latitude !== null && r.longitude !== null ? { lat: r.latitude, lng: r.longitude } : null,
    route: Array.isArray(r.route) ? r.route : [],
    vessel: r.vessel_name || r.vessel_imo ? { name: r.vessel_name, imo: r.vessel_imo, mmsi: r.vessel_mmsi } : null,
    origin: r.origin,
    destination: r.destination,
    lastSyncedAt: r.last_synced_at,
    lastCheckedAt: r.last_checked_at,
    lastError: r.last_error,
  };
}

export async function listTrackings(ctx: TenantContext, shipmentId: string): Promise<Tracking[]> {
  assertCan(ctx.role, "shipments:read");
  if (!z.uuid().safeParse(shipmentId).success) return [];
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(`SELECT * FROM container_trackings WHERE shipment_id = $1 ORDER BY created_at`, [shipmentId]);
    return rows.map(mapRow);
  });
}

export const startTrackingSchema = z.object({
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .transform((s) => s.replace(/\s+/g, ""))
    .pipe(z.string().min(3, "Enter a container or B/L number.").max(50)),
  referenceType: z.enum(["container", "bl"]).default("container"),
  sealine: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}$/, "Use the carrier's 4-letter SCAC code, e.g. MSCU.")
    .optional(),
});

/** Allow provider demo data only outside production (or when explicitly allowed for a test deployment). */
function rejectSynthetic(s: TrackingSnapshot) {
  return s.synthetic && process.env.NODE_ENV === "production" && process.env.TRACKING_ALLOW_SANDBOX !== "true";
}

export async function startTracking(ctx: TenantContext, shipmentId: string, input: unknown, meta: RequestMeta = {}) {
  assertCan(ctx.role, "shipments:write");
  if (!z.uuid().safeParse(shipmentId).success) throw new NotFoundError("Shipment not found.");
  const parsed = startTrackingSchema.safeParse(input);
  if (!parsed.success) {
    const f = parsed.error.issues[0];
    throw new ValidationError(f.message, { [String(f.path[0] ?? "reference")]: f.message });
  }
  const { reference, referenceType, sealine } = parsed.data;
  if (referenceType === "container" && !CONTAINER_RE.test(reference)) {
    throw new ValidationError("Container numbers look like MSCU1234567.", { reference: "Container numbers look like MSCU1234567." });
  }
  if (referenceType === "bl" && !BL_RE.test(reference)) {
    throw new ValidationError("Enter the B/L number as printed by the carrier.", { reference: "Enter the B/L number as printed by the carrier." });
  }
  const providers = trackingProviders();
  if (providers.length === 0) throw new AppError("Live tracking is not configured.", 503, "tracking_not_configured");

  await withTenant(ctx, async (tx) => {
    const s = await tx.query(`SELECT 1 FROM shipments WHERE id = $1`, [shipmentId]);
    if (!s.rowCount) throw new NotFoundError("Shipment not found.");
    const dup = await tx.query(`SELECT 1 FROM container_trackings WHERE shipment_id = $1 AND reference = $2 AND state <> 'stopped'`, [shipmentId, reference]);
    if (dup.rowCount) throw new ConflictError("This reference is already being tracked on this shipment.");
    await assertWithinLimit(tx, ctx, "tracking_started");
  });
  await consumeRateLimit(RATE_LIMITS.trackingStart, ctx.orgId);

  // Try providers in priority order; the first that recognises the reference wins.
  let outcome: TrackOutcome = { status: "error", message: "No tracking provider could be reached.", retryable: true };
  let providerId = providers[0].id;
  let resolvedSealine = sealine ?? null;
  for (const p of providers) {
    providerId = p.id;
    resolvedSealine = sealine ?? (await p.lookupCarrier(reference, referenceType).catch(() => null))?.scac ?? null;
    outcome = await p.track(reference, referenceType, resolvedSealine);
    if (outcome.status === "ok" && rejectSynthetic(outcome.snapshot)) {
      outcome = { status: "error", message: "The provider returned demo data; live tracking is not available with this key.", retryable: false };
    }
    if (outcome.status === "ok" || outcome.status === "limit_reached") break;
  }

  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO container_trackings (org_id, shipment_id, provider, reference, reference_type, sealine, state, last_error, last_checked_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)
       ON CONFLICT (org_id, shipment_id, reference) DO UPDATE
         SET provider = EXCLUDED.provider, reference_type = EXCLUDED.reference_type, sealine = EXCLUDED.sealine,
             state = EXCLUDED.state, last_error = EXCLUDED.last_error, last_checked_at = now()
       RETURNING *`,
      [
        ctx.orgId, shipmentId, providerId, reference, referenceType, resolvedSealine,
        outcome.status === "ok" ? "active" : outcome.status === "not_found" ? "not_found" : "failed",
        outcome.status === "ok" ? null : outcome.message,
        ctx.userId,
      ],
    );
    const row = rows[0];
    if (outcome.status === "ok") {
      await applySnapshot(tx, ctx, row, outcome.snapshot, meta);
      await recordUsage(tx, ctx, "tracking_started", 1, row.id);
      await audit(tx, ctx, "tracking.started", { type: "shipment", id: shipmentId }, { reference, provider: providerId, carrier: outcome.snapshot.sealine }, meta);
    } else {
      await audit(tx, ctx, "tracking.failed", { type: "shipment", id: shipmentId }, { reference, provider: providerId, outcome: outcome.status }, meta);
    }
    return { trackingId: row.id as string, outcome: outcome.status, message: outcome.status === "ok" ? null : outcome.message };
  });
}

const STATUS_RANK = ["draft", "booked", "in_transit", "at_port", "customs_review", "cleared", "delivered"] as const;
type ShipmentStatus = (typeof STATUS_RANK)[number] | "cancelled";

/** The status the provider data proves, if any. Never moves a shipment backwards or into customs states. */
export function provenStatus(s: TrackingSnapshot): ShipmentStatus | null {
  if (s.deliveredAt) return "delivered";
  if (s.ata) return "at_port";
  const st = (s.carrierStatus || "").toUpperCase();
  if (st === "IN_TRANSIT" || s.events.some((e) => e.isActual && /load|depart|sail/i.test(e.description))) return "in_transit";
  return null;
}

const dayDiff = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);
const fmtDay = (d: Date) => d.toISOString().slice(0, 10);

/** Persist a provider snapshot: tracking row, timeline events, ETA changes, delay alerts, status. */
async function applySnapshot(
  tx: Tx,
  ctx: { orgId: string; userId: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
  s: TrackingSnapshot,
  meta: RequestMeta = {},
) {
  const prevEta: Date | null = row.eta;
  const newEta = s.eta ? new Date(s.eta) : null;
  const state = s.deliveredAt ? "delivered" : "active";
  await tx.query(
    `UPDATE container_trackings SET
       state = $2, provider_shipment_id = COALESCE($3, provider_shipment_id), sealine = COALESCE($4, sealine), sealine_name = $5,
       carrier_status = $6, eta = $7, ata = $8, delivered_at = $9, is_delayed = $10, latitude = $11, longitude = $12,
       route = $13, vessel_name = $14, vessel_imo = $15, vessel_mmsi = $16, origin = $17, destination = $18,
       last_synced_at = $19, next_refresh_at = $20, last_checked_at = now(), last_error = NULL
     WHERE id = $1`,
    [
      row.id, state, s.providerShipmentId, s.sealine, s.sealineName, s.carrierStatus, s.eta, s.ata, s.deliveredAt, s.isDelayed,
      s.position?.lat ?? null, s.position?.lng ?? null, JSON.stringify(s.route), s.vessel?.name ?? null, s.vessel?.imo ?? null,
      s.vessel?.mmsi ?? null, s.origin, s.destination, s.lastSyncedAt, s.nextRefreshAt,
    ],
  );

  let added = 0;
  for (const e of s.events) {
    const r = await tx.query(
      `INSERT INTO shipment_events (org_id, shipment_id, event_type, description, location, occurred_at, source, provider_event_uid, is_actual)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8, $9)
       ON CONFLICT (shipment_id, source, provider_event_uid) WHERE provider_event_uid IS NOT NULL DO NOTHING`,
      [ctx.orgId, row.shipment_id, e.isActual ? "carrier_event" : "carrier_plan", e.description, e.location, e.occurredAt, s.provider, `${row.reference}:${e.uid}`, e.isActual],
    );
    added += r.rowCount ?? 0;
  }

  const shipment = (await tx.query(`SELECT status, estimated_arrival, reference FROM shipments WHERE id = $1 FOR UPDATE`, [row.shipment_id])).rows[0];
  if (newEta) {
    const shipEta: Date | null = shipment.estimated_arrival ? new Date(`${fmtDay(shipment.estimated_arrival)}T00:00:00Z`) : null;
    if (!shipEta || fmtDay(shipEta) !== fmtDay(newEta)) {
      await tx.query(`UPDATE shipments SET estimated_arrival = $2::date WHERE id = $1`, [row.shipment_id, fmtDay(newEta)]);
      await tx.query(
        `INSERT INTO shipment_events (org_id, shipment_id, event_type, description, source) VALUES ($1, $2, 'eta_changed', $3, $4)`,
        [ctx.orgId, row.shipment_id, shipEta ? `ETA changed from ${fmtDay(shipEta)} to ${fmtDay(newEta)} (carrier data)` : `ETA set to ${fmtDay(newEta)} (carrier data)`, s.provider],
      );
    }
    const baseline = prevEta ?? shipEta;
    const slip = baseline ? dayDiff(newEta, baseline) : 0;
    if (slip >= 1) {
      await tx.query(
        `INSERT INTO alerts (org_id, shipment_id, severity, kind, message) VALUES ($1, $2, $3, 'eta_delay', $4)`,
        [ctx.orgId, row.shipment_id, slip >= 3 ? "critical" : "warning", `${shipment.reference}: ETA slipped ${slip} day${slip === 1 ? "" : "s"} to ${fmtDay(newEta)} (${row.reference})`],
      );
    }
  }

  const target = provenStatus(s);
  const cur = shipment.status as ShipmentStatus;
  if (target && cur !== "cancelled" && STATUS_RANK.indexOf(target as (typeof STATUS_RANK)[number]) > STATUS_RANK.indexOf(cur as (typeof STATUS_RANK)[number])) {
    // Customs states are owned by people; carrier data never skips past them except on verified delivery.
    if (!(["customs_review", "cleared"].includes(cur) && target !== "delivered")) {
      await tx.query(`UPDATE shipments SET status = $2 WHERE id = $1`, [row.shipment_id, target]);
      await tx.query(
        `INSERT INTO shipment_events (org_id, shipment_id, event_type, description, source) VALUES ($1, $2, 'status_changed', $3, $4)`,
        [ctx.orgId, row.shipment_id, `Status updated to ${target.replace("_", " ")} from carrier data`, s.provider],
      );
    }
  }
  await audit(tx, ctx, "tracking.updated", { type: "shipment", id: row.shipment_id }, { reference: row.reference, provider: s.provider, newEvents: added, eta: s.eta, status: s.carrierStatus }, meta);
}

async function refreshRow(ctx: SyncContext, trackingId: string, meta: RequestMeta = {}) {
  const row = await withTenant(ctx, async (tx) => (await tx.query(`SELECT * FROM container_trackings WHERE id = $1`, [trackingId])).rows[0]);
  if (!row) throw new NotFoundError("Tracking not found.");
  if (row.state === "stopped") throw new ConflictError("Tracking was stopped for this reference.");
  const provider = trackingProvider(row.provider);
  if (!provider) throw new AppError("This tracking provider is not configured.", 503, "tracking_not_configured");
  const outcome = row.state === "active" || row.state === "delivered" ? await provider.refresh(row.reference, row.reference_type) : await provider.track(row.reference, row.reference_type, row.sealine);
  await withTenant(ctx, async (tx) => {
    if (outcome.status === "ok" && !rejectSynthetic(outcome.snapshot)) {
      await applySnapshot(tx, ctx, row, outcome.snapshot, meta);
    } else {
      const msg = outcome.status === "ok" ? "Provider returned demo data." : outcome.message;
      await tx.query(
        `UPDATE container_trackings SET last_checked_at = now(), last_error = $2,
           state = CASE WHEN state IN ('active','delivered') THEN state WHEN $3 = 'not_found' THEN 'not_found' ELSE 'failed' END
         WHERE id = $1`,
        [trackingId, msg, outcome.status],
      );
    }
  });
  return outcome.status;
}

export async function refreshTracking(ctx: TenantContext, trackingId: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "shipments:write");
  if (!z.uuid().safeParse(trackingId).success) throw new NotFoundError("Tracking not found.");
  await consumeRateLimit(RATE_LIMITS.trackingRefresh, ctx.orgId);
  return refreshRow(ctx, trackingId, meta);
}

/** Refresh trackings on a shipment that are due (opened page, at most every 2h per reference). Never throws. */
export async function refreshDueTrackings(ctx: TenantContext, shipmentId: string) {
  try {
    const due = await withTenant(ctx, async (tx) =>
      (
        await tx.query(
          `SELECT id FROM container_trackings
            WHERE shipment_id = $1 AND state IN ('active','pending','failed')
              AND (last_checked_at IS NULL OR last_checked_at < now() - interval '2 hours')
              AND (next_refresh_at IS NULL OR next_refresh_at <= now())`,
          [shipmentId],
        )
      ).rows.map((r) => r.id as string),
    );
    for (const id of due) await refreshRow(ctx, id).catch(() => {});
  } catch {
    // background best-effort
  }
}

export async function stopTracking(ctx: TenantContext, trackingId: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "shipments:write");
  if (!z.uuid().safeParse(trackingId).success) throw new NotFoundError("Tracking not found.");
  await withTenant(ctx, async (tx) => {
    const r = await tx.query(`UPDATE container_trackings SET state = 'stopped' WHERE id = $1 AND state <> 'stopped' RETURNING shipment_id, reference`, [trackingId]);
    if (!r.rowCount) throw new NotFoundError("Tracking not found.");
    await audit(tx, ctx, "tracking.stopped", { type: "shipment", id: r.rows[0].shipment_id }, { reference: r.rows[0].reference }, meta);
  });
}

/**
 * Provider push (webhook) or scheduled sync: refresh every org's tracking of a
 * reference. Runs on the system path to find the rows, then per-tenant under RLS.
 */
export async function syncReference(provider: string, reference: string) {
  const rows = await systemTx(async (tx) =>
    (
      await tx.query(
        `SELECT id, org_id FROM container_trackings WHERE provider = $1 AND reference = $2 AND state IN ('active','pending','failed')`,
        [provider, reference.toUpperCase()],
      )
    ).rows,
  );
  let refreshed = 0;
  for (const r of rows) {
    if ((await refreshRow({ orgId: r.org_id, userId: "" }, r.id).catch(() => "error")) === "ok") refreshed++;
  }
  return refreshed;
}

/** Scheduled job: refresh trackings whose provider data may have changed. Bounded per run. */
export async function syncDueTrackings(limit = 50) {
  const rows = await systemTx(async (tx) =>
    (
      await tx.query(
        `SELECT id, org_id FROM container_trackings
          WHERE state IN ('active','pending')
            AND (last_checked_at IS NULL OR last_checked_at < now() - interval '3 hours')
            AND (next_refresh_at IS NULL OR next_refresh_at <= now())
          ORDER BY last_checked_at NULLS FIRST LIMIT $1`,
        [limit],
      )
    ).rows,
  );
  let refreshed = 0;
  for (const r of rows) if ((await refreshRow({ orgId: r.org_id, userId: "" }, r.id).catch(() => "error")) === "ok") refreshed++;
  return { checked: rows.length, refreshed };
}

export async function markWebhookDelivery(provider: string, deliveryId: string): Promise<boolean> {
  return systemTx(async (tx) => {
    const r = await tx.query(`INSERT INTO webhook_deliveries (provider, delivery_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [provider, deliveryId.slice(0, 200)]);
    await tx.query(`DELETE FROM webhook_deliveries WHERE received_at < now() - interval '14 days'`);
    return (r.rowCount ?? 0) > 0;
  });
}
