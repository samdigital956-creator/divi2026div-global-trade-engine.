import { NextResponse, type NextRequest } from "next/server";
import { storage } from "@/lib/storage";
import { contentDisposition } from "@/lib/storage/disposition";
import { LocalStorageDriver } from "@/lib/storage/local";

/** Serves local-driver files for valid, unexpired signed tokens only. */
export async function GET(req: NextRequest) {
  const store = storage();
  if (!(store instanceof LocalStorageDriver)) return new NextResponse("Not found", { status: 404 });
  const payload = store.verify(req.nextUrl.searchParams.get("t") ?? "");
  if (!payload) return new NextResponse("Link expired or invalid", { status: 403 });
  try {
    const body = await store.read(payload.k);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": payload.c,
        "Content-Disposition": contentDisposition(payload.f, payload.i),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
