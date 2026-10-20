import "server-only";
import { NextResponse } from "next/server";
import { publicError, RateLimitedError } from "./errors";

export function jsonError(err: unknown) {
  const e = publicError(err);
  return NextResponse.json(
    { error: { code: e.code, message: e.message, fieldErrors: e.fieldErrors } },
    {
      status: e.status,
      headers: {
        "Cache-Control": "no-store",
        ...(err instanceof RateLimitedError ? { "Retry-After": String(err.retryAfterSeconds) } : {}),
      },
    },
  );
}
