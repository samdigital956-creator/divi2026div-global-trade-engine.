import { NextResponse, type NextRequest } from "next/server";
import { metaFromRequest, tenantFromRequest } from "@/lib/auth/session";
import { jsonError } from "@/lib/http";
import { documentAccessUrl } from "@/server/documents";

/** Authorise, audit, then redirect to a 60-second signed URL. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { ctx } = await tenantFromRequest(req);
    const mode = req.nextUrl.searchParams.get("mode") === "view" ? "view" : "download";
    const url = await documentAccessUrl(ctx, id, mode, metaFromRequest(req));
    const res = NextResponse.redirect(new URL(url, req.nextUrl.origin), 302);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
