import "server-only";

export type EmailMessage = { to: string; subject: string; text: string; html: string; idempotencyKey?: string };
export type SendResult = { status: "sent"; providerId: string | null } | { status: "not_configured" } | { status: "failed"; error: string };

export interface EmailSender {
  readonly id: string;
  configured(): boolean;
  send(msg: EmailMessage): Promise<{ providerId: string | null }>;
}

/** Resend (https://resend.com) — POST /emails with a Bearer API key. */
export class ResendSender implements EmailSender {
  readonly id = "resend";
  constructor(
    private readonly apiKey = process.env.RESEND_API_KEY,
    private readonly from = process.env.EMAIL_FROM,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  configured() {
    return !!this.apiKey && !!this.from;
  }

  async send(msg: EmailMessage) {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) throw new Error(`Resend responded with HTTP ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { providerId: body.id ?? null };
  }
}

let override: EmailSender | null = null;
export function setEmailSenderForTesting(s: EmailSender | null) {
  override = s;
}

export function emailSender(): EmailSender {
  return override ?? new ResendSender();
}

/** Send without throwing; callers record the outcome. */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const sender = emailSender();
  if (!sender.configured()) return { status: "not_configured" };
  try {
    const { providerId } = await sender.send(msg);
    return { status: "sent", providerId };
  } catch (err) {
    console.error("[email] send failed:", err instanceof Error ? err.message : "unknown");
    return { status: "failed", error: err instanceof Error ? err.message : "unknown" };
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function invitationEmail(opts: { orgName: string; inviterName: string; role: string; appUrl: string; email: string }): Omit<EmailMessage, "to"> {
  const signUp = `${opts.appUrl}/register`;
  const signIn = `${opts.appUrl}/login?next=/onboarding`;
  const text = [
    `${opts.inviterName} invited you to join ${opts.orgName} on Global Trade & Customs AI Engine as ${opts.role}.`,
    "",
    `1. Create an account with this email address (${opts.email}): ${signUp}`,
    `   Already have one? Sign in: ${signIn}`,
    "2. Verify your email address using the link we send you.",
    "3. Accept the invitation on the onboarding page.",
    "",
    "The invitation expires in 14 days. If you weren't expecting it, you can ignore this email.",
  ].join("\n");
  const e = escapeHtml;
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#0d1628;line-height:1.5">
<p><strong>${e(opts.inviterName)}</strong> invited you to join <strong>${e(opts.orgName)}</strong> on Global Trade &amp; Customs AI Engine as <strong>${e(opts.role)}</strong>.</p>
<ol>
<li><a href="${e(signUp)}">Create an account</a> with this email address (${e(opts.email)}), or <a href="${e(signIn)}">sign in</a> if you already have one.</li>
<li>Verify your email address using the link we send you.</li>
<li>Accept the invitation on the onboarding page.</li>
</ol>
<p style="color:#5b6a86;font-size:13px">The invitation expires in 14 days. If you weren't expecting it, you can ignore this email.</p>
</body></html>`;
  return { subject: `You're invited to join ${opts.orgName}`, text, html };
}

export function etaDelayEmail(opts: {
  orgName: string;
  shipmentReference: string;
  reference: string;
  previousEta: string;
  eta: string;
  slipDays: number;
  severity: "warning" | "critical";
  url: string;
}): Omit<EmailMessage, "to"> {
  const days = `${opts.slipDays} day${opts.slipDays === 1 ? "" : "s"}`;
  const subject = `${opts.severity === "critical" ? "[Critical] " : ""}${opts.shipmentReference}: ETA delayed ${days}`;
  const text = [
    `The carrier moved the ETA of ${opts.reference} (shipment ${opts.shipmentReference}, ${opts.orgName}) from ${opts.previousEta} to ${opts.eta} — ${days} later.`,
    "",
    `Open the shipment: ${opts.url}`,
    "",
    "ETAs are as reported by the carrier through the tracking provider and can change again.",
    "You receive this email as an owner or admin of the organization.",
  ].join("\n");
  const e = escapeHtml;
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#0d1628;line-height:1.5">
<p>The carrier moved the ETA of <strong>${e(opts.reference)}</strong> (shipment <strong>${e(opts.shipmentReference)}</strong>, ${e(opts.orgName)}) from <strong>${e(opts.previousEta)}</strong> to <strong>${e(opts.eta)}</strong> — ${e(days)} later.</p>
<p><a href="${e(opts.url)}">Open the shipment</a></p>
<p style="color:#5b6a86;font-size:13px">ETAs are as reported by the carrier through the tracking provider and can change again. You receive this email as an owner or admin of the organization.</p>
</body></html>`;
  return { subject, text, html };
}
