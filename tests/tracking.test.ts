import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as cronPOST } from "@/app/api/cron/tracking/route";
import { POST as webhookPOST } from "@/app/api/webhooks/traqo/route";
import { systemTx } from "@/lib/db";
import { ForbiddenError, LimitExceededError, NotFoundError, ValidationError } from "@/lib/errors";
import { setTrackingProvidersForTesting } from "@/lib/tracking/registry";
import { mapTraqoShipment, TraqoProvider } from "@/lib/tracking/traqo";
import type { ReferenceType, TrackingProvider, TrackOutcome } from "@/lib/tracking/types";
import { verifyTraqoSignature } from "@/lib/tracking/webhook";
import { createShipment, getShipment, listShipmentEvents } from "@/server/shipments";
import { listTrackings, refreshTracking, startTracking, stopTracking, syncReference } from "@/server/tracking";
import { addMember, makeOrg } from "./support/fixtures";

// Route handlers defer work with after(); outside a Next request scope, run it right away.
const deferred: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => void deferred.push(Promise.resolve().then(fn)),
}));

const FIXTURE = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/traqo-container.json"), "utf8"));

/** The sandbox fixture with its demo markers removed, standing in for a live response. */
function liveBody(overrides: Record<string, unknown> = {}) {
  const b = structuredClone(FIXTURE);
  delete b.mode;
  delete b.source;
  Object.assign(b.data, overrides);
  return b;
}

class FakeProvider implements TrackingProvider {
  readonly id = "traqo";
  readonly label = "Traqo";
  calls: string[] = [];
  next: (ref: string) => TrackOutcome = (ref) => ({ status: "ok", snapshot: mapTraqoShipment(liveBody({ reference_number: ref }), "container") });
  configured() {
    return true;
  }
  async lookupCarrier() {
    return { scac: "MSCU", name: "MSC", confidence: "high" };
  }
  async track(ref: string, _t: ReferenceType, sealine: string | null) {
    this.calls.push(`track:${ref}:${sealine}`);
    return this.next(ref);
  }
  async refresh(ref: string) {
    this.calls.push(`refresh:${ref}`);
    return this.next(ref);
  }
}

let fake: FakeProvider;
beforeEach(() => {
  fake = new FakeProvider();
  setTrackingProvidersForTesting([fake]);
});
afterEach(() => {
  setTrackingProvidersForTesting(null);
  vi.unstubAllEnvs();
});

async function shipmentFor(ctx: Awaited<ReturnType<typeof makeOrg>>["ctx"], extra: Record<string, unknown> = {}) {
  return createShipment(ctx, { reference: `PO-${Math.random().toString(36).slice(2, 8)}`, transportMode: "ocean", ...extra });
}

describe("Traqo adapter", () => {
  it("maps the sandbox response and flags it as synthetic", () => {
    const s = mapTraqoShipment(FIXTURE, "container");
    expect(s.synthetic).toBe(true);
    expect(s.reference).toBe("MSCU1234566");
    expect(s.sealine).toBe("MSCU");
    expect(s.carrierStatus).toBe("IN_TRANSIT");
    expect(s.eta).toBe("2026-10-24T07:43:04.000Z");
    expect(s.position).toEqual({ lat: 33.298, lng: -81.362 });
    expect(s.route).toHaveLength(3);
    expect(s.events.length).toBeGreaterThan(0);
    expect(s.events.every((e) => e.uid && e.description)).toBe(true);
  });

  it("maps provider errors to outcomes without throwing", async () => {
    const respond = (status: number, body: unknown = {}) => new TraqoProvider("k", "https://x.test", (async () => new Response(JSON.stringify(body), { status })) as typeof fetch);
    expect((await respond(404).track("MSCU1234566", "container", "MSCU")).status).toBe("not_found");
    expect((await respond(402).track("MSCU1234566", "container", "MSCU")).status).toBe("limit_reached");
    expect((await respond(401).track("MSCU1234566", "container", "MSCU")).status).toBe("error");
    const timeout = new TraqoProvider("k", "https://x.test", (async () => {
      throw new Error("timeout");
    }) as typeof fetch);
    expect((await timeout.track("MSCU1234566", "container", null)).status).toBe("error");
  });
});

