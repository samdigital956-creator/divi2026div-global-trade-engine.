import net from "node:net";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setEmailSenderForTesting, type EmailMessage, type EmailSender } from "@/lib/email";
import { AppError, RateLimitedError, ValidationError } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/rate-limit";
import { ClamAvScanner, setFileScannerForTesting } from "@/lib/scanning";
import { POST as sessionPOST } from "@/app/api/auth/session/route";
import { getDocument, listDocumentTypes, uploadDocument } from "@/server/documents";
import { inviteMember, listAuditLogs, listMembers, resendInvitationEmail } from "@/server/organization";
import { createShipment, listShipments } from "@/server/shipments";
import { makeOrg, PDF_BYTES } from "./support/fixtures";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** Minimal clamd speaking the INSTREAM protocol; flags the EICAR test string. */
function fakeClamd(): Promise<{ port: number; close: () => void; scans: number }> {
  return new Promise((resolve) => {
    const state = { scans: 0 };
    const server = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        const cmd = Buffer.from("zINSTREAM\0");
        if (buf.length < cmd.length) return;
        let off = cmd.length;
        const parts: Buffer[] = [];
        while (buf.length >= off + 4) {
          const len = buf.readUInt32BE(off);
          if (len === 0) {
            state.scans++;
            const content = Buffer.concat(parts).toString("latin1");
            sock.end(content.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE") ? "stream: Eicar-Signature FOUND\0" : "stream: OK\0");
            return;
          }
          if (buf.length < off + 4 + len) return;
          parts.push(buf.subarray(off + 4, off + 4 + len));
          off += 4 + len;
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, close: () => server.close(), get scans() { return state.scans; } });
    });
  });
}

