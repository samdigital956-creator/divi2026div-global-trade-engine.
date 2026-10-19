import "server-only";
import { z } from "zod";
import { audit, type RequestMeta } from "@/lib/audit";
import { assertCan } from "@/lib/authz";
import { withTenant, type TenantContext } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { zodFieldErrors } from "./validation";

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dueAt: z.iso.date("Use a valid date.").optional(),
  shipmentId: z.uuid().optional(),
});

export async function listTasks(ctx: TenantContext, opts: { shipmentId?: string; status?: "open" | "done"; limit?: number } = {}) {
  assertCan(ctx.role, "shipments:read");
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      `SELECT t.id, t.title, t.status, t.priority, t.due_at, t.shipment_id, t.document_id, s.reference, t.created_at
         FROM tasks t LEFT JOIN shipments s ON s.id = t.shipment_id
        WHERE ($1::uuid IS NULL OR t.shipment_id = $1) AND ($2::text IS NULL OR t.status = $2)
        ORDER BY (t.status = 'open') DESC,
                 array_position(ARRAY['urgent','high','normal','low'], t.priority),
                 t.due_at NULLS LAST, t.created_at DESC
        LIMIT $3`,
      [opts.shipmentId ?? null, opts.status ?? null, Math.min(opts.limit ?? 50, 200)],
    );
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      status: r.status as "open" | "done" | "cancelled",
      priority: r.priority as string,
      dueAt: r.due_at as Date | null,
      shipmentId: r.shipment_id as string | null,
      documentId: r.document_id as string | null,
      shipmentReference: r.reference as string | null,
    }));
  });
}

export async function createTask(ctx: TenantContext, input: unknown, meta: RequestMeta = {}) {
  assertCan(ctx.role, "tasks:write");
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  const t = parsed.data;
  await withTenant(ctx, async (tx) => {
    if (t.shipmentId) {
      const s = await tx.query("SELECT 1 FROM shipments WHERE id = $1", [t.shipmentId]);
      if (!s.rowCount) throw new NotFoundError("Shipment not found.");
    }
    const { rows } = await tx.query(
      `INSERT INTO tasks (org_id, shipment_id, title, priority, due_at, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [ctx.orgId, t.shipmentId ?? null, t.title, t.priority, t.dueAt ?? null, ctx.userId],
    );
    await audit(tx, ctx, "task.created", { type: "task", id: rows[0].id }, { title: t.title }, meta);
  });
}

export async function completeTask(ctx: TenantContext, id: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "tasks:write");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Task not found.");
  await withTenant(ctx, async (tx) => {
    const r = await tx.query(`UPDATE tasks SET status = 'done', completed_at = now() WHERE id = $1 AND status = 'open' RETURNING id`, [id]);
    if (!r.rowCount) throw new NotFoundError("Task not found or already done.");
    await audit(tx, ctx, "task.completed", { type: "task", id }, {}, meta);
  });
}

export async function listOpenAlerts(ctx: TenantContext, limit = 10) {
  assertCan(ctx.role, "shipments:read");
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, severity, kind, message, shipment_id, document_id, created_at FROM alerts
        WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id as string,
      severity: r.severity as "info" | "warning" | "critical",
      message: r.message as string,
      shipmentId: r.shipment_id as string | null,
      documentId: r.document_id as string | null,
      createdAt: r.created_at as Date,
    }));
  });
}

export async function dashboardStats(ctx: TenantContext) {
  assertCan(ctx.role, "shipments:read");
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(`
      SELECT
        (SELECT count(*) FROM shipments WHERE status NOT IN ('delivered','cancelled'))::int AS active_shipments,
        (SELECT count(*) FROM shipments WHERE status = 'in_transit')::int AS in_transit,
        (SELECT count(*) FROM shipments WHERE estimated_arrival BETWEEN current_date AND current_date + 7
                                         AND status NOT IN ('delivered','cancelled'))::int AS arriving_7d,
        (SELECT count(*) FROM shipment_documents WHERE status = 'needs_review')::int AS docs_review,
        (SELECT count(*) FROM tasks WHERE status = 'open')::int AS open_tasks,
        (SELECT count(*) FROM alerts WHERE resolved_at IS NULL)::int AS open_alerts,
        (SELECT count(*) FROM shipments)::int AS total_shipments`);
    const r = rows[0];
    return {
      activeShipments: r.active_shipments as number,
      inTransit: r.in_transit as number,
      arriving7d: r.arriving_7d as number,
      documentsNeedingReview: r.docs_review as number,
      openTasks: r.open_tasks as number,
      openAlerts: r.open_alerts as number,
      totalShipments: r.total_shipments as number,
    };
  });
}