describe("starting and refreshing live tracking", () => {
  it("stores carrier data, timeline events, ETA and a proven status", async () => {
    const { ctx } = await makeOrg();
    const id = await shipmentFor(ctx, { status: "booked", estimatedArrival: "2026-10-20" });
    const r = await startTracking(ctx, id, { reference: "mscu 1234566", sealine: "mscu" });
    expect(r.outcome).toBe("ok");
    expect(fake.calls).toEqual(["track:MSCU1234566:MSCU"]);

    const [t] = await listTrackings(ctx, id);
    expect(t).toMatchObject({ reference: "MSCU1234566", state: "active", carrierStatus: "IN_TRANSIT", isDelayed: true });
    expect(t.position).toEqual({ lat: 33.298, lng: -81.362 });

    const s = await getShipment(ctx, id);
    expect(s.status).toBe("in_transit");
    expect(s.estimatedArrival && new Date(s.estimatedArrival).toISOString().slice(0, 10)).toBe("2026-10-24");

    const events = await listShipmentEvents(ctx, id);
    const carrier = events.filter((e) => e.source === "traqo");
    expect(carrier.length).toBeGreaterThan(FIXTURE.data.events_table.length - 1);
    expect(events.some((e) => e.eventType === "eta_changed")).toBe(true);

    // 4-day slip against the planned ETA → critical alert.
    const alerts = await systemTx((tx) => tx.query(`SELECT severity, kind FROM alerts WHERE shipment_id = $1`, [id]));
    expect(alerts.rows).toEqual([{ severity: "critical", kind: "eta_delay" }]);

    const usage = await systemTx((tx) => tx.query(`SELECT count(*)::int AS n FROM usage_records WHERE org_id = $1 AND metric = 'tracking_started'`, [ctx.orgId]));
    expect(usage.rows[0].n).toBe(1);
  });

  it("does not duplicate events on refresh and alerts only when the ETA slips further", async () => {
    const { ctx } = await makeOrg();
    const id = await shipmentFor(ctx);
    const { trackingId } = await startTracking(ctx, id, { reference: "MSCU1234566" });
    const before = (await listShipmentEvents(ctx, id)).length;

    await refreshTracking(ctx, trackingId);
    expect((await listShipmentEvents(ctx, id)).length).toBe(before);
    expect(fake.calls.at(-1)).toBe("refresh:MSCU1234566");

    fake.next = (ref) => ({ status: "ok", snapshot: mapTraqoShipment(liveBody({ reference_number: ref, eta: "2026-10-26 07:43:04" }), "container") });
    await refreshTracking(ctx, trackingId);
    const alerts = await systemTx((tx) => tx.query(`SELECT severity, message FROM alerts WHERE shipment_id = $1`, [id]));
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].severity).toBe("warning");
    expect(alerts.rows[0].message).toContain("2 days");
  });

  it("never moves a shipment backwards or past customs states on carrier data", async () => {
    const { ctx } = await makeOrg();
    const id = await shipmentFor(ctx, { status: "customs_review" });
    await startTracking(ctx, id, { reference: "MSCU1234566" });
    expect((await getShipment(ctx, id)).status).toBe("customs_review");

    fake.next = (ref) => ({ status: "ok", snapshot: mapTraqoShipment(liveBody({ reference_number: ref, closed_at: "2026-10-25 10:00:00" }), "container") });
    const [t] = await listTrackings(ctx, id);
    await refreshTracking(ctx, t.id);
    expect((await getShipment(ctx, id)).status).toBe("delivered");
    expect((await listTrackings(ctx, id))[0].state).toBe("delivered");
  });

  it("records not-found references without spending plan usage", async () => {
    const { ctx } = await makeOrg();
    const id = await shipmentFor(ctx);
    fake.next = () => ({ status: "not_found", message: "nope" });
    const r = await startTracking(ctx, id, { reference: "MSCU1234566" });
    expect(r.outcome).toBe("not_found");
    expect((await listTrackings(ctx, id))[0].state).toBe("not_found");
    const usage = await systemTx((tx) => tx.query(`SELECT count(*)::int AS n FROM usage_records WHERE org_id = $1 AND metric = 'tracking_started'`, [ctx.orgId]));
    expect(usage.rows[0].n).toBe(0);
  });

  it("rejects provider demo data in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { ctx } = await makeOrg();
    const id = await shipmentFor(ctx);
    fake.next = () => ({ status: "ok", snapshot: mapTraqoShipment(FIXTURE, "container") });
    const r = await startTracking(ctx, id, { reference: "MSCU1234566" });
    expect(r.outcome).toBe("error");
    expect(await listShipmentEvents(ctx, id).then((e) => e.filter((x) => x.source === "traqo"))).toHaveLength(0);
  });

  it("validates references and rejects duplicates", async () => {
    const { ctx } = await makeOrg();
    const id = await shipmentFor(ctx);
    await expect(startTracking(ctx, id, { reference: "ABC" })).rejects.toBeInstanceOf(ValidationError);
    await startTracking(ctx, id, { reference: "MSCU1234566" });
    await expect(startTracking(ctx, id, { reference: "MSCU1234566" })).rejects.toThrow(/already being tracked/);
  });

  it("enforces the plan's monthly tracking limit before calling the provider", async () => {
    const { ctx } = await makeOrg(); // trial: 5
    const id = await shipmentFor(ctx);
    for (let i = 0; i < 5; i++) await startTracking(ctx, id, { reference: `MSCU123456${i}` });
    const calls = fake.calls.length;
    await expect(startTracking(ctx, id, { reference: "MSCU1234569" })).rejects.toBeInstanceOf(LimitExceededError);
    expect(fake.calls.length).toBe(calls);
  });

  it("stopping hides the reference from refreshes", async () => {
    const { ctx } = await makeOrg();
    const id = await shipmentFor(ctx);
    const { trackingId } = await startTracking(ctx, id, { reference: "MSCU1234566" });
    await stopTracking(ctx, trackingId);
    await expect(refreshTracking(ctx, trackingId)).rejects.toThrow(/stopped/);
  });
});