describe("rate limiting", () => {
  it("allows up to the limit within a window, then rejects with retry-after", async () => {
    const rule = { name: `test:${Date.now()}`, limit: 3, windowSeconds: 60 };
    for (let i = 0; i < 3; i++) await consumeRateLimit(rule, "subject-a");
    const err = await consumeRateLimit(rule, "subject-a").catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    await expect(consumeRateLimit(rule, "subject-b")).resolves.toBeUndefined(); // separate subject
  });

  it("returns 429 with Retry-After from the sign-in endpoint", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 21; i++) {
      last = await sessionPOST(
        new NextRequest("http://app.test/api/auth/session", {
          method: "POST",
          headers: { host: "app.test", origin: "http://app.test", "content-type": "application/json", "x-real-ip": "203.0.113.77" },
          body: JSON.stringify({ idToken: "x".repeat(30) }),
        }),
      );
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("malware scanning", () => {
  let clamd: Awaited<ReturnType<typeof fakeClamd>>;
  beforeAll(async () => {
    clamd = await fakeClamd();
  });
  afterAll(() => clamd.close());
  afterEach(() => setFileScannerForTesting(undefined));

  it("ClamAV adapter streams the file and parses clean / infected replies", async () => {
    const scanner = new ClamAvScanner("127.0.0.1", clamd.port);
    await expect(scanner.scan(PDF_BYTES)).resolves.toEqual({ clean: true, engine: "clamav" });
    const big = new Uint8Array(200_000).fill(65); // spans several INSTREAM chunks
    big.set(new TextEncoder().encode(EICAR), 150_000);
    await expect(scanner.scan(big)).resolves.toEqual({ clean: false, engine: "clamav", signature: "Eicar-Signature" });
  });

  async function setup() {
    const o = await makeOrg();
    const sid = await createShipment(o.ctx, { reference: `S-${Date.now()}`, transportMode: "ocean" });
    const type = (await listDocumentTypes(o.ctx)).find((t) => t.key === "other")!;
    return { ...o, sid, typeId: type.id };
  }

  it("stores clean files with their scan result", async () => {
    setFileScannerForTesting(new ClamAvScanner("127.0.0.1", clamd.port));
    const { ctx, sid, typeId } = await setup();
    const id = await uploadDocument(ctx, { shipmentId: sid, documentTypeId: typeId, filename: "ok.pdf", bytes: PDF_BYTES });
    expect(await getDocument(ctx, id)).toMatchObject({ scanStatus: "clean", scanEngine: "clamav" });
  });

  it("rejects infected files, stores nothing and audits the rejection", async () => {
    setFileScannerForTesting(new ClamAvScanner("127.0.0.1", clamd.port));
    const { ctx, sid, typeId } = await setup();
    const infected = new TextEncoder().encode(`%PDF-1.4\n${EICAR}\n%%EOF`);
    const err = await uploadDocument(ctx, { shipmentId: sid, documentTypeId: typeId, filename: "bad.pdf", bytes: infected }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fieldErrors.file).toMatch(/virus scanner/);
    expect((await listShipments(ctx)).items[0].documentCount).toBe(0);
    const logs = await listAuditLogs(ctx, { action: "upload.rejected" });
    expect(logs.items[0].metadata).toMatchObject({ reason: "malware", signature: "Eicar-Signature" });
  });

  it("fails closed when a configured scanner is unreachable", async () => {
    setFileScannerForTesting(new ClamAvScanner("127.0.0.1", 1, 2000));
    const { ctx, sid, typeId } = await setup();
    const err = await uploadDocument(ctx, { shipmentId: sid, documentTypeId: typeId, filename: "x.pdf", bytes: PDF_BYTES }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(503);
  });

  it("marks files as not scanned when no scanner is configured", async () => {
    setFileScannerForTesting(null);
    const { ctx, sid, typeId } = await setup();
    const id = await uploadDocument(ctx, { shipmentId: sid, documentTypeId: typeId, filename: "x.pdf", bytes: PDF_BYTES });
    expect((await getDocument(ctx, id)).scanStatus).toBe("not_scanned");
  });
});

describe("invitation emails", () => {
  const sent: EmailMessage[] = [];
  let fail = false;
  const fake: EmailSender = {
    id: "fake",
    configured: () => true,
    send: async (m) => {
      if (fail) throw new Error("provider down");
      sent.push(m);
      return { providerId: `msg-${sent.length}` };
    },
  };
  const prevUrl = process.env.APP_URL;
  beforeAll(() => {
    process.env.APP_URL = "https://app.example.test/";
    setEmailSenderForTesting(fake);
  });
  afterAll(() => {
    process.env.APP_URL = prevUrl;
    setEmailSenderForTesting(null);
  });

  it("emails the invitee with sign-up instructions and records it", async () => {
    const { ctx } = await makeOrg("Email Org");
    const r = await inviteMember(ctx, { email: "Invitee@Example.test", role: "viewer" });
    expect(r.emailStatus).toBe("sent");
    const m = sent.at(-1)!;
    expect(m.to).toBe("invitee@example.test");
    expect(m.subject).toBe("You're invited to join Email Org");
    expect(m.text).toContain("https://app.example.test/register");
    expect(m.html).not.toContain("<script");
    const { invitations } = await listMembers(ctx);
    expect(invitations[0]).toMatchObject({ email: "invitee@example.test", emailStatus: "sent" });
  });

  it("escapes organization names in the HTML body", async () => {
    const { ctx } = await makeOrg(`<img src=x onerror=alert(1)> Co`);
    await inviteMember(ctx, { email: "x@example.test", role: "member" });
    expect(sent.at(-1)!.html).toContain("&lt;img src=x onerror=alert(1)&gt; Co");
  });

  it("records failures and can resend", async () => {
    const { ctx } = await makeOrg();
    fail = true;
    expect((await inviteMember(ctx, { email: "late@example.test", role: "member" })).emailStatus).toBe("failed");
    const inv = (await listMembers(ctx)).invitations[0];
    expect(inv.emailStatus).toBe("failed");
    fail = false;
    expect(await resendInvitationEmail(ctx, inv.id)).toBe("sent");
    expect((await listMembers(ctx)).invitations[0].emailStatus).toBe("sent");
  });

  it("creates the invitation without email when sending is not configured", async () => {
    setEmailSenderForTesting({ ...fake, configured: () => false });
    const { ctx } = await makeOrg();
    expect((await inviteMember(ctx, { email: "n@example.test", role: "member" })).emailStatus).toBe("not_configured");
    setEmailSenderForTesting(fake);
  });
});
