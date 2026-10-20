import Link from "next/link";
import { ChangePlanButton, CheckoutButton, PortalButton } from "@/components/billing/billing-actions";
import { Badge, Card, CardHeader, Notice, PageHeader, type Tone } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { formatBytes, formatDate } from "@/lib/format";
import { getBillingOverview, type PlanOption } from "@/server/billing";

export const metadata = { title: "Billing" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  trialing: { label: "Trial", tone: "accent" },
  active: { label: "Active", tone: "ok" },
  past_due: { label: "Payment overdue", tone: "bad" },
  paused: { label: "Paused", tone: "warn" },
  canceled: { label: "Canceled", tone: "neutral" },
};

const limit = (n: number | null, unit = "") => (n === null ? "Unlimited" : `${n.toLocaleString("en-US")}${unit}`);

function formatPrice(p: PlanOption["price"]) {
  if (!p) return null;
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency }).format(p.amount);
  const every = p.interval ? `/${p.frequency && p.frequency > 1 ? `${p.frequency} ` : ""}${p.interval}${p.frequency && p.frequency > 1 ? "s" : ""}` : "";
  return `${amount}${every}`;
}

export default async function BillingPage() {
  const { ctx } = await requireTenant();
  const b = await getBillingOverview(ctx);
  const canManage = can(ctx.role, "billing:manage");
  const status = STATUS[b.status] ?? { label: b.status, tone: "neutral" as Tone };
  const salesEmail = process.env.SALES_CONTACT_EMAIL;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/settings" className="hover:text-ink">
            ← Settings
          </Link>
        }
        title="Billing"
        description="Your plan, its limits and payments. Payments, tax and invoices are handled by Paddle, our merchant of record."
      />

      {!b.configured && (
        <Notice tone="info" className="mb-6" title="Online payments are not connected yet">
          Plans are assigned by the platform team for now. Nothing is charged.
        </Notice>
      )}
      {b.status === "past_due" && (
        <Notice tone="error" className="mb-6" title="Payment overdue">
          Paddle could not collect the last payment. Update the payment method under Manage billing to keep your plan.
        </Notice>
      )}
      {b.cancelAtPeriodEnd && (
        <Notice tone="warning" className="mb-6">
          The subscription is set to cancel on {formatDate(b.periodEnd)}. After that the organization returns to Trial limits; no data is deleted.
        </Notice>
      )}
      {b.pricesError && (
        <Notice tone="warning" className="mb-6">
          Prices could not be loaded from Paddle right now. Try again shortly.
        </Notice>
      )}

      <Card>
        <CardHeader title="Current plan" action={canManage && b.hasSubscription && <PortalButton />} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-5 text-sm">
          <span className="text-lg font-semibold">{b.planName}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="text-muted">
            {b.hasSubscription ? "Current billing period" : "Usage period"} {formatDate(b.periodStart)} – {formatDate(b.periodEnd)}
          </span>
        </div>
        {!canManage && <p className="border-t border-line px-5 py-3 text-xs text-muted">Only owners can change the plan or payment details.</p>}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {b.plans.map((p) => {
          const current = p.key === b.planKey && b.status !== "canceled";
          const price = formatPrice(p.price);
          return (
            <Card key={p.key} className={current ? "ring-1 ring-accent/40" : undefined}>
              <div className="flex h-full flex-col p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">{p.name}</h2>
                  {current && <Badge tone="accent">Current</Badge>}
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {p.key === "trial" ? "Free" : (price ?? (p.priceId ? "—" : "Contact us"))}
                </p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-2">
                  <li>{limit(p.limits.shipments)} shipments / month</li>
                  <li>{limit(p.limits.documents)} documents / month</li>
                  <li>{limit(p.limits.trackings)} live trackings / month</li>
                  <li>{p.limits.storageBytes === null ? "Unlimited" : formatBytes(p.limits.storageBytes)} storage</li>
                  <li>{limit(p.limits.seats)} team seats</li>
                </ul>
                <div className="mt-5">
                  {canManage && b.configured && !current && p.priceId &&
                    (b.hasSubscription ? <ChangePlanButton planKey={p.key} label={`Switch to ${p.name}`} /> : <CheckoutButton planKey={p.key} label={`Upgrade to ${p.name}`} />)}
                  {!p.priceId && p.key !== "trial" && !current && salesEmail && (
                    <a href={`mailto:${salesEmail}?subject=${encodeURIComponent(`${p.name} plan`)}`} className="text-sm text-accent hover:underline">
                      Talk to us about {p.name}
                    </a>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-faint">Prices are set in Paddle and may include or add local sales tax/VAT at checkout. Plan changes are prorated by Paddle.</p>
    </>
  );
}
