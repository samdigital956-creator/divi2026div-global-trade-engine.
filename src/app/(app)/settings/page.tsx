import { DocumentTypeForm, OrgSettingsForm } from "@/components/forms/settings-forms";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { extractionConfigured } from "@/lib/extraction/registry";
import { formatBytes, formatDate } from "@/lib/format";
import { integrationOverview } from "@/lib/integrations";
import { storage } from "@/lib/storage";
import { listDocumentTypes } from "@/server/documents";
import { getOrganization } from "@/server/organization";

export const metadata = { title: "Settings" };

function Meter({ label, used, limit, format = (n: number) => String(n) }: { label: string; used: number; limit: number | null; format?: (n: number) => string }) {
  const pct = limit ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-2">{label}</span>
        <span className="tabular-nums text-muted">
          {format(used)} / {limit === null ? "Unlimited" : format(limit)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${pct >= 90 ? "bg-bad" : pct >= 70 ? "bg-warn" : "bg-accent"}`} style={{ width: `${limit ? pct : 0}%` }} />
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  const { ctx } = await requireTenant();
  const [org, types] = await Promise.all([getOrganization(ctx), listDocumentTypes(ctx)]);
  const canEdit = can(ctx.role, "org:update");
  const integrations = integrationOverview(extractionConfigured());
  const u = org.usage;
  const store = storage();

  return (
    <>
      <PageHeader title="Settings" description="Organization profile, plan usage, document types and integrations." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Organization" description={canEdit ? undefined : "Only admins and owners can change these settings."} />
            <div className="p-5">
              <OrgSettingsForm
                editable={canEdit}
                initial={{ name: org.name, countryCode: org.countryCode ?? undefined, defaultCurrency: org.defaultCurrency, timezone: org.timezone }}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Document types" description="Built-in types are available to every organization. Custom types are private to yours." />
            <ul className="divide-y divide-line">
              {types.map((t) => (
                <li key={t.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="truncate text-xs text-muted">{t.fields.map((f) => f.label + (f.required ? "*" : "")).join(", ") || "No fields"}</p>
                  </div>
                  <Badge tone={t.isCustom ? "accent" : "neutral"}>{t.isCustom ? "Custom" : "Built-in"}</Badge>
                </li>
              ))}
            </ul>
            {can(ctx.role, "document_types:manage") && (
              <div className="border-t border-line p-5">
                <DocumentTypeForm />
              </div>
            )}
          </Card>

          <Card>
            <div id="integrations" className="scroll-mt-20" />
            <CardHeader title="Integrations" description="Providers are prepared as interfaces only. None send or receive data until configured and reviewed." />
            <ul className="divide-y divide-line">
              {integrations.map((i) => (
                <li key={i.category} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{i.label}</p>
                    <p className="text-xs text-muted">{i.providers.join(" · ")}</p>
                    <p className="mt-1 text-sm text-ink-2">{i.note}</p>
                  </div>
                  <Badge tone={i.state === "configured" ? "ok" : "neutral"}>{i.state === "configured" ? "Configured" : "Not configured"}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Plan & usage" description={u ? `Current period ${formatDate(u.periodStart)} – ${formatDate(u.periodEnd)}` : undefined} />
            {u ? (
              <div className="space-y-4 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold">{u.planName}</span>
                  <Badge tone={u.status === "active" ? "ok" : u.status === "trialing" ? "accent" : "warn"}>{u.status}</Badge>
                </div>
                <Meter label="Shipments this period" used={u.shipments.used} limit={u.shipments.limit} />
                <Meter label="Documents this period" used={u.documents.used} limit={u.documents.limit} />
                <Meter label="Storage" used={u.storage.used} limit={u.storage.limit} format={formatBytes} />
                <Meter label="Seats" used={u.seats.used} limit={u.seats.limit} />
                <p className="text-xs text-faint">Billing is not connected yet; plan changes are made by the platform team.</p>
              </div>
            ) : (
              <p className="p-5 text-sm text-muted">No subscription found.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Security" />
            <div className="space-y-2 p-5 text-sm text-ink-2">
              <p>
                Document storage: <Badge tone={store ? "ok" : "bad"}>{store ? `Private (${store.name})` : "Not configured"}</Badge>
              </p>
              <p className="text-muted">Files are only reachable through 60-second signed links issued after a permission check. Access is audited.</p>
              <p className="text-muted">Tenant data is isolated with PostgreSQL row-level security.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
