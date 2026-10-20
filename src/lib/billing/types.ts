/**
 * Provider-neutral subscription billing. The provider (Paddle today) is the
 * merchant of record: it owns prices, tax, invoices and card data. The app only
 * stores which plan an organization is on and the provider's references.
 */

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "paused" | "canceled";

/** A subscription change reported by the provider, normalised. */
export type SubscriptionEvent = {
  eventId: string;
  eventType: string;
  occurredAt: string; // ISO-8601
  subscriptionRef: string;
  customerRef: string | null;
  status: SubscriptionStatus;
  priceId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Opaque value the app attached at checkout (signed org binding). */
  checkoutToken: string | null;
};

export type PriceInfo = {
  priceId: string;
  amount: number; // major units, e.g. 99.00
  currency: string;
  interval: string | null; // month, year
  frequency: number | null;
};

export interface BillingProvider {
  readonly id: string;
  readonly label: string;
  configured(): boolean;
  /** Browser checkout settings (public values only). */
  clientConfig(): { environment: "sandbox" | "production"; clientToken: string } | null;
  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean;
  /** null when the payload is not a subscription event the app cares about. */
  parseWebhook(rawBody: string): SubscriptionEvent | null;
  prices(priceIds: string[]): Promise<PriceInfo[]>;
  /** Short-lived link to the provider's customer portal (payment method, invoices, cancel). */
  portalUrl(customerRef: string, subscriptionRef: string | null): Promise<string>;
  changePlan(subscriptionRef: string, priceId: string): Promise<void>;
}
