import Link from "next/link";
import { DocumentStatusBadge, ShipmentStatusBadge } from "@/components/status";
import { TaskList } from "@/components/tasks";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, Notice, PageHeader, Stat } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { extractionConfigured } from "@/lib/extraction/registry";
import { formatDate, relativeTime } from "@/lib/format";
import { listDocuments } from "@/server/documents";
import { listShipments } from "@/server/shipments";
import { dashboardStats, listOpenAlerts, listTasks } from "@/server/work";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { ctx, user, org } = await requireTenant();
  const [stats, recent, review, tasks, alerts] = await Promise.all([
    dashboardStats(ctx),
    listShipments(ctx, { pageSize: 6 }),
    listDocuments(ctx, { status: "needs_review", limit: 6 }),
    listTasks(ctx, { status: "open", limit: 8 }),
    listOpenAlerts(ctx, 5),
  ]);
  const canWrite = can(ctx.role, "shipments:write");
  const firstName = (user.displayName ?? "").split(" ")[0];

  return (
    <>
      <PageHeader
        eyebrow={org.orgName}
        title={firstName ? `Good to see you, ${firstName}` : "Dashboard"}
        description="Shipments, documents awaiting review and open work across your organization."
        actions={canWrite && <ButtonLink href="/shipments/new">New shipment</ButtonLink>}
      />

      {!extractionConfigured() && (
        <Notice tone="info" title="AI extraction is not configured" className="mb-6">
          Uploaded documents go straight to manual review. No values are generated automatically.{" "}
          <Link href="/settings#integrations" className="text-accent hover:underline">
            View integration status
          </Link>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active shipments" value={stats.activeShipments} hint={`${stats.inTransit} in transit`} />
        <Stat label="Arriving ≤ 7 days" value={stats.arriving7d} hint="Based on your entered ETAs" />
        <Stat label="Docs to review" value={stats.documentsNeedingReview} tone={stats.documentsNeedingReview ? "warn" : undefined} />
        <Stat label="Open tasks" value={stats.openTasks} hint={stats.openAlerts ? `${stats.openAlerts} open alerts` : "No open alerts"} />
      </div>

      {alerts.length > 0 && (
        <div className="mt-6 space-y-2">
          {alerts.map((a) => (
            <Notice key={a.id} tone={a.severity === "critical" ? "error" : a.severity === "warning" ? "warning" : "info"}>
              {a.documentId ? (
                <Link href={`/documents/${a.documentId}`} className="hover:underline">
                  {a.message}
                </Link>
              ) : (
                a.message
              )}{" "}
              <span className="text-xs text-faint">· {relativeTime(a.createdAt)}</span>
            </Notice>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recent shipments" action={<ButtonLink href="/shipments" variant="ghost" size="sm">View all</ButtonLink>} />
          {recent.items.length === 0 ? (
            <EmptyState
              icon="⛴"
              title="No shipments yet"
              description="Create your first shipment to start collecting documents for it."
              action={canWrite && <ButtonLink href="/shipments/new">Create shipment</ButtonLink>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {recent.items.map((s) => (
                <li key={s.id}>
                  <Link href={`/shipments/${s.id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-hover/50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{s.reference}</p>
                      <p className="truncate text-xs text-muted">
                        {[s.originCountry, s.destinationCountry].filter(Boolean).join(" → ") || "Route not set"}
                        {s.supplierName && ` · ${s.supplierName}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {s.estimatedArrival && <span className="hidden text-xs text-muted sm:inline">ETA {formatDate(s.estimatedArrival)}</span>}
                      <ShipmentStatusBadge status={s.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Open tasks" />
          <TaskList tasks={tasks} canWrite={can(ctx.role, "tasks:write")} />
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Documents awaiting review" action={<ButtonLink href="/documents?status=needs_review" variant="ghost" size="sm">Review queue</ButtonLink>} />
        {review.length === 0 ? (
          <EmptyState icon="✓" title="Review queue is clear" description="Documents that need a human check will appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {review.map((d) => (
              <li key={d.id}>
                <Link href={`/documents/${d.id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-hover/50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.typeName}</p>
                    <p className="truncate text-xs text-muted">
                      {d.shipmentReference} · {d.originalFilename} · {relativeTime(d.createdAt)}
                    </p>
                  </div>
                  <DocumentStatusBadge status={d.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