describe("tracking access control", () => {
  it("keeps trackings inside their organization", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const id = await shipmentFor(a.ctx);
    const { trackingId } = await startTracking(a.ctx, id, { reference: "MSCU1234566" });

    expect(await listTrackings(b.ctx, id)).toEqual([]);
    await expect(refreshTracking(b.ctx, trackingId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(stopTracking(b.ctx, trackingId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(startTracking(b.ctx, id, { reference: "MSCU7654321" })).rejects.toBeInstanceOf(NotFoundError);
    const rows = await systemTx((tx) => tx.query(`SELECT count(*)::int AS n FROM container_trackings WHERE org_id = $1`, [b.ctx.orgId]));
    expect(rows.rows[0].n).toBe(0);
  });

  it("lets viewers read but not start tracking", async () => {
    const { org, ctx } = await makeOrg();
    const id = await shipmentFor(ctx);
    await startTracking(ctx, id, { reference: "MSCU1234566" });
    const viewer = await addMember(org.id, "viewer");
    expect(await listTrackings(viewer.ctx, id)).toHaveLength(1);
    await expect(startTracking(viewer.ctx, id, { reference: "MSCU7654321" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Traqo webhook and scheduled sync", () => {
  const SECRET = "whsec_test_secret";
  const sign = (body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}`;
  const hook = (body: string, headers: Record<string, string>) =>
    webhookPOST(new NextRequest("http://localhost/api/webhooks/traqo", { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));

  it("verifies signatures in constant time and rejects stale timestamps", () => {
    const body = '{"a":1}';
    expect(verifyTraqoSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyTraqoSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyTraqoSignature(body, sign(body, Math.floor(Date.now() / 1000) - 301), SECRET)).toBe(false);
    expect(verifyTraqoSignature(body, "t=1,v1=zz", SECRET)).toBe(false);
    expect(verifyTraqoSignature(body, null, SECRET)).toBe(false);
  });

  it("rejects unsigned deliveries and de-duplicates by delivery id", async () => {
    vi.stubEnv("TRAQO_WEBHOOK_SECRET", SECRET);
    const body = JSON.stringify({ event: "eta.changed", created: 1, data: { reference_number: "MSCU1234566" } });
    expect((await hook(body, { "x-traqo-signature": "t=1,v1=00" })).status).toBe(401);
    const delivery = `dlv_${Date.now()}`;
    const first = await hook(body, { "x-traqo-signature": sign(body), "x-traqo-delivery": delivery });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    const again = await hook(body, { "x-traqo-signature": sign(body), "x-traqo-delivery": delivery });
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
  });

  it("re-reads the provider for every organization tracking a pushed reference", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const ref = `MSCU${String(Date.now()).slice(-7)}`;
    await startTracking(a.ctx, await shipmentFor(a.ctx), { reference: ref });
    await startTracking(b.ctx, await shipmentFor(b.ctx), { reference: ref });
    fake.calls = [];
    expect(await syncReference("traqo", ref)).toBe(2);
    expect(fake.calls).toEqual([`refresh:${ref}`, `refresh:${ref}`]);
  });

  it("protects the cron endpoint with CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    const call = (auth?: string) => cronPOST(new NextRequest("http://localhost/api/cron/tracking", { method: "POST", headers: auth ? { authorization: auth } : {} }));
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    const ok = await call("Bearer cron-secret-value");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
  });
});

