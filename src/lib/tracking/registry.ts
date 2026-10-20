import "server-only";
import { TraqoProvider } from "./traqo";
import type { TrackingProvider } from "./types";

const adapters: TrackingProvider[] = [new TraqoProvider()];

let override: TrackingProvider[] | null = null;
export function setTrackingProvidersForTesting(p: TrackingProvider[] | null) {
  override = p;
}

/** Configured providers in priority order (TRACKING_PROVIDERS="traqo,vizion" to reorder). */
export function trackingProviders(): TrackingProvider[] {
  const list = (override ?? adapters).filter((p) => p.configured());
  const order = (process.env.TRACKING_PROVIDERS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return order.length ? [...list].sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99)) : list;
}

export function trackingProvider(id: string): TrackingProvider | null {
  return trackingProviders().find((p) => p.id === id) ?? null;
}

export function trackingConfigured() {
  return trackingProviders().length > 0;
}
