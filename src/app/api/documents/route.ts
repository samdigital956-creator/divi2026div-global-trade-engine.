import { after, NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, metaFromRequest, tenantFromRequest } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import { jsonError } from "@/lib/http";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads";
import { uploadDocument } from "@/server/documents";

/** Multipart upload: fields `file`, `shipmentId`, `documentTypeId`. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { ctx } = await tenantFromRequest(req);
    await consumeRateLimit(RATE_LIMITS.upload, ctx.userId);

    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
      throw new ValidationError("Files must be 20 MB or smaller.", { file: "Files must be 20 MB or smaller." });
    }
    const form = await req.formData().catch(() => null);
    if (!form) throw new ValidationError("Invalid upload request.");
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Choose a file to upload.", { file: "Choose a file to upload." });
    if (file.size > MAX_UPLOAD_BYTES) throw new ValidationError("Files must be 20 MB or smaller.", { file: "Files must be 20 MB or smaller." });

    const id = await uploadDocument(
      ctx,
      {
        shipmentId: String(form.get("shipmentId") ?? ""),
        documentTypeId: String(form.get("documentTypeId") ?? ""),
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
      metaFromRequest(req),
      { defer: after },
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
