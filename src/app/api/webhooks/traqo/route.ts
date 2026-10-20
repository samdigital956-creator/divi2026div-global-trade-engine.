import { after, NextResponse, type NextRequest } from "next/server";
import { verifyTraqoSignature } from "@/lib/tracking/webhook";
import { markWebhookDelivery, syncReference } from "@/server/tracking";

const EVENTS = new Set(["shipment.updated", "shipment.vessel_arrived", "shipment.arrived", "eta.changed", "discovery.recovered"]);

/**
 * Traqo push: verify the signature, acknowledge fast, then re-read the
 * shipment from the provider. The payload is only a hint; stored data always
 * comes from the provider's API so a forged-but-signed body cannot inject events.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.TRAQO_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  if (!verifyTraqoSignature(raw, req.headers.get("x-traqo-signature"), secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: { event?: unknown; data?: { reference_number?: unknown } };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const event = String(body.event ?? req.headers.get("x-traqo-event") ?? "");
  const reference = typeof body.data?.reference_number === "string" ? body.data.reference_number.trim().toUpperCase() : "";
  const delivery = req.headers.get("x-traqo-delivery");

  if (!EVENTS.has(event) || !/^[A-Z0-9./-]{3,50}$/.test(reference)) return NextResponse.json({ ok: true, ignored: true });
  if (delivery && !(await markWebhookDelivery("traqo", delivery))) return NextResponse.json({ ok: true, duplicate: true });

  after(() => syncReference("traqo", reference).catch(() => {}));
  return NextResponse.json({ ok: true });
}
