import Link from "next/link";
import { notFound } from "next/navigation";
import { AddEventForm } from "@/components/forms/event-form";
import { QuickTaskForm } from "@/components/forms/task-form";
import { DocumentStatusBadge, ExtractionBadge, ShipmentStatusBadge } from "@/components/status";
import { TaskList } from "@/components/tasks";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, CardHeader, DescriptionList, EmptyState, Notice, PageHeader } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { listDocuments } from "@/server/documents";
import { getShipment, listShipmentEvents } from "@/server/shipments";
import { listTasks } from "@/server/work";

export const metadata = { title: "Shipment" };

export default async function ShipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; updated?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { ctx } = await requireTenant();
  const s = await getShipment(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [docs, events, tasks] = await Promise.all([listDocuments(ctx, { shipmentId: id }), listShipmentEvents(ctx, id), listTasks(ctx, { shipmentId: id })]);
  const canWrite = can(ctx.role, "shipments:write");
  const canUpload = can(ctx.role, "documents:upload");

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/shipments" className="hover:text-ink">
            ← Shipments
          </Link>
        }
        title={s.reference}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <ShipmentStatusBadge status={s.status} />
            <span className="capitalize">{s.transportMode}</span>
            {s.supplierName && <span>· {s.supplierName}</span>}
          </span>
        }
        actions={
          <>
            {canWrite && (
              <ButtonLink href={`/shipments/${s.id}/edit`} variant="secondary">
                Edit
              </ButtonLink>
            )}
            {canUpload && <ButtonLink href={`/documents/upload?shipment=${s.id}`}>Upload document</ButtonLink>}
          </>
        }
      />

      {sp.created && <Notice tone="success" className="mb-6" title="Shipment created">Upload the commercial invoice, packing list and bill of lading next.</Notice>}
      {sp.updated && <Notice tone="success" className="mb-6">Shipment updated.</Notice>}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <div className="p-5">
              <DescriptionList
                items={[
                  { label: "Origin", value: [s.originLocation, s.originCountry].filter(Boolean).join(", ") || null },
                  { label: "Destination", value: [s.destinationLocation, s.destinationCountry].filter(Boolean).join(", ") || null },
                  { label: "Estimated departure", value: formatDate(s.estimatedDeparture) },
                  { label: "Estimated arrival", value: formatDate(s.estimatedArrival) },
                  { label: "Carrier", value: s.carrierName },
                  { label: "Incoterm", value: s.incoterm },
                  { label: "Container", value: s.containerNumber && <span className="font-mono">{s.containerNumber}</span> },
                  { label: "Bill of lading", value: s.billOfLadingNumber && <span className="font-mono">{s.billOfLadingNumber}</span> },
                ]}
              />
              {s.notes && <p className="mt-5 whitespace-pre-wrap border-t border-line pt-4 text-sm text-ink-2">{s.notes}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Documents"
              description={`${docs.length} uploaded`}
              action={canUpload && <ButtonLink href={`/documents/upload?shipment=${s.id}`} size="sm" variant="secondary">Upload</ButtonLink>}
            />
            {docs.length === 0 ? (
              <EmptyState
                icon="▤"
                title="No documents yet"
                description="Upload a PDF or image of each shipping document. Files are stored privately and only accessible to your organization."
                action={canUpload && <ButtonLink href={`/documents/upload?shipment=${s.id}`}>Upload document</ButtonLink>}
              />
            ) : (
              <ul className="divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.id}>
                    <Link href={`/documents/${d.id}`} className="flex flex-col gap-2 px-5 py-3 hover:bg-hover/40 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{d.typeName}</p>
                        <p className="truncate text-xs text-muted">
                          {d.originalFilename} · {formatBytes(d.sizeBytes)} · {formatDateTime(d.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <ExtractionBadge status={d.extractionStatus} />
                        <DocumentStatusBadge status={d.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Timeline" description="Manual entries and system activity. Carrier tracking is not connected." />
            {events.length === 0 ? (
              <EmptyState title="No events" />
            ) : (
              <ol className="relative space-y-5 px-5 py-5">
                {events.map((e) => (
                  <li key={e.id} className="relative flex gap-4">
                    <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-surface ${e.source === "system" ? "bg-faint" : "bg-accent"}`} />
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{e.description}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span>{formatDateTime(e.occurredAt)}</span>
                        {e.location && <span>· {e.location}</span>}
                        {e.actor && <span>· {e.actor}</span>}
                        <Badge tone={e.source === "manual" ? "accent" : "neutral"}>{e.source === "manual" ? "Manual entry" : "System"}</Badge>
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {canWrite && (
              <div className="border-t border-line p-5">
                <AddEventForm shipmentId={s.id} />
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Tasks" />
            <TaskList tasks={tasks} canWrite={can(ctx.role, "tasks:write")} showShipment={false} />
            {can(ctx.role, "tasks:write") && <QuickTaskForm shipmentId={s.id} />}
          </Card>
          <Card>
            <CardHeader title="Customs & tracking" />
            <div className="space-y-3 p-5 text-sm text-muted">
              <p>Live container tracking and tariff data are not connected in this phase. Nothing on this page is generated from carrier or customs systems.</p>
              <p>Classification and declaration decisions remain with your licensed customs broker.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
