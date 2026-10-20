import { NextResponse, type NextRequest } from "next/server";
import { billingProvider } from "@/lib/billing/registry";
import { systemTx } from "@/lib/db";
import { applySubscriptionEvent } from "@/server/billing";
import { markWebhookDelivery } from "@/server/tracking";

/**
 * Paddle notifications. Verified against the raw body before parsing, de-duplicated
 * by event id, and applied synchronously so a failure returns 5xx and Paddle retries.
 */
export async function POST(req: NextRequest) {
  const provider = billingProvider();
  if (!provider.configured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 512_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  if (!provider.verifyWebhook(raw, req.headers.get("paddle-signature"))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const event = provider.parseWebhook(raw);
  if (!event) return NextResponse.json({ ok: true, ignored: true });
  if (!(await markWebhookDelivery(provider.id, event.eventId))) return NextResponse.json({ ok: true, duplicate: true });

  try {
    const result = await applySubscriptionEvent(provider.id, event);
    return NextResponse.json({ ok: true, result });
  } catch {
    // Forget the delivery so Paddle's retry is processed.
    await systemTx((tx) => tx.query(`DELETE FROM webhook_deliveries WHERE provider = $1 AND delivery_id = $2`, [provider.id, event.eventId])).catch(() => {});
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
