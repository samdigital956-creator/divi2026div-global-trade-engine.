import "server-only";
import { PaddleProvider } from "./paddle";
import type { BillingProvider } from "./types";

let override: BillingProvider | null = null;
export function setBillingProviderForTesting(p: BillingProvider | null) {
  override = p;
}

export function billingProvider(): BillingProvider {
  return override ?? new PaddleProvider();
}

/**
 * Plan key → provider price id, from BILLING_PLAN_PRICES="growth=pri_…,enterprise=pri_…".
 * Prices themselves (amount, currency, tax) live in the provider.
 */
export function planPrices(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (process.env.BILLING_PLAN_PRICES || "").split(",")) {
    const [key, price] = pair.split("=").map((s) => s?.trim());
    if (key && price && /^[a-z0-9_-]+$/.test(key)) out[key] = price;
  }
  return out;
}

export function planForPrice(priceId: string | null): string | null {
  if (!priceId) return null;
  return Object.entries(planPrices()).find(([, p]) => p === priceId)?.[0] ?? null;
}
