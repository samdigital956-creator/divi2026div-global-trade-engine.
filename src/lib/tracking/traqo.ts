import "server-only";
import type { CarrierGuess, ReferenceType, TrackingEvent, TrackingProvider, TrackingSnapshot, TrackOutcome } from "./types";

/**
 * Traqo Ocean (https://traqocontainer.com/developer) — REST, Bearer key.
 * - GET /carriers/lookup   resolve the shipping line, free, no slot
 * - GET /container/:n, /bl/:n   live tracking; a NEW reference costs one plan slot,
 *   re-fetching one already in the account is free (provider docs)
 * Base URL can point at /api/v1/sandbox for development (synthetic data).
 */
const DEFAULT_BASE = "https://traqocontainer.com/api/v1";
const TIMEOUT_MS = 30_000; // live endpoints have a p95 of ~6s per the provider docs

type Json = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Carrier dates come without a zone ("2026-10-24 07:43:04"); keep them as UTC instants, null if unparsable. */
function toIso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseRoute(v: unknown): [number, number][] {
  let arr: unknown = v;
  if (typeof v === "string") {
    try {
      arr = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: [number, number][] = [];
  for (const p of arr) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lat = num(p[0]);
    const lng = num(p[1]);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    out.push([lat, lng]);
    if (out.length >= 2000) break;
  }
  return out;
}

export function mapTraqoShipment(body: Json, type: ReferenceType): TrackingSnapshot {
  const d = (body.data ?? {}) as Json;
  const lat = num(d.latitude);
  const lng = num(d.longitude);
  const vessels = Array.isArray(d.vessels_table) ? (d.vessels_table as Json[]) : [];
  const current = vessels.find((v) => Number(v.is_current) === 1) ?? vessels[vessels.length - 1];
  const events: TrackingEvent[] = (Array.isArray(d.events_table) ? (d.events_table as Json[]) : [])
    .filter((e) => str(e.event_uid) && str(e.description))
    .map((e) => ({
      uid: str(e.event_uid)!,
      description: str(e.description)!.slice(0, 300),
      location: [str(e.location), str(e.country)].filter(Boolean).join(", ") || null,
      occurredAt: toIso(e.timestamp_utc),
      isActual: Number(e.is_actual) === 1,
      vessel: str(e.vessel),
    }));
  return {
    provider: "traqo",
    providerShipmentId: str(d.shipment_uid) ?? str(d.name),
    reference: String(d.reference_number ?? ""),
    referenceType: type,
    sealine: str(d.sealine) ?? str((body.carrier as Json | undefined)?.sealine),
    sealineName: str(d.sealine_name),
    carrierStatus: str(d.status),
    eta: toIso(d.eta),
    ata: toIso(d.ata),
    deliveredAt: toIso(d.closed_at),
    isDelayed: Number(d.is_delayed) === 1 || d.is_delayed === true,
    position: lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null,
    route: parseRoute(d.route_json),
    vessel: current ? { name: str(current.vessel), imo: str(current.imo), mmsi: str(current.mmsi) } : null,
    origin: str(d.origin)?.replace(/,\s*$/, "") ?? null,
    destination: str(d.destination),
    events,
    lastSyncedAt: toIso(d.last_synced_at ?? d.last_updated_at),
    nextRefreshAt: toIso(d.next_refresh_eligible_at),
    synthetic: body.mode === "sandbox" || body.source === "synthetic",
  };
}

export class TraqoProvider implements TrackingProvider {
  readonly id = "traqo";
  readonly label = "Traqo";

  constructor(
    private readonly apiKey = process.env.TRAQO_API_KEY,
    private readonly baseUrl = process.env.TRAQO_BASE_URL || DEFAULT_BASE,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  configured() {
    return !!this.apiKey;
  }

  private async get(path: string): Promise<{ status: number; body: Json }> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    return { status: res.status, body };
  }

  async lookupCarrier(reference: string, type: ReferenceType): Promise<CarrierGuess> {
    const { status, body } = await this.get(`/carriers/lookup?number=${encodeURIComponent(reference)}&type=${type}`);
    if (status !== 200) return null;
    const c = ((body.data as Json | undefined)?.carrier ?? null) as Json | null;
    return c && str(c.scac) ? { scac: str(c.scac)!, name: str(c.name) ?? str(c.scac)!, confidence: str(c.confidence) ?? "unknown" } : null;
  }

  async track(reference: string, type: ReferenceType, sealine: string | null): Promise<TrackOutcome> {
    const path = `/${type === "bl" ? "bl" : "container"}/${encodeURIComponent(reference)}${sealine ? `?sealine=${sealine}` : ""}`;
    let status: number, body: Json;
    try {
      ({ status, body } = await this.get(path));
    } catch {
      return { status: "error", message: "The tracking provider did not respond in time.", retryable: true };
    }
    if (status === 200 && body.success !== false) return { status: "ok", snapshot: mapTraqoShipment(body, type) };
    const data = (body.data ?? {}) as Json;
    if (status === 404) {
      return {
        status: "not_found",
        message:
          data.discovery === "queued"
            ? "The provider is still looking for this reference with other carriers. Check again later."
            : "The carrier has no tracking for this reference yet. Check the number and shipping line.",
      };
    }
    if (status === 402) return { status: "limit_reached", message: "The tracking plan's shipment allowance is used up." };
    if (status === 401 || status === 403) return { status: "error", message: "The tracking provider rejected the API key or developer mode is off.", retryable: false };
    if (status === 400) return { status: "error", message: str(body.message) ?? "The reference was rejected by the provider.", retryable: false };
    if (status === 429) return { status: "error", message: "Tracking provider rate limit reached. Try again shortly.", retryable: true };
    return { status: "error", message: "The carrier's system is not responding. Try again later.", retryable: true };
  }

  /** Re-fetching a reference already in the account is free on Traqo, so refresh reuses /container and /bl. */
  refresh(reference: string, type: ReferenceType): Promise<TrackOutcome> {
    return this.track(reference, type, null);
  }
}
