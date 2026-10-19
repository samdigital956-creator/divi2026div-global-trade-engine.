"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ORG_COOKIE, requestMeta, requireUser, tenantForAction } from "@/lib/auth/session";
import { acceptInvitation, createOrganization, listMemberships } from "@/server/accounts";
import { createDocumentType } from "@/server/documents";
import { changeMemberRole, inviteMember, removeMember, revokeInvitation, updateOrganization } from "@/server/organization";
import { formToObject } from "@/server/validation";
import type { FormState } from "./form-state";
import { handle } from "./handle";

async function setActiveOrg(orgId: string) {
  (await cookies()).set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function createOrganizationAction(_: FormState, form: FormData): Promise<FormState> {
  const values = formToObject(form);
  let orgId: string | undefined;
  const result = await handle(async () => {
    const user = await requireUser();
    orgId = (await createOrganization(user, values, await requestMeta())).id;
  }, values);
  if (!orgId) return result;
  await setActiveOrg(orgId);
  redirect("/dashboard");
}

export async function acceptInvitationAction(_: FormState, form: FormData): Promise<FormState> {
  let orgId: string | undefined;
  const result = await handle(async () => {
    const user = await requireUser();
    orgId = (await acceptInvitation(user, String(form.get("invitationId") ?? ""), await requestMeta())).orgId;
  });
  if (!orgId) return result;
  await setActiveOrg(orgId);
  redirect("/dashboard");
}

export async function switchOrganizationAction(form: FormData) {
  const user = await requireUser();
  const orgId = String(form.get("orgId") ?? "");
  const memberships = await listMemberships(user.id);
  if (memberships.some((m) => m.orgId === orgId)) await setActiveOrg(orgId);
  redirect("/dashboard");
}

export async function updateOrganizationAction(_: FormState, form: FormData): Promise<FormState> {
  const values = formToObject(form);
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await updateOrganization(ctx, values, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: "Organization settings saved." };
  }, values);
}

export async function createDocumentTypeAction(_: FormState, form: FormData): Promise<FormState> {
  const values = formToObject(form);
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await createDocumentType(ctx, values, await requestMeta());
    revalidatePath("/settings");
    return { ok: true, message: "Document type added." };
  }, values);
}

export async function inviteMemberAction(_: FormState, form: FormData): Promise<FormState> {
  const values = formToObject(form);
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await inviteMember(ctx, values, await requestMeta());
    revalidatePath("/settings/members");
    return { ok: true, message: `Invitation created for ${values.email}. They can accept it after signing up with that email and verifying it.` };
  }, values);
}

export async function changeRoleAction(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await changeMemberRole(ctx, String(form.get("membershipId")), String(form.get("role")), await requestMeta());
    revalidatePath("/settings/members");
    return { ok: true, message: "Role updated." };
  });
}

export async function removeMemberAction(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await removeMember(ctx, String(form.get("membershipId")), await requestMeta());
    revalidatePath("/settings/members");
    return { ok: true, message: "Member removed." };
  });
}

export async function revokeInvitationAction(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await revokeInvitation(ctx, String(form.get("invitationId")), await requestMeta());
    revalidatePath("/settings/members");
    return { ok: true, message: "Invitation revoked." };
  });
}
