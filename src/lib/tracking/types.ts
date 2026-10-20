/**
 * Provider-neutral container tracking. Every provider adapter (Traqo today;
 * Vizion, SeaRates, Terminal49 or a carrier's own DCSA API later) maps its
 * responses into these shapes, so the rest of the app never sees vendor JSON.
 *
 * Adapters must never invent data: unknown values are null, and an event is
 * only reported if the provider returned it.
 */

export type ReferenceType = "container" | "bl";

export type TrackingEvent = {
  /** Stable id from the provider, used to de-duplicate across refreshes. */
  uid: string;
  description: string;
  location: string | null;
  occurredAt: string | null; // ISO-8601 UTC, null when the provider has no reliable time
  isActual: boolean; // false = planned / estimated
  vessel: string | null;
};

export type TrackingSnapshot = {
  provider: string;
  providerShipmentId: string | null;
  reference: string;
  referenceType: ReferenceType;
  sealine: string | null;
  sealineName: string | null;
  carrierStatus: string | null; // provider status verbatim, e.g. IN_TRANSIT
  eta: string | null; // ISO-8601
  ata: string | null; // vessel arrival at final port of discharge
  deliveredAt: string | null; // verified delivery to consignee
  isDelayed: boolean;
  position: { lat: number; lng: number } | null;
  route: [number, number][];
  vessel: { name: string | null; imo: string | null; mmsi: string | null } | null;
  origin: string | null;
  destination: string | null;
  events: TrackingEvent[];
  lastSyncedAt: string | null;
  nextRefreshAt: string | null;
  /** True for provider demo/sandbox data — never shown to customers. */
  synthetic: boolean;
};

export type TrackOutcome =
  | { status: "ok"; snapshot: TrackingSnapshot }
  | { status: "not_found"; message: string }
  | { status: "limit_reached"; message: string }
  | { status: "error"; message: string; retryable: boolean };

export type CarrierGuess = { scac: string; name: string; confidence: string } | null;

export interface TrackingProvider {
  readonly id: string;
  readonly label: string;
  configured(): boolean;
  /** Resolve the shipping line for a reference without starting to track it (free where supported). */
  lookupCarrier(reference: string, type: ReferenceType): Promise<CarrierGuess>;
  /** Start (or refresh) tracking. May consume a provider slot for new references. */
  track(reference: string, type: ReferenceType, sealine: string | null): Promise<TrackOutcome>;
  /** Read the provider's stored copy — cheap, no new slot. */
  refresh(reference: string, type: ReferenceType): Promise<TrackOutcome>;
}

/** Providers the platform is designed to support. Only those with an adapter can be enabled. */
export const KNOWN_TRACKING_PROVIDERS = [
  { id: "traqo", label: "Traqo", coverage: "170+ shipping lines (provider's figure)", env: "TRAQO_API_KEY", adapter: true },
  { id: "vizion", label: "Vizion", coverage: "60+ ocean carriers (provider's figure)", env: "VIZION_API_KEY", adapter: false },
  { id: "searates", label: "SeaRates", coverage: "220 shipping lines (provider's figure)", env: "SEARATES_API_KEY", adapter: false },
  { id: "terminal49", label: "Terminal49", coverage: "Major ocean carriers + US terminals", env: "TERMINAL49_API_KEY", adapter: false },
  { id: "maersk", label: "Maersk (direct, DCSA)", coverage: "Maersk shipments of Maersk customers", env: "MAERSK_API_KEY", adapter: false },
] as const;
