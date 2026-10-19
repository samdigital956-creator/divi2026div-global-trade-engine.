import { describe, expect, it, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { approveDocument, documentAccessUrl, getDocument, listDocuments, saveDocumentFields, uploadDocument } from "@/server/documents";
import { listDocumentTypes } from "@/server/documents";
import { getOrganization, listAuditLogs, listMembers, removeMember } from "@/server/organization";
import { addShipmentEvent, createShipment, getShipment, listShipments, updateShipment } from "@/server/shipments";
import { completeTask, listTasks } from "@/server/work";
import { makeOrg, PDF_BYTES } from "./support/fixtures";

describe("cross-tenant isolation (two organizations)", () => {
  let A: Awaited<ReturnType<typeof makeOrg>>;
  let B: Awaited<ReturnType<typeof makeOrg>>;
  let shipmentA: string;
  let docA: string;

  beforeAll(async () => {
    A = await makeOrg("Acme Imports");
    B = await makeOrg("Beta Trading");
    shipmentA = await createShipment(A.ctx, { reference: "A-001", transportMode: "ocean" });
    await createShipment(B.ctx, { reference: "B-001", transportMode: "air" });
    const types = await listDocumentTypes(A.ctx);
    docA = await uploadDocument(A.ctx, {
      shipmentId: shipmentA,
      documentTypeId: types.find((t) => t.key === "commercial_invoice")!.id,
      filename: "invoice.pdf",
      bytes: PDF_BYTES,
    });
  });

  it("lists only the caller's shipments", async () => {
    const a = await listShipments(A.ctx);
    const b = await listShipments(B.ctx);
    expect(a.items.map((s) => s.reference)).toEqual(["A-001"]);
    expect(b.items.map((s) => s.reference)).toEqual(["B-001"]);
  });

  it("cannot read another org's shipment or document by id", async () => {
    await expect(getShipment(B.ctx, shipmentA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getDocument(B.ctx, docA)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listDocuments(B.ctx, { shipmentId: shipmentA })).toEqual([]);
  });

  it("cannot get a download link for another org's document", async () => {
    await expect(documentAccessUrl(B.ctx, docA, "download")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot modify another org's records", async () => {
    await expect(updateShipment(B.ctx, shipmentA, { reference: "HIJACK", transportMode: "air" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(addShipmentEvent(B.ctx, shipmentA, { description: "fake" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveDocumentFields(B.ctx, docA, { invoice_number: "X" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(approveDocument(B.ctx, docA)).rejects.toBeInstanceOf(NotFoundError);
    const tasksA = await listTasks(A.ctx);
    await expect(completeTask(B.ctx, tasksA[0].id)).rejects.toBeInstanceOf(NotFoundError);
    const shipment = await getShipment(A.ctx, shipmentA);
    expect(shipment.reference).toBe("A-001");
  });

  it("cannot upload into another org's shipment", async () => {
    const types = await listDocumentTypes(B.ctx);
    await expect(
      uploadDocument(B.ctx, { shipmentId: shipmentA, documentTypeId: types[0].id, filename: "x.pdf", bytes: PDF_BYTES }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not leak members, audit logs or org settings", async () => {
    const m = await listMembers(B.ctx);
    expect(m.members.map((x) => x.userId)).toEqual([B.owner.id]);
    const logs = await listAuditLogs(B.ctx);
    expect(logs.items.every((l) => l.entityId !== shipmentA && l.entityId !== docA)).toBe(true);
    expect((await getOrganization(B.ctx)).id).toBe(B.org.id);
    const membersA = await listMembers(A.ctx);
    await expect(removeMember(B.ctx, membersA.members[0].membershipId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("forged context (user not in org) is still bounded by RLS to the claimed org only", async () => {
    // Even if application code passed a wrong org id, RLS scopes queries to that org — never to all orgs.
    const rows = await withTenant({ orgId: B.org.id, userId: A.owner.id }, (tx) => tx.query("SELECT org_id FROM shipments"));
    expect(new Set(rows.rows.map((r) => r.org_id))).toEqual(new Set([B.org.id]));
  });
});

describe("row level security at the database layer", () => {
  it("filters raw queries, blocks cross-tenant writes and enforces WITH CHECK", async () => {
    const A = await makeOrg();
    const B = await makeOrg();
    const sA = await createShipment(A.ctx, { reference: "RLS-A", transportMode: "ocean" });

    await withTenant(B.ctx, async (tx) => {
      const sel = await tx.query("SELECT * FROM shipments WHERE id = $1", [sA]);
      expect(sel.rowCount).toBe(0);
      const upd = await tx.query("UPDATE shipments SET notes = 'pwned' WHERE id = $1", [sA]);
      expect(upd.rowCount).toBe(0);
      const del = await tx.query("DELETE FROM shipments WHERE id = $1", [sA]);
      expect(del.rowCount).toBe(0);
    });

    await expect(
      withTenant(B.ctx, (tx) =>
        tx.query("INSERT INTO shipments (org_id, reference, transport_mode) VALUES ($1, 'INJECT', 'air')", [A.org.id]),
      ),
    ).rejects.toThrow(/row-level security/);

    expect((await getShipment(A.ctx, sA)).notes).toBeNull();
  });

  it("returns nothing when no tenant is bound", async () => {
    const A = await makeOrg();
    await createShipment(A.ctx, { reference: "UNBOUND", transportMode: "ocean" });
    const { rows } = await withTenant({ orgId: "", userId: "" }, (tx) => tx.query("SELECT count(*)::int AS n FROM shipments"));
    expect(rows[0].n).toBe(0);
  });

  it("makes the audit log append-only for the application role", async () => {
    const A = await makeOrg();
    await expect(withTenant(A.ctx, (tx) => tx.query("UPDATE audit_logs SET action = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(withTenant(A.ctx, (tx) => tx.query("DELETE FROM audit_logs"))).rejects.toThrow(/permission denied/);
  });

  it("does not let tenants change their own subscription", async () => {
    const A = await makeOrg();
    await expect(
      withTenant(A.ctx, (tx) => tx.query("UPDATE subscriptions SET status = 'active'")),
    ).rejects.toThrow(/permission denied/);
  });

  it("hides users outside the current org", async () => {
    const A = await makeOrg();
    const B = await makeOrg();
    const { rows } = await withTenant(A.ctx, (tx) => tx.query("SELECT id FROM users"));
    expect(rows.map((r) => r.id)).toEqual([A.owner.id]);
    expect(rows.map((r) => r.id)).not.toContain(B.owner.id);
  });
});

describe("authorization failures surface as Forbidden, not data", () => {
  it("rejects an unknown role", async () => {
    const A = await makeOrg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(listShipments({ ...A.ctx, role: "guest" as any })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
