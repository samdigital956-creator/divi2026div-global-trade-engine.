import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { audit, type RequestMeta } from "@/lib/audit";
import { assertCan } from "@/lib/authz";
import { planForPrice, planPrices, billingProvider } from "@/lib/billing/registry";
import type { PriceInfo, SubscriptionEvent } from "@/lib/billing/types";
import { systemTx, withTenant, type TenantContext } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";

const CHECKOUT_TOKEN_TTL_SEC = 24 * 3600;

export type PlanOption = {
  key: string;
  name: string;
  priceId: string | null;
  price: PriceInfo | null;
  limits: { shipments: number | null; documents: number | null; storageBytes: number | null; seats: number | null; trackings: number | null };
};

export type BillingOverview = {
  configured: boolean;
  provider: string | null;
  planKey: string;
  planName: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  cancelAtPeriodEnd: boolean;
  hasSubscription: boolean;
  plans: PlanOption[];
  pricesError: boolean;
};

/**
 * Checkout binds the payment to an organization with a signed token, so a
 * webhook can trust which org a new subscription belongs to even though
 * Paddle.js runs in the browser.
 */
export function signCheckoutToken(orgId: string, userId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + CHECKOUT_TOKEN_TTL_SEC;
  const payload = `${orgId}.${userId}.${exp}`;
  return `${payload}.${createHmac("sha256", env.appSecret).update(`checkout:${payload}`).digest("hex")}`;
}

export function verifyCheckoutToken(token: string | null, now = Date.now()): { orgId: string; userId: string } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [orgId, userId, expRaw, sig] = parts;
  if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(userId).success || !/^[0-9a-f]{64}$/.test(sig)) return null;
  // The token only has to be valid when checkout starts; Paddle may deliver the webhook later.
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp + 7 * 24 * 3600 < Math.floor(now / 1000)) return null;
  const expected = createHmac("sha256", env.appSecret).update(`checkout:${orgId}.${userId}.${expRaw}`).digest();
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected) ? { orgId, userId } : null;
}

export async function getBillingOverview(ctx: TenantContext): Promise<BillingOverview> {
  assertCan(ctx.role, "org:read");
  const provider = billingProvider();
  const prices = planPrices();
  const { sub, plans } = await withTenant(ctx, async (tx) => {
    const s = await tx.query(
      `SELECT s.status, s.billing_provider, s.billing_subscription_ref, s.cancel_at_period_end,
              CASE WHEN s.billing_subscription_ref IS NULL OR s.status = 'canceled' THEN date_trunc('month', now()) ELSE s.current_period_start END AS current_period_start,
              CASE WHEN s.billing_subscription_ref IS NULL OR s.status = 'canceled' THEN date_trunc('month', now()) + interval '1 month' ELSE s.current_period_end END AS current_period_end,
              p.key, p.name
         FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.org_id = $1`,
      [ctx.orgId],
    );
    const p = await tx.query(
      `SELECT key, name, monthly_shipment_limit, monthly_document_limit, storage_limit_bytes, seat_limit, monthly_tracking_limit
         FROM subscription_plans WHERE is_active ORDER BY monthly_shipment_limit NULLS LAST`,
    );
    return { sub: s.rows[0], plans: p.rows };
  });
  if (!sub) throw new AppError("This organization has no subscription record.", 500, "no_subscription");

  let priceInfo: PriceInfo[] = [];
  let pricesError = false;
  if (provider.configured() && Object.keys(prices).length) {
    priceInfo = await provider.prices(Object.values(prices)).catch(() => {
      pricesError = true;
      return [];
    });
  }

  return {
    configured: provider.configured() && Object.keys(prices).length > 0,
    provider: sub.billing_provider,
    planKey: sub.key,
    planName: sub.name,
    status: sub.status,
    periodStart: sub.current_period_start,
    periodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    hasSubscription: !!sub.billing_subscription_ref && sub.status !== "canceled",
    pricesError,
    plans: plans.map((p) => ({
      key: p.key,
      name: p.name,
      priceId: prices[p.key] ?? null,
      price: priceInfo.find((x) => x.priceId === prices[p.key]) ?? null,
      limits: {
        shipments: p.monthly_shipment_limit,
        documents: p.monthly_document_limit,
        storageBytes: p.storage_limit_bytes === null ? null : Number(p.storage_limit_bytes),
        seats: p.seat_limit,
        trackings: p.monthly_tracking_limit,
      },
    })),
  };
}

