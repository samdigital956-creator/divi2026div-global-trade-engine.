import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingProvider, PriceInfo, SubscriptionEvent, SubscriptionStatus } from "./types";

/**
 * Paddle Billing (https://developer.paddle.com) — merchant of record.
 * - REST API: Bearer API key; sandbox-api.paddle.com for sandbox, api.paddle.com live.
 * - Webhooks: `Paddle-Signature: ts=<unix>;h1=<hex>`, h1 = HMAC-SHA256(secret, `${ts}:${rawBody}`).
 * - Checkout runs in the browser through Paddle.js with a client-side token.
 */
const TIMEOUT_MS = 20_000;
// Paddle's helpers default to 5s; a little slack for clock skew between Paddle and the app.
const SIGNATURE_TOLERANCE_SEC = 30;
const STATUSES: SubscriptionStatus[] = ["trialing", "active", "past_due", "paused", "canceled"];
// ISO 4217 currencies without minor units (Paddle sends amounts in the lowest unit).
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD"]);

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string, toleranceSec = SIGNATURE_TOLERANCE_SEC, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(";").map((p) => p.trim().split("=", 2) as [string, string]));
  const ts = Number(parts.ts);
  if (!Number.isInteger(ts) || !/^[0-9a-f]{64}$/i.test(parts.h1 ?? "")) return false;
  if (Math.abs(Math.floor(now / 1000) - ts) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest();
  const given = Buffer.from(parts.h1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Map a Paddle notification body to a subscription event; other event types return null. */
export function parsePaddleEvent(body: Json): SubscriptionEvent | null {
  const type = str(body.event_type);
  if (!type?.startsWith("subscription.")) return null;
  const d = (body.data ?? {}) as Json;
  const status = str(d.status) as SubscriptionStatus | null;
  const id = str(d.id);
  const eventId = str(body.event_id);
  if (!id || !eventId || !status || !STATUSES.includes(status)) return null;
  const items = Array.isArray(d.items) ? (d.items as Json[]) : [];
  const price = (items[0]?.price ?? {}) as Json;
  const period = (d.current_billing_period ?? {}) as Json;
  const scheduled = (d.scheduled_change ?? null) as Json | null;
  const custom = (d.custom_data ?? {}) as Json;
  return {
    eventId,
    eventType: type,
    occurredAt: str(body.occurred_at) ?? new Date().toISOString(),
    subscriptionRef: id,
    customerRef: str(d.customer_id),
    status,
    priceId: str(price.id) ?? str(items[0]?.price_id),
    periodStart: str(period.starts_at),
    periodEnd: str(period.ends_at),
    cancelAtPeriodEnd: str(scheduled?.action) === "cancel",
    checkoutToken: str(custom.gtc_checkout),
  };
}

export class PaddleProvider implements BillingProvider {
  readonly id = "paddle";
  readonly label = "Paddle";

  constructor(
    private readonly apiKey = process.env.PADDLE_API_KEY,
    private readonly clientToken = process.env.PADDLE_CLIENT_TOKEN,
    private readonly webhookSecret = process.env.PADDLE_WEBHOOK_SECRET,
    private readonly environment: "sandbox" | "production" = process.env.PADDLE_ENV === "production" ? "production" : "sandbox",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get base() {
    return this.environment === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
  }

  configured() {
    return !!(this.apiKey && this.clientToken && this.webhookSecret);
  }

  clientConfig() {
    return this.clientToken ? { environment: this.environment, clientToken: this.clientToken } : null;
  }

  verifyWebhook(rawBody: string, header: string | null) {
    return verifyPaddleSignature(rawBody, header, this.webhookSecret ?? "");
  }

  parseWebhook(rawBody: string) {
    try {
      return parsePaddleEvent(JSON.parse(rawBody));
    } catch {
      return null;
    }
  }

  private async call(method: string, path: string, body?: unknown): Promise<Json> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const err = (json.error ?? {}) as Json;
      // Paddle error codes are safe to show; never echo the request.
      throw new Error(`Paddle ${method} ${path.split("?")[0]} failed (${res.status}${str(err.code) ? `: ${str(err.code)}` : ""})`);
    }
    return json;
  }

  async prices(priceIds: string[]): Promise<PriceInfo[]> {
    if (!priceIds.length) return [];
    const json = await this.call("GET", `/prices?id=${priceIds.map(encodeURIComponent).join(",")}&per_page=50`);
    return ((json.data as Json[] | undefined) ?? []).map((p) => {
      const unit = (p.unit_price ?? {}) as Json;
      const cycle = (p.billing_cycle ?? null) as Json | null;
      const currency = str(unit.currency_code) ?? "USD";
      const minor = Number(unit.amount ?? 0);
      return {
        priceId: String(p.id),
        amount: ZERO_DECIMAL.has(currency) ? minor : minor / 100,
        currency,
        interval: str(cycle?.interval),
        frequency: typeof cycle?.frequency === "number" ? (cycle.frequency as number) : null,
      };
    });
  }

  async portalUrl(customerRef: string, subscriptionRef: string | null) {
    const json = await this.call("POST", `/customers/${encodeURIComponent(customerRef)}/portal-sessions`, subscriptionRef ? { subscription_ids: [subscriptionRef] } : {});
    const urls = ((json.data as Json | undefined)?.urls ?? {}) as Json;
    const url = str(((urls.general ?? {}) as Json).overview);
    if (!url) throw new Error("Paddle did not return a portal link");
    return url;
  }

  async changePlan(subscriptionRef: string, priceId: string) {
    await this.call("PATCH", `/subscriptions/${encodeURIComponent(subscriptionRef)}`, {
      items: [{ price_id: priceId, quantity: 1 }],
      proration_billing_mode: "prorated_immediately",
    });
  }
}
