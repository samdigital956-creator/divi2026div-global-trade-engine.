import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as paddleWebhook } from "@/app/api/webhooks/paddle/route";
import { parsePaddleEvent, PaddleProvider, verifyPaddleSignature } from "@/lib/billing/paddle";
import { setBillingProviderForTesting } from "@/lib/billing/registry";
import { systemTx, withTenant } from "@/lib/db";
import { ConflictError, ForbiddenError, LimitExceededError } from "@/lib/errors";
import { applySubscriptionEvent, billingPortalUrl, changePlan, getBillingOverview, prepareCheckout, signCheckoutToken, verifyCheckoutToken } from "@/server/billing";
import { createShipment } from "@/server/shipments";
import { assertWithinLimit, usageSummary } from "@/server/usage";
import { addMember, makeOrg } from "./support/fixtures";

const SECRET = "pdl_ntfset_test_secret";
const GROWTH = "pri_growth_test";
const ENTERPRISE = "pri_enterprise_test";

type Call = { method: string; url: string; body: unknown };
let calls: Call[];

function fakeFetch(): typeof fetch {
  return (async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined });
    const u = String(url);
    if (u.includes("/prices")) {
      return Response.json({ data: [{ id: GROWTH, unit_price: { amount: "9900", currency_code: "USD" }, billing_cycle: { interval: "month", frequency: 1 } }] });
    }
    if (u.includes("/portal-sessions")) return Response.json({ data: { urls: { general: { overview: "https://customer-portal.paddle.com/cpl_test" } } } });
    if (u.includes("/subscriptions/")) return Response.json({ data: {} });
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  }) as typeof fetch;
}

