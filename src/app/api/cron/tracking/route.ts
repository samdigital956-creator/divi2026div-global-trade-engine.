import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/tracking/webhook";
import { syncDueTrackings } from "@/server/tracking";

/** Scheduled refresh of stale trackings. Call with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await syncDueTrackings(50);
  return NextResponse.json({ ok: true, ...result });
}
