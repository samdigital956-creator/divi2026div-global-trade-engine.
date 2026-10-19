import "server-only";
import { z } from "zod";
import { audit, type RequestMeta } from "@/lib/audit";
import { assertCan, ROLES, type Role } from "@/lib/authz";
import { withTenant, type TenantContext } from "@/lib/db";
import { ConflictError, ForbiddenError, LimitExceededError, NotFoundError, ValidationError } from "@/lib/errors";
import { usageSummary } from "./usage";
import { zodFieldErrors } from "./validation";

export async function getOrganization(ctx: TenantContext) {
  assertCan(ctx.role, "org:read");
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, name, slug, country_code, default_currency, timezone, created_at FROM organizations WHERE id = $1`,
      [ctx.orgId],
    );
    if (!rows[0]) throw new NotFoundError("Organization not found.");
    const r = rows[0];
    return {
      id: r.id as string,
      name: r.name as string,
      slug: r.slug as string,
      countryCode: (r.country_code as string | null)?.trim() ?? null,
      defaultCurrency: r.default_currency as string,
      timezone: r.timezone as string,
      createdAt: r.created_at as Date,
      usage: await usageSummary(tx, ctx),
    };
  });
}

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(120),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code.").optional(),
  defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code."),
  timezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone."),
});

export async function updateOrganization(ctx: TenantContext, input: unknown, meta: RequestMeta = {}) {
  assertCan(ctx.role, "org:update");
  const parsed = orgSettingsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  const s = parsed.data;
  await withTenant(ctx, async (tx) => {
    await tx.query(
      `UPDATE organizations SET name = $2, country_code = $3, default_currency = $4, timezone = $5 WHERE id = $1`,
      [ctx.orgId, s.name, s.countryCode ?? null, s.defaultCurrency, s.timezone],
    );
    await audit(tx, ctx, "org.updated", { type: "organization", id: ctx.orgId }, s, meta);
  });
}

// --- Members --------------------------------------------------------------

export async function listMembers(ctx: TenantContext) {
  assertCan(ctx.role, "members:read");
  return withTenant(ctx, async (tx) => {
    const members = await tx.query(
      `SELECT m.id, m.user_id, m.role, m.created_at, u.email, u.display_name, u.last_login_at
         FROM organization_memberships m JOIN users u ON u.id = m.user_id
        ORDER BY array_position(ARRAY['owner','admin','member','viewer']::member_role[], m.role), u.email`,
    );
    const invitations = await tx.query(
      `SELECT id, email, role, expires_at, created_at FROM organization_invitations
        WHERE accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC`,
    );
    return {
      members: members.rows.map((r) => ({
        membershipId: r.id as string,
        userId: r.user_id as string,
        role: r.role as Role,
        email: r.email as string,
        displayName: r.display_name as string | null,
        lastLoginAt: r.last_login_at as Date | null,
        joinedAt: r.created_at as Date,
      })),
      invitations: invitations.rows.map((r) => ({
        id: r.id as string,
        email: r.email as string,
        role: r.role as Role,
        expiresAt: r.expires_at as Date,
        expired: (r.expires_at as Date) < new Date(),
      })),
    };
  });
}

export const inviteSchema = z.object({
  email: z.email("Enter a valid email address.").transform((e) => e.toLowerCase()),
  role: z.enum(["admin", "member", "viewer"], "Choose a role."),
});

export async function inviteMember(ctx: TenantContext, input: unknown, meta: RequestMeta = {}) {
  assertCan(ctx.role, "members:manage");
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  const { email, role } = parsed.data;
  if (role === "admin" && ctx.role !== "owner" && ctx.role !== "admin") throw new ForbiddenError();
  await withTenant(ctx, async (tx) => {
    const exists = await tx.query(
      `SELECT 1 FROM organization_memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1`,
      [email],
    );
    if (exists.rowCount) throw new ConflictError("This person is already a member.");
    const seats = await tx.query(
      `SELECT p.seat_limit,
              (SELECT count(*) FROM organization_memberships)::int
            + (SELECT count(*) FROM organization_invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())::int AS used
         FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id`,
    );
    const s = seats.rows[0];
    if (s && s.seat_limit !== null && s.used >= s.seat_limit) throw new LimitExceededError("Your plan's seat limit has been reached.");
    // Expired open invitations would block the unique index; retire them first.
    await tx.query(
      `UPDATE organization_invitations SET revoked_at = now() WHERE email = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`,
      [email],
    );
    try {
      const { rows } = await tx.query(
        `INSERT INTO organization_invitations (org_id, email, role, invited_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [ctx.orgId, email, role, ctx.userId],
      );
      await audit(tx, ctx, "member.invited", { type: "invitation", id: rows[0].id }, { email, role }, meta);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new ConflictError("An invitation for this email is already pending.");
      throw err;
    }
  });
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "members:manage");
  if (!z.uuid().safeParse(invitationId).success) throw new NotFoundError("Invitation not found.");
  await withTenant(ctx, async (tx) => {
    const r = await tx.query(
      `UPDATE organization_invitations SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email`,
      [invitationId],
    );
    if (!r.rowCount) throw new NotFoundError("Invitation not found.");
    await audit(tx, ctx, "member.invitation_revoked", { type: "invitation", id: invitationId }, { email: r.rows[0].email }, meta);
  });
}

