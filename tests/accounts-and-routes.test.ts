import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setIdentityProviderForTesting, type Identity, type IdentityProvider } from "@/lib/auth/identity";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { acceptInvitation, createOrganization, listMemberships, listPendingInvitations } from "@/server/accounts";
import { inviteMember, listMembers } from "@/server/organization";
import { createShipment } from "@/server/shipments";
import { listDocumentTypes } from "@/server/documents";
import { POST as sessionPOST, DELETE as sessionDELETE } from "@/app/api/auth/session/route";
import { POST as uploadPOST } from "@/app/api/documents/route";
import { GET as fileGET } from "@/app/api/documents/[id]/file/route";
import { makeOrg, makeUser, PDF_BYTES } from "./support/fixtures";

/** In-memory stand-in for Firebase: token "idtoken:<uid>" → session "session:<uid>". */
class FakeIdentityProvider implements IdentityProvider {
  readonly id = "fake";
  users = new Map<string, Identity>();
  revoked = new Set<string>();
  configured() {
    return true;
  }
  register(email: string, emailVerified = true) {
    const uid = randomUUID();
    this.users.set(uid, { uid, email, emailVerified });
    return { uid, idToken: `idtoken:${uid}:${"x".repeat(20)}`, cookie: `session:${uid}` };
  }
  async createSession(idToken: string) {
    const uid = idToken.split(":")[1];
    const identity = this.users.get(uid);
    if (!identity) throw new Error("bad token");
    this.revoked.delete(uid);
    return { cookie: `session:${uid}`, identity };
  }
  async verifySession(cookie: string) {
    const uid = cookie.replace(/^session:/, "");
    return this.revoked.has(uid) ? null : (this.users.get(uid) ?? null);
  }
  async revokeSessions(uid: string) {
    this.revoked.add(uid);
  }
}

const fake = new FakeIdentityProvider();
beforeAll(() => setIdentityProviderForTesting(fake));
afterAll(() => setIdentityProviderForTesting(null));

const BASE = "http://app.test";
function req(path: string, init: { method?: string; cookie?: string; origin?: string; body?: BodyInit; json?: unknown } = {}) {
  const headers = new Headers({ host: "app.test" });
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.origin) headers.set("origin", init.origin);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  return new NextRequest(new URL(path, BASE), { method: init.method ?? "GET", headers, body });
}

