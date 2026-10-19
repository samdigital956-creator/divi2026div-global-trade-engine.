import { randomUUID } from "node:crypto";
import type { Role } from "@/lib/authz";
import { systemTx, type TenantContext } from "@/lib/db";
import { createOrganization, upsertUser, type AppUser } from "@/server/accounts";

export async function makeUser(overrides: Partial<{ email: string; emailVerified: boolean; name: string }> = {}): Promise<AppUser> {
  const uid = randomUUID();
  return upsertUser({
    uid,
    email: overrides.email ?? `user-${uid.slice(0, 8)}@example.test`,
    emailVerified: overrides.emailVerified ?? true,
    name: overrides.name ?? null,
  });
}

/** Creates an org owned by a fresh user; returns the owner's tenant context. */
export async function makeOrg(name = `Org ${randomUUID().slice(0, 6)}`) {
  const owner = await makeUser();
  const org = await createOrganization(owner, { name });
  const ctx: TenantContext = { userId: owner.id, orgId: org.id, role: "owner" };
  return { org, owner, ctx };
}

/** Adds an existing or new user to the org with the given role (direct insert for test setup). */
export async function addMember(orgId: string, role: Role, user?: AppUser) {
  const u = user ?? (await makeUser());
  await systemTx((tx) =>
    tx.query("INSERT INTO organization_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [orgId, u.id, role]),
  );
  const ctx: TenantContext = { userId: u.id, orgId, role };
  return { user: u, ctx };
}

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
