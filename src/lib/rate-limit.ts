import "server-only";
import { systemTx } from "./db";
import { RateLimitedError } from "./errors";

export type RateLimitRule = { name: string; limit: number; windowSeconds: number };

/** Limits applied at the edges where abuse is cheap for an attacker. */
export const RATE_LIMITS = {
  /** Session creation (sign-in) per client IP. Firebase also throttles password attempts. */
  signIn: { name: "signin:ip", limit: 20, windowSeconds: 10 * 60 },
  /** Document uploads per user. */
  upload: { name: "upload:user", limit: 60, windowSeconds: 10 * 60 },
  /** Invitations per organization (each one may send an email). */
  invite: { name: "invite:org", limit: 30, windowSeconds: 60 * 60 },
  /** New container/B-L trackings per organization (each may cost a provider slot). */
  trackingStart: { name: "track:org", limit: 30, windowSeconds: 60 * 60 },
  /** Manual "refresh now" per organization. */
  trackingRefresh: { name: "trackrefresh:org", limit: 120, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter in Postgres, so the limit holds across app instances.
 * Throws RateLimitedError when the caller is over the limit.
 */
export async function consumeRateLimit(rule: RateLimitRule, subject: string | null | undefined, cost = 1) {
  if (process.env.RATE_LIMITS_DISABLED === "true") return;
  const id = (subject || "unknown").slice(0, 200);
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStartSec = nowSec - (nowSec % rule.windowSeconds);
  const count = await systemTx(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO rate_limit_buckets (key, window_start, count) VALUES ($1, to_timestamp($2), $3)
       ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_buckets.count + EXCLUDED.count
       RETURNING count`,
      [`${rule.name}:${id}`, windowStartSec, cost],
    );
    // Opportunistic cleanup of expired windows (~1% of calls).
    if (Math.random() < 0.01) await tx.query(`DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '1 day'`);
    return rows[0].count as number;
  });
  if (count > rule.limit) throw new RateLimitedError(windowStartSec + rule.windowSeconds - nowSec);
}

/**
 * Client IP as reported by the hosting proxy. X-Real-IP is set by the platform
 * edge; X-Forwarded-For can carry client-supplied entries, so it is a fallback.
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for");
  return fwd ? fwd.split(",").pop()!.trim() || null : null;
}
