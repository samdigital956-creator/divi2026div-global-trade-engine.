/**
 * Subscription billing (provider to be selected). The app stores plan limits
 * and a provider customer reference; prices and invoices stay in the provider.
 */
export type CheckoutRequest = { orgId: string; planKey: string; successUrl: string; cancelUrl: string };

export interface BillingProvider {
  readonly id: string;
  createCheckout(req: CheckoutRequest): Promise<{ url: string }>;
  createPortalSession(customerRef: string, returnUrl: string): Promise<{ url: string }>;
  /** Verify signature, return normalised subscription state changes. */
  parseWebhook(headers: Headers, rawBody: string): Promise<
    { orgId: string; planKey: string; status: "trialing" | "active" | "past_due" | "canceled"; customerRef: string }[]
  >;
}
