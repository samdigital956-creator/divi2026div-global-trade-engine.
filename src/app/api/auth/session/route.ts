import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { identityProvider } from "@/lib/auth/identity";
import { assertSameOrigin, ORG_COOKIE, SESSION_COOKIE, SESSION_TTL_MS, userFromSessionCookie } from "@/lib/auth/session";
import { AppError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { jsonError } from "@/lib/http";
import { clientIp, consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { upsertUser } from "@/server/accounts";

const bodySchema = z.object({ idToken: z.string().min(20).max(8192) });

/** Exchange a fresh Firebase ID token for an httpOnly session cookie. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await consumeRateLimit(RATE_LIMITS.signIn, clientIp(req.headers));
    const provider = await identityProvider();
    if (!provider.configured()) throw new AppError("Authentication is not configured on the server.", 503, "auth_not_configured");
    const body = bodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new ValidationError("Invalid sign-in request.");

    let session;
    try {
      session = await provider.createSession(body.data.idToken, SESSION_TTL_MS);
    } catch {
      throw new UnauthorizedError("Sign-in failed or expired. Please sign in again.");
    }
    const user = await upsertUser(session.identity, true);

    const res = NextResponse.json({ ok: true, user: { email: user.email, emailVerified: user.emailVerified } });
    res.cookies.set(SESSION_COOKIE, session.cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    return res;
  } catch (err) {
    return jsonError(err);
  }
}

/** Sign out: clear cookies and revoke the user's Firebase sessions. */
export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const value = req.cookies.get(SESSION_COOKIE)?.value;
    if (value) {
      const provider = await identityProvider();
      const identity = provider.configured() ? await provider.verifySession(value) : null;
      if (identity) await provider.revokeSessions(identity.uid).catch(() => {});
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(ORG_COOKIE);
    return res;
  } catch (err) {
    return jsonError(err);
  }
}

export async function GET(req: NextRequest) {
  const user = await userFromSessionCookie(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  return NextResponse.json({ authenticated: !!user }, { headers: { "Cache-Control": "no-store" } });
}
