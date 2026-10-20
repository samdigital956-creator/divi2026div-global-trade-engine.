import "server-only";
import type { Tx, TenantContext } from "@/lib/db";
import { LimitExceededError } from "@/lib/errors";

type Metric = "shipment_created" | "document_uploaded" | "storage_bytes" | "tracking_started";

const LIMIT_COLUMN: Record<Metric, string> = {
  shipment_created: "monthly_shipment_limit",
  document_uploaded: "monthly_document_limit",
  storage_bytes: "storage_limit_bytes",
  tracking_started: "monthly_tracking_limit",
};

const LIMIT_MESSAGE: Record<Metric, string> = {
  shipment_created: "Your plan's monthly shipment limit has been reached.",
  document_uploaded: "Your plan's monthly document limit has been reached.",
  storage_bytes: "Your plan's storage limit has been reached.",
  tracking_started: "Your plan's monthly live-tracking limit has been reached.",
};

/**
 * Subscriptions with a provider subscription use the provider's billing period.
 * Everyone else (trial, canceled, manually assigned plans) gets calendar months,
 * so their monthly limits reset instead of counting from sign-up forever.
 */
const PERIOD = `(SELECT s0.*,
    CASE WHEN s0.billing_subscription_ref IS NULL OR s0.status = 'canceled' THEN date_trunc('month', now()) ELSE s0.current_period_start END AS period_start,
    CASE WHEN s0.billing_subscription_ref IS NULL OR s0.status = 'canceled' THEN date_trunc('month', now()) + interval '1 month' ELSE s0.current_period_end END AS period_end
  FROM subscriptions s0)`;

/** Enforce the plan limit for `metric` before adding `quantity` to it. */
export async function assertWithinLimit(tx: Tx, ctx: TenantContext, metric: Metric, quantity = 1) {
  const { rows } = await tx.query(
    `SELECT p.${LIMIT_COLUMN[metric]} AS lim, s.period_start
       FROM ${PERIOD} s JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.org_id = $1`,
    [ctx.orgId],
  );
  const sub = rows[0];
  if (!sub || sub.lim === null) return;
  const windowed = metric !== "storage_bytes";
  const used = await tx.query(
    `SELECT COALESCE(SUM(quantity), 0)::bigint AS used FROM usage_records
      WHERE org_id = $1 AND metric = $2 ${windowed ? "AND occurred_at >= $3" : ""}`,
    windowed ? [ctx.orgId, metric, sub.period_start] : [ctx.orgId, metric],
  );
  if (Number(used.rows[0].used) + quantity > Number(sub.lim)) throw new LimitExceededError(LIMIT_MESSAGE[metric]);
}

export async function recordUsage(tx: Tx, ctx: TenantContext, metric: Metric, quantity: number, referenceId?: string) {
  await tx.query(`INSERT INTO usage_records (org_id, metric, quantity, reference_id) VALUES ($1, $2, $3, $4)`, [
    ctx.orgId,
    metric,
    quantity,
    referenceId ?? null,
  ]);
}

export async function usageSummary(tx: Tx, ctx: TenantContext) {
  const { rows } = await tx.query(
    `SELECT p.key, p.name, p.monthly_shipment_limit, p.monthly_document_limit, p.storage_limit_bytes, p.seat_limit, p.monthly_tracking_limit,
            s.status, s.period_start, s.period_end,
            (SELECT COALESCE(SUM(quantity),0) FROM usage_records u WHERE u.org_id = s.org_id AND u.metric = 'shipment_created' AND u.occurred_at >= s.period_start)::bigint AS shipments,
            (SELECT COALESCE(SUM(quantity),0) FROM usage_records u WHERE u.org_id = s.org_id AND u.metric = 'document_uploaded' AND u.occurred_at >= s.period_start)::bigint AS documents,
            (SELECT COALESCE(SUM(quantity),0) FROM usage_records u WHERE u.org_id = s.org_id AND u.metric = 'storage_bytes')::bigint AS storage,
            (SELECT COALESCE(SUM(quantity),0) FROM usage_records u WHERE u.org_id = s.org_id AND u.metric = 'tracking_started' AND u.occurred_at >= s.period_start)::bigint AS trackings,
            (SELECT count(*) FROM organization_memberships m WHERE m.org_id = s.org_id)::int AS seats
       FROM ${PERIOD} s JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.org_id = $1`,
    [ctx.orgId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    planKey: r.key as string,
    planName: r.name as string,
    status: r.status as string,
    periodStart: r.period_start as Date,
    periodEnd: r.period_end as Date,
    shipments: { used: Number(r.shipments), limit: r.monthly_shipment_limit as number | null },
    documents: { used: Number(r.documents), limit: r.monthly_document_limit as number | null },
    storage: { used: Number(r.storage), limit: r.storage_limit_bytes === null ? null : Number(r.storage_limit_bytes) },
    trackings: { used: Number(r.trackings), limit: r.monthly_tracking_limit as number | null },
    seats: { used: r.seats as number, limit: r.seat_limit as number | null },
  };
}