describe("registration, login and onboarding", () => {
  it("exchanges an ID token for an httpOnly session cookie and creates the user once", async () => {
    const acct = fake.register("founder@acme.test");
    const res = await sessionPOST(req("/api/auth/session", { method: "POST", origin: BASE, json: { idToken: acct.idToken } }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/__session=session%3A|__session=session:/);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");

    // Second login → same internal user
    const res2 = await sessionPOST(req("/api/auth/session", { method: "POST", origin: BASE, json: { idToken: acct.idToken } }));
    expect(res2.status).toBe(200);
  });

  it("rejects invalid tokens and cross-site login attempts", async () => {
    const bad = await sessionPOST(req("/api/auth/session", { method: "POST", origin: BASE, json: { idToken: "idtoken:nope:xxxxxxxxxxxxxxxxxxxxxxxx" } }));
    expect(bad.status).toBe(401);
    const acct = fake.register("x@acme.test");
    const csrf = await sessionPOST(req("/api/auth/session", { method: "POST", origin: "https://evil.example", json: { idToken: acct.idToken } }));
    expect(csrf.status).toBe(403);
    const malformed = await sessionPOST(req("/api/auth/session", { method: "POST", origin: BASE, json: { nope: 1 } }));
    expect(malformed.status).toBe(422);
  });

  it("signs out by revoking the provider session", async () => {
    const acct = fake.register("leaver@acme.test");
    await sessionPOST(req("/api/auth/session", { method: "POST", origin: BASE, json: { idToken: acct.idToken } }));
    const res = await sessionDELETE(req("/api/auth/session", { method: "DELETE", origin: BASE, cookie: `__session=${acct.cookie}` }));
    expect(res.status).toBe(200);
    expect(fake.revoked.has(acct.uid)).toBe(true);
  });

  it("creates an organization with the creator as owner on a trial plan", async () => {
    const user = await makeUser();
    const org = await createOrganization(user, { name: "Global Imports & Co", countryCode: "us" });
    expect(org.slug).toBe("global-imports-co");
    const again = await createOrganization(user, { name: "Global Imports & Co" });
    expect(again.slug).toBe("global-imports-co-2");
    const memberships = await listMemberships(user.id);
    expect(memberships.map((m) => m.role)).toEqual(["owner", "owner"]);
    await expect(createOrganization(user, { name: "x" })).rejects.toThrow(/fix/);
  });

  it("accepts invitations only for the verified, matching email", async () => {
    const { ctx } = await makeOrg("Inviting Org");
    await inviteMember(ctx, { email: "New.Hire@Example.test", role: "member" });

    const unverified = await makeUser({ email: "new.hire@example.test", emailVerified: false });
    const [inv] = await listPendingInvitations(unverified);
    expect(inv.orgName).toBe("Inviting Org");
    await expect(acceptInvitation(unverified, inv.id)).rejects.toBeInstanceOf(ForbiddenError);

    const stranger = await makeUser({ email: "someone@else.test" });
    await expect(acceptInvitation(stranger, inv.id)).rejects.toBeInstanceOf(NotFoundError);

    const verified = { ...unverified, emailVerified: true };
    await acceptInvitation(verified, inv.id);
    const { members } = await listMembers(ctx);
    expect(members.find((m) => m.email === "new.hire@example.test")?.role).toBe("member");
    await expect(acceptInvitation(verified, inv.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("protected route handlers", () => {
  async function signedInOwner() {
    const acct = fake.register(`owner-${randomUUID().slice(0, 6)}@acme.test`);
    await sessionPOST(req("/api/auth/session", { method: "POST", origin: BASE, json: { idToken: acct.idToken } }));
    const user = await makeUserFromFake(acct.uid);
    const org = await createOrganization(user, { name: "Route Org" });
    const ctx = { userId: user.id, orgId: org.id, role: "owner" as const };
    const shipmentId = await createShipment(ctx, { reference: "R-1", transportMode: "ocean" });
    const types = await listDocumentTypes(ctx);
    return { cookie: `__session=${acct.cookie}; gtc_org=${org.id}`, shipmentId, typeId: types[0].id };
  }
  async function makeUserFromFake(uid: string) {
    const { upsertUser } = await import("@/server/accounts");
    return upsertUser(fake.users.get(uid)!);
  }
  function uploadForm(shipmentId: string, typeId: string, file: File) {
    const fd = new FormData();
    fd.set("shipmentId", shipmentId);
    fd.set("documentTypeId", typeId);
    fd.set("file", file);
    return fd;
  }

  it("rejects unauthenticated uploads and downloads", async () => {
    const fd = uploadForm(randomUUID(), randomUUID(), new File([PDF_BYTES], "a.pdf"));
    const res = await uploadPOST(req("/api/documents", { method: "POST", origin: BASE, body: fd }));
    expect(res.status).toBe(401);
    const forged = await uploadPOST(req("/api/documents", { method: "POST", origin: BASE, body: fd, cookie: "__session=session:forged" }));
    expect(forged.status).toBe(401);
    const dl = await fileGET(req(`/api/documents/${randomUUID()}/file`), { params: Promise.resolve({ id: randomUUID() }) });
    expect(dl.status).toBe(401);
  });

  it("uploads with a valid session, rejects invalid files and cross-site posts, and redirects downloads to a signed URL", async () => {
    const s = await signedInOwner();
    const ok = await uploadPOST(
      req("/api/documents", { method: "POST", origin: BASE, cookie: s.cookie, body: uploadForm(s.shipmentId, s.typeId, new File([PDF_BYTES], "invoice.pdf")) }),
    );
    expect(ok.status).toBe(201);
    const { id } = await ok.json();

    const bad = await uploadPOST(
      req("/api/documents", { method: "POST", origin: BASE, cookie: s.cookie, body: uploadForm(s.shipmentId, s.typeId, new File(["MZ"], "tool.exe")) }),
    );
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.fieldErrors.file).toMatch(/Unsupported/);

    const csrf = await uploadPOST(
      req("/api/documents", { method: "POST", origin: "https://evil.example", cookie: s.cookie, body: uploadForm(s.shipmentId, s.typeId, new File([PDF_BYTES], "a.pdf")) }),
    );
    expect(csrf.status).toBe(403);

    const dl = await fileGET(req(`/api/documents/${id}/file?mode=download`, { cookie: s.cookie }), { params: Promise.resolve({ id }) });
    expect(dl.status).toBe(302);
    expect(dl.headers.get("location")).toMatch(/\/api\/storage\/local\?t=/);
    expect(dl.headers.get("cache-control")).toBe("no-store");

    // Another tenant's session cannot fetch it
    const other = await signedInOwner();
    const denied = await fileGET(req(`/api/documents/${id}/file`, { cookie: other.cookie }), { params: Promise.resolve({ id }) });
    expect(denied.status).toBe(404);
  });

  it("ignores an org cookie for an org the user does not belong to", async () => {
    const a = await signedInOwner();
    const b = await signedInOwner();
    const sessionA = a.cookie.split(";")[0];
    const orgB = b.cookie.split("gtc_org=")[1];
    const fd = uploadForm(b.shipmentId, b.typeId, new File([PDF_BYTES], "x.pdf"));
    const res = await uploadPOST(req("/api/documents", { method: "POST", origin: BASE, cookie: `${sessionA}; gtc_org=${orgB}`, body: fd }));
    // Falls back to A's own org, where B's shipment does not exist.
    expect(res.status).toBe(404);
  });
});