function subscriptionBody(o: { eventId?: string; type?: string; occurredAt?: string; subId?: string; status?: string; price?: string; token?: string | null; cancel?: boolean }) {
  return {
    event_id: o.eventId ?? `evt_${Math.random().toString(36).slice(2)}`,
    event_type: o.type ?? "subscription.created",
    occurred_at: o.occurredAt ?? new Date().toISOString(),
    data: {
      id: o.subId ?? `sub_${Math.random().toString(36).slice(2)}`,
      status: o.status ?? "active",
      customer_id: "ctm_test",
      items: [{ price: { id: o.price ?? GROWTH }, quantity: 1 }],
      current_billing_period: { starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" },
      scheduled_change: o.cancel ? { action: "cancel", effective_at: "2026-11-01T00:00:00Z" } : null,
      custom_data: o.token === null ? null : { gtc_checkout: o.token },
    },
  };
}

const sign = (raw: string, ts = Math.floor(Date.now() / 1000)) => `ts=${ts};h1=${createHmac("sha256", SECRET).update(`${ts}:${raw}`).digest("hex")}`;

beforeEach(() => {
  calls = [];
  vi.stubEnv("BILLING_PLAN_PRICES", `growth=${GROWTH},enterprise=${ENTERPRISE}`);
  setBillingProviderForTesting(new PaddleProvider("pdl_sdbx_apikey", "test_clienttoken", SECRET, "sandbox", fakeFetch()));
});
afterEach(() => {
  setBillingProviderForTesting(null);
  vi.unstubAllEnvs();
});

async function subOf(orgId: string) {
  return (await systemTx((tx) => tx.query(`SELECT s.*, p.key FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE org_id = $1`, [orgId]))).rows[0];
}

describe("Paddle signatures and payloads", () => {
  it("verifies ts:body HMAC and rejects tampering or stale timestamps", () => {
    const raw = '{"event_type":"subscription.created"}';
    expect(verifyPaddleSignature(raw, sign(raw), SECRET)).toBe(true);
    expect(verifyPaddleSignature(raw + " ", sign(raw), SECRET)).toBe(false);
    expect(verifyPaddleSignature(raw, sign(raw, Math.floor(Date.now() / 1000) - 120), SECRET)).toBe(false);
    expect(verifyPaddleSignature(raw, "ts=1;h1=nothex", SECRET)).toBe(false);
    expect(verifyPaddleSignature(raw, null, SECRET)).toBe(false);
  });

  it("maps a subscription event and ignores other event types", () => {
    const e = parsePaddleEvent(subscriptionBody({ subId: "sub_1", token: "tok", cancel: true }))!;
    expect(e).toMatchObject({ subscriptionRef: "sub_1", customerRef: "ctm_test", status: "active", priceId: GROWTH, cancelAtPeriodEnd: true, checkoutToken: "tok" });
    expect(parsePaddleEvent({ event_type: "transaction.completed", event_id: "evt", data: {} })).toBeNull();
    expect(parsePaddleEvent({ ...subscriptionBody({}), data: { ...subscriptionBody({}).data, status: "weird" } })).toBeNull();
  });

  it("signs checkout tokens bound to org and user", () => {
    const org = "11111111-1111-4111-8111-111111111111";
    const user = "22222222-2222-4222-8222-222222222222";
    const t = signCheckoutToken(org, user);
    expect(verifyCheckoutToken(t)).toEqual({ orgId: org, userId: user });
    expect(verifyCheckoutToken(t.replace(org, "33333333-3333-4333-8333-333333333333"))).toBeNull();
    expect(verifyCheckoutToken(t.slice(0, -1) + (t.endsWith("0") ? "1" : "0"))).toBeNull();
    expect(verifyCheckoutToken(signCheckoutToken(org, user, Date.now() - 10 * 86_400_000))).toBeNull();
  });
});

describe("checkout, plan changes and portal", () => {
  it("lets only owners start checkout and shows Paddle prices", async () => {
    const { org, ctx } = await makeOrg();
    const admin = await addMember(org.id, "admin");
    const r = await prepareCheckout(ctx, "growth", "owner@example.test");
    expect(r).toMatchObject({ environment: "sandbox", clientToken: "test_clienttoken", priceId: GROWTH });
    expect(verifyCheckoutToken(r.checkoutToken)).toEqual({ orgId: ctx.orgId, userId: ctx.userId });
    await expect(prepareCheckout(admin.ctx, "growth", "a@example.test")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(prepareCheckout(ctx, "trial", "owner@example.test")).rejects.toThrow(/cannot be bought online/);

    const b = await getBillingOverview(admin.ctx);
    expect(b).toMatchObject({ configured: true, planKey: "trial", status: "trialing", hasSubscription: false });
    expect(b.plans.find((p) => p.key === "growth")?.price).toMatchObject({ amount: 99, currency: "USD", interval: "month" });
  });

  it("refuses checkout without configuration", async () => {
    setBillingProviderForTesting(new PaddleProvider(undefined, undefined, undefined, "sandbox", fakeFetch()));
    const { ctx } = await makeOrg();
    await expect(prepareCheckout(ctx, "growth", "x@example.test")).rejects.toThrow(/not connected/);
    expect((await getBillingOverview(ctx)).configured).toBe(false);
  });

  it("changes plan through Paddle and opens the portal for the subscribed org", async () => {
    const { ctx } = await makeOrg();
    await expect(changePlan(ctx, "enterprise")).rejects.toBeInstanceOf(ConflictError);
    await expect(billingPortalUrl(ctx)).rejects.toBeInstanceOf(ConflictError);
    await applySubscriptionEvent("paddle", parsePaddleEvent(subscriptionBody({ subId: "sub_change", token: signCheckoutToken(ctx.orgId, ctx.userId) }))!);

    await changePlan(ctx, "enterprise");
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_change");
    expect(patch.body).toEqual({ items: [{ price_id: ENTERPRISE, quantity: 1 }], proration_billing_mode: "prorated_immediately" });
    expect((await subOf(ctx.orgId)).key).toBe("growth"); // unchanged until Paddle confirms

    expect(await billingPortalUrl(ctx)).toBe("https://customer-portal.paddle.com/cpl_test");
    await expect(prepareCheckout(ctx, "growth", "x@example.test")).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("applying subscription events", () => {
  it("activates the paid plan, its limits and billing period", async () => {
    const { ctx } = await makeOrg();
    const r = await applySubscriptionEvent("paddle", parsePaddleEvent(subscriptionBody({ subId: "sub_a", token: signCheckoutToken(ctx.orgId, ctx.userId) }))!);
    expect(r).toBe("applied");
    const s = await subOf(ctx.orgId);
    expect(s).toMatchObject({ key: "growth", status: "active", billing_provider: "paddle", billing_customer_ref: "ctm_test", billing_subscription_ref: "sub_a" });
    expect(new Date(s.current_period_end).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const u = await withTenant(ctx, (tx) => usageSummary(tx, ctx));
    expect(u?.shipments.limit).toBe(500);
  });

  it("ignores events without a valid checkout binding and out-of-order events", async () => {
    const { ctx } = await makeOrg();
    expect(await applySubscriptionEvent("paddle", parsePaddleEvent(subscriptionBody({ token: null }))!)).toBe("unknown_org");
    expect(await applySubscriptionEvent("paddle", parsePaddleEvent(subscriptionBody({ token: "forged.token.1.abc" }))!)).toBe("unknown_org");

    const token = signCheckoutToken(ctx.orgId, ctx.userId);
    await applySubscriptionEvent("paddle", parsePaddleEvent(subscriptionBody({ subId: "sub_o", token, occurredAt: "2026-10-10T10:00:00Z" }))!);
    const stale = await applySubscriptionEvent("paddle", parsePaddleEvent(subscriptionBody({ subId: "sub_o", type: "subscription.past_due", status: "past_due", occurredAt: "2026-10-10T09:00:00Z" }))!);
    expect(stale).toBe("ignored");
    expect((await subOf(ctx.orgId)).status).toBe("active");

    // A second live subscription for the same org does not silently replace the first.
    expect(await applySubscriptionEvent("paddle", parsePaddleEvent(subscriptionBody({ subId: "sub_other", token }))!)).toBe("ignored");
  });

  it("returns to Trial limits when the subscription is canceled", async () => {
    const { ctx } = await makeOrg();
    await applySubscriptionEvent("paddle", parsePaddleEvent(subscriptionBody({ subId: "sub_c", token: signCheckoutToken(ctx.orgId, ctx.userId), occurredAt: "2026-10-01T00:00:00Z" }))!);
    await applySubscriptionEvent("paddle", parsePaddleEvent(subscriptionBody({ subId: "sub_c", type: "subscription.canceled", status: "canceled", occurredAt: "2026-10-02T00:00:00Z" }))!);
    expect(await subOf(ctx.orgId)).toMatchObject({ key: "trial", status: "canceled" });
    expect((await getBillingOverview(ctx)).hasSubscription).toBe(false);
  });
});

describe("Paddle webhook route", () => {
  const post = (raw: string, headers: Record<string, string>) =>
    paddleWebhook(new NextRequest("http://localhost/api/webhooks/paddle", { method: "POST", body: raw, headers: { "content-type": "application/json", ...headers } }));

  it("rejects bad signatures, applies valid events once", async () => {
    const { ctx } = await makeOrg();
    const raw = JSON.stringify(subscriptionBody({ eventId: `evt_${Date.now()}`, subId: "sub_hook", token: signCheckoutToken(ctx.orgId, ctx.userId) }));
    expect((await post(raw, { "paddle-signature": "ts=1;h1=00" })).status).toBe(401);
    const first = await post(raw, { "paddle-signature": sign(raw) });
    expect(await first.json()).toEqual({ ok: true, result: "applied" });
    expect(await (await post(raw, { "paddle-signature": sign(raw) })).json()).toMatchObject({ duplicate: true });
    expect((await subOf(ctx.orgId)).key).toBe("growth");
  });
});

describe("usage periods", () => {
  it("resets monthly limits for unbilled organizations every calendar month", async () => {
    const { ctx } = await makeOrg(); // trial: 25 shipments / month
    await systemTx(async (tx) => {
      await tx.query(`UPDATE subscriptions SET current_period_start = now() - interval '90 days', current_period_end = now() - interval '60 days' WHERE org_id = $1`, [ctx.orgId]);
      await tx.query(`INSERT INTO usage_records (org_id, metric, quantity, occurred_at) VALUES ($1, 'shipment_created', 25, now() - interval '70 days')`, [ctx.orgId]);
    });
    await expect(createShipment(ctx, { reference: "PO-NEW-MONTH", transportMode: "ocean" })).resolves.toBeTruthy();
    await systemTx((tx) => tx.query(`INSERT INTO usage_records (org_id, metric, quantity) VALUES ($1, 'shipment_created', 24)`, [ctx.orgId]));
    await expect(withTenant(ctx, (tx) => assertWithinLimit(tx, ctx, "shipment_created"))).rejects.toBeInstanceOf(LimitExceededError);
  });
});
