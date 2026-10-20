import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Traqo webhook signature: header `t=<unix>,v1=<hex>` where v1 is
 * HMAC-SHA256(secret, `${t}.${rawBody}`). Verify the raw bytes before parsing.
 */
export function verifyTraqoSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((s) => s.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/i.test(parts.v1 ?? "")) return false;
  if (Math.abs(Math.floor(now / 1000) - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Constant-time comparison for shared-secret bearer tokens (cron). */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
