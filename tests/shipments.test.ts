import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "@/lib/errors";
import { listAuditLogs } from "@/server/organization";
import { addShipmentEvent, createShipment, getShipment, listShipmentEvents, listShipments, updateShipment } from "@/server/shipments";
import { makeOrg } from "./support/fixtures";

describe("shipment CRUD", () => {
  it("creates, reads, lists, searches and updates", async () => {
    const { ctx } = await makeOrg();
    const id = await createShipment(ctx, {
      reference: "PO-1001",
      transportMode: "ocean",
      supplierName: "Shenzhen Widgets",
      originCountry: "cn",
      destinationCountry: "US",
      containerNumber: "mscu1234567",
      incoterm: "FOB",
      estimatedDeparture: "2026-11-01",
      estimatedArrival: "2026-11-28",
    });
    const s = await getShipment(ctx, id);
    expect(s).toMatchObject({ reference: "PO-1001", originCountry: "CN", containerNumber: "MSCU1234567", status: "draft", estimatedArrival: "2026-11-28" });

    await createShipment(ctx, { reference: "PO-1002", transportMode: "air" });
    expect((await listShipments(ctx)).total).toBe(2);
    expect((await listShipments(ctx, { q: "widgets" })).items.map((x) => x.reference)).toEqual(["PO-1001"]);
    expect((await listShipments(ctx, { status: "in_transit" })).total).toBe(0);

    await updateShipment(ctx, id, { reference: "PO-1001", transportMode: "ocean", status: "in_transit" });
    expect((await getShipment(ctx, id)).status).toBe("in_transit");
    const events = await listShipmentEvents(ctx, id);
    expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["created", "status_changed"]));
    expect(events.every((e) => e.source === "manual" || e.source === "system")).toBe(true);

    const actions = (await listAuditLogs(ctx)).items.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["shipment.created", "shipment.updated", "shipment.status_changed"]));
  });

  it("validates input with field errors", async () => {
    const { ctx } = await makeOrg();
    const err = await createShipment(ctx, {
      reference: "",
      transportMode: "teleport",
      originCountry: "China",
      containerNumber: "123",
      estimatedDeparture: "2026-12-10",
      estimatedArrival: "2026-12-01",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(Object.keys(err.fieldErrors)).toEqual(
      expect.arrayContaining(["reference", "transportMode", "originCountry", "containerNumber"]),
    );
    const err2 = await createShipment(ctx, { reference: "X", transportMode: "air", estimatedDeparture: "2026-12-10", estimatedArrival: "2026-12-01" }).catch((e) => e);
    expect(err2.fieldErrors.estimatedArrival).toMatch(/after departure/);
  });

  it("rejects duplicate references within an org but allows them across orgs", async () => {
    const A = await makeOrg();
    const B = await makeOrg();
    await createShipment(A.ctx, { reference: "DUP", transportMode: "air" });
    await expect(createShipment(A.ctx, { reference: "DUP", transportMode: "air" })).rejects.toBeInstanceOf(ConflictError);
    await expect(createShipment(B.ctx, { reference: "DUP", transportMode: "air" })).resolves.toBeTypeOf("string");
  });

  it("records manual timeline events", async () => {
    const { ctx } = await makeOrg();
    const id = await createShipment(ctx, { reference: "EV-1", transportMode: "ocean" });
    await addShipmentEvent(ctx, id, { eventType: "note", description: "Supplier confirmed cargo ready", occurredAt: "2026-10-01T09:30" });
    await expect(addShipmentEvent(ctx, id, { description: "" })).rejects.toBeInstanceOf(ValidationError);
    const events = await listShipmentEvents(ctx, id);
    expect(events.find((e) => e.eventType === "note")).toMatchObject({ source: "manual", description: "Supplier confirmed cargo ready" });
  });

  it("enforces the plan's monthly shipment limit", async () => {
    const { ctx } = await makeOrg();
    for (let i = 0; i < 25; i++) await createShipment(ctx, { reference: `L-${i}`, transportMode: "road" });
    await expect(createShipment(ctx, { reference: "L-25", transportMode: "road" })).rejects.toThrow(/limit/);
  });
});
