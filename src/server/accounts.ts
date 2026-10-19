import "server-only";
import { z } from "zod";
import { audit, type RequestMeta } from "@/lib/audit";
import type { Role } from "@/lib/authz";
import { systemTx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Identity } from "@/lib/auth/identity";
import { zodFieldErrors } from "./validation";

/**
 * Bootstrap operations that run before a tenant is selected. They use the
 * system (non-RLS) path, so every query is explicitly scoped to the verified
 * user id or email.
 */

export type AppUser = { id: string; email: string; emailVerified: boolean; displayName: string | null };
export type MembershipSummary = { orgId: string; orgName: string; orgSlug: string; role: Role };

export async function upsertUser(identity: Identity, touchLogin = false): Promise<AppUser> {
  return systemTx(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO users (auth_provider, auth_uid, email, email_verified, display_name, last_login_at)
       VALUES ('firebase', $1, $2, $3, $4, CASE WHEN $5 THEN now() END)
       ON CONFLICT (auth_provider, auth_uid) DO UPDATE
         SET email = EXCLUDED.email,
             email_verified = EXCLUDED.email_verified,
             display_name = COALESCE(EXCLUDED.display_name, users.display_name),
             last_login_at = CASE WHEN $5 THEN now() ELSE users.last_login_at END
       RETURNING id, email, email_verified, display_name`,
      [identity.uid, identity.email.toLowerCase(), identity.emailVerified, identity.name ?? null, touchLogin],
    );
    const r = rows[0];
    return { id: r.id, email: r.email, emailVerified: r.email_verified, displayName: r.display_name };
  });
}

export async function listMemberships(userId: string): Promise<MembershipSummary[]> {
  return systemTx(async (tx) => {
    const { rows } = await tx.query(
      `SELECT o.id, o.name, o.slug, m.role
         FROM organization_memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = $1
        ORDER BY m.created_at`,
      [userId],
    );
    return rows.map((r) => ({ orgId: r.id, orgName: r.name, orgSlug: r.slug, role: r.role }));
  });
}

export const createOrgSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(120),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code.")
    .default("USD"),
});

function slugify(name: string) {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s.length >= 2 ? s : "org";
}

export async function createOrganization(user: AppUser, input: unknown, meta: RequestMeta = {}) {
  const parsed = createOrgSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Please fix the highlighted fields.", zodFieldErrors(parsed.error));
  const { name, countryCode, defaultCurrency } = parsed.data;

  return systemTx(async (tx) => {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; ; i++) {
      const { rowCount } = await tx.query("SELECT 1 FROM organizations WHERE slug = $1", [slug]);
      if (!rowCount) break;
      slug = `${base}-${i}`;
      if (i > 50) slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
    }
    const { rows } = await tx.query(
      `INSERT INTO organizations (name, slug, country_code, default_currency, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, slug`,
      [name, slug, countryCode ?? null, defaultCurrency, user.id],
    );
    const org = rows[0];
    await tx.query(`INSERT INTO organization_memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [org.id, user.id]);
    await tx.query(
      `INSERT INTO subscriptions (org_id, plan_id, status)
       SELECT $1, id, 'trialing' FROM subscription_plans WHERE key = 'trial'`,
      [org.id],
    );
    await audit(tx, { orgId: org.id, userId: user.id }, "org.created", { type: "organization", id: org.id }, { name }, meta);
    return { id: org.id as string, name: org.name as string, slug: org.slug as string };
  });
}

export type PendingInvitation = { id: string; orgName: string; role: Role; expiresAt: string };

export async function listPendingInvitations(user: AppUser): Promise<PendingInvitation[]> {
  return systemTx(async (tx) => {
    const { rows } = await tx.query(
      `SELECT i.id, o.name, i.role, i.expires_at
         FROM organization_invitations i JOIN organizations o ON o.id = i.org_id
        WHERE i.email = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.org_id = i.org_id AND m.user_id = $2)
        ORDER BY i.created_at`,
      [user.email, user.id],
    );
    return rows.map((r) => ({ id: r.id, orgName: r.name, role: r.role, expiresAt: r.expires_at.toISOString() }));
  });
}

export async function acceptInvitation(user: AppUser, invitationId: string, meta: RequestMeta = {}) {
  // Email ownership must be proven before an invitation addressed to it is honoured.
  if (!user.emailVerified) throw new ForbiddenError("Verify your email address before accepting invitations.");
  if (!z.uuid().safeParse(invitationId).success) throw new NotFoundError("Invitation not found.");
  return systemTx(async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, org_id, role FROM organization_invitations
        WHERE id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [invitationId, user.email],
    );
    const inv = rows[0];
    if (!inv) throw new NotFoundError("Invitation not found or expired.");
    const ins = await tx.query(
      `INSERT INTO organization_memberships (org_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [inv.org_id, user.id, inv.role],
    );
    if (!ins.rowCount) throw new ConflictError("You are already a member of this organization.");
    await tx.query("UPDATE organization_invitations SET accepted_at = now() WHERE id = $1", [inv.id]);
    await audit(tx, { orgId: inv.org_id, userId: user.id }, "member.joined", { type: "user", id: user.id }, { role: inv.role, invitationId: inv.id }, meta);
    return { orgId: inv.org_id as string };
  });
}
