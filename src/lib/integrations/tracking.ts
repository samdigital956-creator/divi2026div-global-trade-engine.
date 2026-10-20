/**
 * Ocean container tracking (planned: Vizion, SeaRates).
 * Interface only — no adapter is implemented in Phase 1, and the app never
 * displays tracking events that did not come from a real provider response.
 */
export type ContainerRef = { containerNumber: string; carrierScac?: string; billOfLading?: string };

export type TrackingSubscription = { provider: string; externalId: string };

export type TrackingEvent = {
  provider: string;
  externalEventId: string;
  eventCode: string; // provider code, kept verbatim
  description: string;
  location?: string;
  occurredAt: string; // ISO-8601 as reported
  isActual: boolean; // false = estimated/planned
};

export interface ContainerTrackingProvider {
  readonly id: "vizion" | "searates" | string;
  /** Register a container for updates; providers typically push via webhook. */
  subscribe(ref: ContainerRef, callbackUrl: string): Promise<TrackingSubscription>;
  unsubscribe(sub: TrackingSubscription): Promise<void>;
  /** Verify the signature and normalise a webhook payload. Throws if invalid. */
  parseWebhook(headers: Headers, rawBody: string): Promise<TrackingEvent[]>;
}