/** Values the browser needs to open Paddle checkout for a plan. */
export async function prepareCheckout(ctx: TenantContext, planKey: string, email: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "billing:manage");
  const provider = billingProvider();
  const client = provider.clientConfig();
  const priceId = planPrices()[planKey];
  if (!provider.configured() || !client) throw new AppError("Billing is not connected yet.", 503, "billing_not_configured");
  if (!priceId) throw new ValidationError("This plan cannot be bought online. Contact us for Enterprise pricing.");
  await withTenant(ctx, async (tx) => {
    const s = await tx.query(`SELECT status, billing_subscription_ref FROM subscriptions WHERE org_id = $1`, [ctx.orgId]);
    if (s.rows[0]?.billing_subscription_ref && s.rows[0].status !== "canceled") {
      throw new ConflictError("This organization already has a subscription. Change the plan instead.");
    }
    await audit(tx, ctx, "billing.checkout_started", { type: "organization", id: ctx.orgId }, { plan: planKey }, meta);
  });
  return { ...client, priceId, email, checkoutToken: signCheckoutToken(ctx.orgId, ctx.userId) };
}

export async function changePlan(ctx: TenantContext, planKey: string, meta: RequestMeta = {}) {
  assertCan(ctx.role, "billing:manage");
  const priceId = planPrices()[planKey];
  if (!priceId) throw new ValidationError("This plan cannot be bought online. Contact us for Enterprise pricing.");
  const ref = await withTenant(ctx, async (tx) => {
    const s = await tx.query(`SELECT status, billing_subscription_ref FROM subscriptions WHERE org_id = $1`, [ctx.orgId]);
    const row = s.rows[0];
    if (!row?.billing_subscription_ref || row.status === "canceled") throw new ConflictError("There is no active subscription to change.");
    return row.billing_subscription_ref as string;
  });
  // The plan itself changes when the provider confirms it by webhook.
  await billingProvider().changePlan(ref, priceId);
  await withTenant(ctx, (tx) => audit(tx, ctx, "billing.plan_change_requested", { type: "organization", id: ctx.orgId }, { plan: planKey }, meta));
}

export async function billingPortalUrl(ctx: TenantContext, meta: RequestMeta = {}) {
  assertCan(ctx.role, "billing:manage");
  const row = await withTenant(ctx, async (tx) => {
    const s = await tx.query(`SELECT billing_customer_ref, billing_subscription_ref FROM subscriptions WHERE org_id = $1`, [ctx.orgId]);
    await audit(tx, ctx, "billing.portal_opened", { type: "organization", id: ctx.orgId }, {}, meta);
    return s.rows[0];
  });
  if (!row?.billing_customer_ref) throw new ConflictError("There is no billing account yet. Choose a plan first.");
  return billingProvider().portalUrl(row.billing_customer_ref, row.billing_subscription_ref);
}

/**
 * Apply a verified provider event. The org is found by the stored subscription
 * reference, or, for a new subscription, by the signed checkout token.
 * Older events than the last one applied are ignored (delivery is unordered).
 */
export async function applySubscriptionEvent(provider: string, e: SubscriptionEvent): Promise<"applied" | "ignored" | "unknown_org"> {
  return systemTx(async (tx) => {
    let sub = (await tx.query(`SELECT * FROM subscriptions WHERE billing_subscription_ref = $1 FOR UPDATE`, [e.subscriptionRef])).rows[0];
    if (!sub) {
      const bound = verifyCheckoutToken(e.checkoutToken);
      if (!bound) return "unknown_org";
      sub = (await tx.query(`SELECT * FROM subscriptions WHERE org_id = $1 FOR UPDATE`, [bound.orgId])).rows[0];
      if (!sub) return "unknown_org";
      // A live subscription is never replaced by another one silently.
      if (sub.billing_subscription_ref && sub.billing_subscription_ref !== e.subscriptionRef && sub.status !== "canceled") return "ignored";
    }
    if (sub.last_billing_event_at && new Date(sub.last_billing_event_at) > new Date(e.occurredAt)) return "ignored";

    // Canceled → back to Trial limits; otherwise the plan the price belongs to.
    const planKey = e.status === "canceled" ? "trial" : planForPrice(e.priceId);
    const plan = planKey ? (await tx.query(`SELECT id, key FROM subscription_plans WHERE key = $1`, [planKey])).rows[0] : null;

    await tx.query(
      `UPDATE subscriptions SET
         plan_id = COALESCE($2, plan_id), status = $3, billing_provider = $4,
         billing_customer_ref = COALESCE($5, billing_customer_ref), billing_subscription_ref = $6,
         cancel_at_period_end = $7,
         current_period_start = COALESCE($8::timestamptz, current_period_start),
         current_period_end = COALESCE($9::timestamptz, current_period_end),
         last_billing_event_at = $10
       WHERE id = $1`,
      [sub.id, plan?.id ?? null, e.status, provider, e.customerRef, e.subscriptionRef, e.cancelAtPeriodEnd, e.periodStart, e.periodEnd, e.occurredAt],
    );
    await audit(
      tx,
      { orgId: sub.org_id, userId: null },
      "billing.subscription_updated",
      { type: "organization", id: sub.org_id },
      { provider, event: e.eventType, status: e.status, plan: plan?.key ?? null, unknownPrice: !plan && e.status !== "canceled" ? e.priceId : undefined, cancelAtPeriodEnd: e.cancelAtPeriodEnd },
    );
    return "applied";
  });
}
