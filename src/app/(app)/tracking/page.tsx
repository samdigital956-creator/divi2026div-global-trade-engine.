import Link from "next/link";
import { ShipmentStatusBadge } from "@/components/status";
import { FleetMap } from "@/components/tracking/tracking-map";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader, Stat, type Tone } from "@/components/ui/surface";
import { Table, Td, Th } from "@/components/ui/table";
import { requireTenant } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { trackingConfigured } from "@/lib/tracking/registry";
import { listOrgTrackings, type TrackingOverviewRow } from "@/server/tracking";

export const metadata = { title: "Tracking" };

const STATE: Record<TrackingOverviewRow["state"], { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "neutral" },
  active: { label: "Live", tone: "ok" },
  delivered: { label: "Delivered", tone: "ok" },
  not_found: { label: "Not found", tone: "warn" },
  failed: { label: "Error", tone: "bad" },
  stopped: { label: "Stopped", tone: "neutral" },
};

const humanStatus = (s: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—");

/** References whose carrier ETA falls within the next `days` days (and that have not arrived). */
function arrivingWithin(rows: TrackingOverviewRow[], days: number) {
  const limit = Date.now() + days * 86_400_000;
  return rows.filter((r) => !r.ata && r.eta && new Date(r.eta).getTime() <= limit);
}

export default async function TrackingPage() {
  const { ctx } = await requireTenant();
  const rows = await listOrgTrackings(ctx);
  const configured = trackingConfigured();

  const live = rows.filter((r) => r.state === "active");
  const arrivingSoon = arrivingWithin(live, 7);
  const needsAttention = rows.filter((r) => r.state === "failed" || r.state === "not_found");
  const markers = live
    .filter((r) => r.position)
    .map((r) => ({
      id: r.id,
      lat: r.position!.lat,
      lng: r.position!.lng,
      label: `${r.reference} · ${r.shipmentReference}${r.vessel?.name ? ` · ${r.vessel.name}` : ""}${r.isDelayed ? " · delayed" : ""}`,
      delayed: r.isDelayed,
      href: `/shipments/${r.shipmentId}`,
    }));

  return (
    <>
      <PageHeader title="Tracking" description="Every container and B/L your organization tracks, with carrier status, ETA and last reported position." />

      {!configured && (
        <Notice tone="info" className="mb-6">
          Live tracking is not connected for this workspace. An administrator needs to add a tracking provider key.
        </Notice>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Live" value={live.length} hint="References being tracked" />
        <Stat label="Delayed" value={live.filter((r) => r.isDelayed).length} hint="Flagged late by the carrier" tone={live.some((r) => r.isDelayed) ? "warn" : undefined} />
        <Stat label="Arriving in 7 days" value={arrivingSoon.length} hint="By carrier ETA" />
        <Stat label="Need attention" value={needsAttention.length} hint="Not found or provider error" tone={needsAttention.length ? "bad" : undefined} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="◎"
            title="Nothing tracked yet"
            description="Open a shipment and start live tracking with its container or bill of lading number."
            action={
              <Link href="/shipments" className="text-sm text-accent hover:underline">
                Go to shipments
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {markers.length > 0 && (
            <Card>
              <CardHeader title="Positions" description="Last position reported by each carrier. Amber markers are delayed. Click a marker to open its shipment." />
              <div className="p-5">
                <FleetMap markers={markers} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Tracked references" description={`${rows.length} total`} />
            <Table>
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Shipment</Th>
                  <Th>Carrier status</Th>
                  <Th>ETA</Th>
                  <Th>Vessel</Th>
                  <Th>Last checked</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-hover/40">
                    <Td>
                      <Link href={`/shipments/${r.shipmentId}`} className="font-mono font-medium text-ink hover:text-accent">
                        {r.reference}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
                        {r.isDelayed && <Badge tone="warn">Delayed</Badge>}
                      </div>
                    </Td>
                    <Td>
                      <Link href={`/shipments/${r.shipmentId}`} className="text-ink hover:text-accent">
                        {r.shipmentReference}
                      </Link>
                      <div className="mt-1">
                        <ShipmentStatusBadge status={r.shipmentStatus as Parameters<typeof ShipmentStatusBadge>[0]["status"]} />
                      </div>
                    </Td>
                    <Td>
                      {humanStatus(r.carrierStatus)}
                      <div className="text-xs text-muted">{r.sealineName ?? r.sealine ?? ""}</div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {r.ata ? <span>Arrived {formatDate(r.ata)}</span> : formatDate(r.eta) ?? "—"}
                      {r.destination && <div className="max-w-48 truncate text-xs text-muted">{r.destination}</div>}
                    </Td>
                    <Td>{r.vessel?.name ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(r.lastCheckedAt) ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <p className="text-xs text-faint">Positions and ETAs are as reported by carriers through the tracking provider and can lag reality.</p>
        </div>
      )}
    </>
  );
}
