import "server-only";
import type { Tx, TenantContext } from "./db";

export type AuditAction =
  | "org.created"
  | "org.updated"
  | "member.invited"
  | "member.invitation_revoked"
  | "member.invitation_email"
  | "member.joined"
  | "member.role_changed"
  | "member.removed"
  | "shipment.created"
  | "shipment.updated"
  | "shipment.status_changed"
  | "shipment.event_added"
  | "document.uploaded"
  | "document.viewed"
  | "document.downloaded"
  | "document.fields_updated"
  | "document.field_confirmed"
  | "document.approved"
  | "document.rejected"
  | "document.reopened"
  | "document.extraction_attempted"
  | "document_type.created"
  | "task.created"
  | "task.completed"
  | "upload.rejected";

export type RequestMeta = { ip?: string | null; userAgent?: string | null };

export async function audit(
  tx: Tx,
  ctx: Pick<TenantContext, "orgId" | "userId">,
  action: AuditAction,
  entity: { type: string; id?: string | null },
  metadata: Record<string, unknown> = {},
  meta: RequestMeta = {},
) {
  await tx.query(
    `INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ctx.orgId,
      ctx.userId,
      action,
      entity.type,
      entity.id ?? null,
      JSON.stringify(metadata),
      normaliseIp(meta.ip),
      meta.userAgent?.slice(0, 512) ?? null,
    ],
  );
}

function normaliseIp(ip?: string | null): string | null {
  if (!ip) return null;
  const first = ip.split(",")[0].trim();
  // Only store values Postgres' inet type will accept.
  return /^[0-9a-fA-F:.]+$/.test(first) ? first : null;
}
