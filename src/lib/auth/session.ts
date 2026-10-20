import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { RequestMeta } from "@/lib/audit";
import type { TenantContext } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { listMemberships, upsertUser, type AppUser, type MembershipSummary } from "@/server/accounts";
import { identityProvider } from "./identity";

export const SESSION_COOKIE = "__session";
export const ORG_COOKIE = "gtc_org";
export const SESSION_TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days (Firebase allows up to 14)

export type TenantSession = {
  user: AppUser;
  ctx: TenantContext;
  org: MembershipSummary;
  memberships: MembershipSummary[];
};

/** Verify a session cookie value and map it to the internal user. */
export async function userFromSessionCookie(value: string | undefined): Promise<AppUser | null> {
  if (!value) return null;
  const provider = await identityProvider();
  if (!provider.configured()) return null;
  const identity = await provider.verifySession(value);
  if (!identity) return null;
  return upsertUser(identity);
}

/** Pick the active organization: the cookie's org if the user belongs to it, else their first. */
export async function resolveTenant(user: AppUser, orgCookie: string | undefined): Promise<Omit<TenantSession, "user"> | null> {
  const memberships = await listMemberships(user.id);
  if (memberships.length === 0) return null;
  const org = memberships.find((m) => m.orgId === orgCookie) ?? memberships[0];
  return { org, memberships, ctx: { userId: user.id, orgId: org.orgId, role: org.role } };
}

// --- Server Components / Server Actions -----------------------------------

export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const jar = await cookies();
  return userFromSessionCookie(jar.get(SESSION_COOKIE)?.value);
});

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export const getTenantSession = cache(async (): Promise<TenantSession | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const jar = await cookies();
  const t = await resolveTenant(user, jar.get(ORG_COOKIE)?.value);
  return t ? { user, ...t } : null;
});

/** For pages: redirect to login/onboarding when there is no tenant. */
export async function requireTenant(): Promise<TenantSession> {
  const user = await requireUser();
  const t = await getTenantSession();
  if (!t) redirect("/onboarding");
  return { ...t, user };
}

/** For Server Actions: throw instead of redirecting, so the form can show a message. */
export async function tenantForAction(): Promise<TenantSession> {
  const t = await getTenantSession();
  if (!t) throw new UnauthorizedError();
  return t;
}

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return { ip: h.get("x-forwarded-for") ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
}

// --- Route handlers -------------------------------------------------------

export async function tenantFromRequest(req: Request & { cookies?: { get(name: string): { value: string } | undefined } }) {
  const get = (name: string) =>
    req.cookies?.get(name)?.value ??
    parseCookieHeader(req.headers.get("cookie"))[name];
  const user = await userFromSessionCookie(get(SESSION_COOKIE));
  if (!user) throw new UnauthorizedError();
  const t = await resolveTenant(user, get(ORG_COOKIE));
  if (!t) throw new UnauthorizedError("Create or join an organization first.");
  return { user, ...t };
}

export function metaFromRequest(req: Request): RequestMeta {
  return { ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"), userAgent: req.headers.get("user-agent") };
}

function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Reject cross-site state-changing requests to route handlers. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients; cookies are SameSite=Lax anyway
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Invalid request origin.");
  }
  if (!host || originHost !== host) throw new ForbiddenError("Invalid request origin.");
}
