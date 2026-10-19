import { describe, expect, it } from "vitest";
import { can } from "@/lib/authz";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { approveDocument, createDocumentType, listDocumentTypes, saveDocumentFields, uploadDocument } from "@/server/documents";
import { changeMemberRole, inviteMember, listAuditLogs, listMembers, removeMember, updateOrganization } from "@/server/organization";
import { createShipment, listShipments } from "@/server/shipments";
import { addMember, makeOrg, PDF_BYTES } from "./support/fixtures";

describe("role permissions", () => {
  it("matches the documented matrix", () => {
    expect(can("viewer", "shipments:read")).toBe(true);
    expect(can("viewer", "shipments:write")).toBe(false);
    expect(can("member", "documents:upload")).toBe(true);
    expect(can("member", "documents:approve")).toBe(false);
    expect(can("admin", "documents:approve")).toBe(true);
    expect(can("admin", "audit:read")).toBe(true);
    expect(can("member", "audit:read")).toBe(false);
  });

  it("viewers can read but not write", async () => {
    const { org, ctx } = await makeOrg();
    const sid = await createShipment(ctx, { reference: "V-1", transportMode: "ocean" });
    const viewer = await addMember(org.id, "viewer");
    expect((await listShipments(viewer.ctx)).total).toBe(1);
    await expect(createShipment(viewer.ctx, { reference: "V-2", transportMode: "ocean" })).rejects.toBeInstanceOf(ForbiddenError);
    const types = await listDocumentTypes(viewer.ctx);
    await expect(
      uploadDocument(viewer.ctx, { shipmentId: sid, documentTypeId: types[0].id, filename: "a.pdf", bytes: PDF_BYTES }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAuditLogs(viewer.ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("members can upload and edit values but not approve", async () => {
    const { org, ctx } = await makeOrg();
    const sid = await createShipment(ctx, { reference: "M-1", transportMode: "ocean" });
    const member = await addMember(org.id, "member");
    const types = await listDocumentTypes(member.ctx);
    const other = types.find((t) => t.key === "other")!;
    const doc = await uploadDocument(member.ctx, { shipmentId: sid, documentTypeId: other.id, filename: "a.pdf", bytes: PDF_BYTES });
    await saveDocumentFields(member.ctx, doc, { summary: "Test" });
    await expect(approveDocument(member.ctx, doc)).rejects.toBeInstanceOf(ForbiddenError);
    await approveDocument(ctx, doc);
    await expect(updateOrganization(member.ctx, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createDocumentType(member.ctx, { name: "Permit", fields: "Number" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteMember(member.ctx, { email: "a@b.test", role: "viewer" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("admins cannot change or remove owners; the last owner is protected", async () => {
    const { org, ctx } = await makeOrg();
    const admin = await addMember(org.id, "admin");
    const { members } = await listMembers(ctx);
    const ownerMembership = members.find((m) => m.role === "owner")!;
    await expect(changeMemberRole(admin.ctx, ownerMembership.membershipId, "viewer")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember(admin.ctx, ownerMembership.membershipId)).rejects.toBeInstanceOf(ForbiddenError);
    const adminMembership = (await listMembers(ctx)).members.find((m) => m.userId === admin.user.id)!;
    await expect(changeMemberRole(admin.ctx, adminMembership.membershipId, "owner")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeMemberRole(ctx, ownerMembership.membershipId, "admin")).rejects.toBeInstanceOf(ConflictError);
    await expect(removeMember(ctx, ownerMembership.membershipId)).rejects.toBeInstanceOf(ConflictError);
    // Owner can promote, after which the original owner may step down.
    await changeMemberRole(ctx, adminMembership.membershipId, "owner");
    await changeMemberRole(ctx, ownerMembership.membershipId, "admin");
  });
});