/** Owners can change anyone; admins can change members/viewers only and cannot grant owner. */
function assertCanManage(actor: Role, targetCurrent: Role, targetNew?: Role) {
  if (actor === "owner") return;
  if (actor === "admin" && targetCurrent !== "owner" && targetNew !== "owner") return;
  throw new ForbiddenError("Only an owner can change owners.");
}

export async function changeMemberRole(ctx: TenantContext, membershipId: string, role: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "members:manage");
  const newRole = ROLES.find((r) => r === role);
  if (!newRole) throw new ValidationError("Choose a valid role.");
  if (!z.uuid().safeParse(membershipId).success) throw new NotFoundError("Member not found.");
  await withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(`SELECT user_id, role FROM organization_memberships WHERE id = $1 FOR UPDATE`, [membershipId]);
    const m = rows[0];
    if (!m) throw new NotFoundError("Member not found.");
    assertCanManage(ctx.role, m.role, newRole);
    if (m.role === "owner" && newRole !== "owner") await assertAnotherOwner(tx, membershipId);
    await tx.query(`UPDATE organization_memberships SET role = $2 WHERE id = $1`, [membershipId, newRole]);
    await audit(tx, ctx, "member.role_changed", { type: "user", id: m.user_id }, { from: m.role, to: newRole }, meta);
  });
}

export async function removeMember(ctx: TenantContext, membershipId: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "members:manage");
  if (!z.uuid().safeParse(membershipId).success) throw new NotFoundError("Member not found.");
  await withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(`SELECT user_id, role FROM organization_memberships WHERE id = $1 FOR UPDATE`, [membershipId]);
    const m = rows[0];
    if (!m) throw new NotFoundError("Member not found.");
    assertCanManage(ctx.role, m.role);
    if (m.role === "owner") await assertAnotherOwner(tx, membershipId);
    await tx.query(`DELETE FROM organization_memberships WHERE id = $1`, [membershipId]);
    await audit(tx, ctx, "member.removed", { type: "user", id: m.user_id }, { role: m.role }, meta);
  });
}

async function assertAnotherOwner(tx: import("@/lib/db").Tx, exceptMembershipId: string) {
  const { rows } = await tx.query(
    `SELECT count(*)::int AS n FROM organization_memberships WHERE role = 'owner' AND id <> $1`,
    [exceptMembershipId],
  );
  if (rows[0].n === 0) throw new ConflictError("An organization must keep at least one owner.");
}

// --- Audit log ------------------------------------------------------------

export async function listAuditLogs(ctx: TenantContext, opts: { action?: string; entityId?: string; before?: number; limit?: number } = {}) {
  assertCan(ctx.role, "audit:read");
  const limit = Math.min(opts.limit ?? 50, 200);
  const entityId = opts.entityId && z.uuid().safeParse(opts.entityId).success ? opts.entityId : null;
  const action = opts.action && /^[a-z_.]{2,64}$/.test(opts.action) ? opts.action : null;
  return withTenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, host(a.ip_address) AS ip, a.created_at,
              COALESCE(u.display_name, u.email) AS actor
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ($1::text IS NULL OR a.action LIKE $1 || '%')
          AND ($2::uuid IS NULL OR a.entity_id = $2)
          AND ($3::bigint IS NULL OR a.id < $3)
        ORDER BY a.id DESC LIMIT $4`,
      [action, entityId, opts.before ?? null, limit + 1],
    );
    const items = rows.slice(0, limit).map((r) => ({
      id: Number(r.id),
      action: r.action as string,
      entityType: r.entity_type as string,
      entityId: r.entity_id as string | null,
      metadata: r.metadata as Record<string, unknown>,
      ip: r.ip as string | null,
      actor: r.actor as string | null,
      createdAt: r.created_at as Date,
    }));
    return { items, nextBefore: rows.length > limit ? items[items.length - 1].id : null };
  });
}
