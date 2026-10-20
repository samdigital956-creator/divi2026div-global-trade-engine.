import { Badge, Card, CardHeader, DescriptionList, EmptyState, Notice, type Tone } from "@/components/ui/surface";
import { formatDate, formatDateTime } from "@/lib/format";
import { KNOWN_TRACKING_PROVIDERS } from "@/lib/tracking/types";
import type { Tracking } from "@/server/tracking";
import { RefreshTrackingForm, StartTrackingForm, StopTrackingForm } from "./tracking-forms";
import { TrackingMap } from "./tracking-map";

const STATE: Record<Tracking["state"], { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "neutral" },
  active: { label: "Live", tone: "ok" },
  delivered: { label: "Delivered", tone: "ok" },
  not_found: { label: "Not found", tone: "warn" },
  failed: { label: "Error", tone: "bad" },
  stopped: { label: "Stopped", tone: "neutral" },
};

const providerLabel = (id: string) => KNOWN_TRACKING_PROVIDERS.find((p) => p.id === id)?.label ?? id;
const humanStatus = (s: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null);

export function TrackingCard({
  shipmentId,
  trackings,
  configured,
  canWrite,
  containerNumber,
  billOfLadingNumber,
}: {
  shipmentId: string;
  trackings: Tracking[];
  configured: boolean;
  canWrite: boolean;
  containerNumber: string | null;
  billOfLadingNumber: string | null;
}) {
  const visible = trackings.filter((t) => t.state !== "stopped");
  const tracked = new Set(visible.map((t) => t.reference));
  const suggestion = containerNumber && !tracked.has(containerNumber.toUpperCase()) ? containerNumber : billOfLadingNumber && !tracked.has(billOfLadingNumber.toUpperCase()) ? billOfLadingNumber : null;

  return (
    <Card>
      <CardHeader title="Live tracking" description="Carrier milestones, ETA and vessel position from the connected tracking provider." />
      {!configured && (
        <div className="p-5">
          <Notice tone="info">Live tracking is not connected for this workspace. An administrator needs to add a tracking provider key.</Notice>
        </div>
      )}
      {configured && visible.length === 0 && !canWrite && <EmptyState icon="◎" title="Not tracked" description="No container or B/L is being tracked for this shipment." />}

      {visible.map((t) => (
        <div key={t.id} className="space-y-4 border-b border-line p-5 last:border-b-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{t.reference}</span>
                <Badge tone={STATE[t.state].tone}>{STATE[t.state].label}</Badge>
                {t.isDelayed && <Badge tone="warn">Delayed</Badge>}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t.referenceType === "bl" ? "Bill of lading" : "Container"}
                {t.sealineName || t.sealine ? ` · ${t.sealineName ?? t.sealine}` : ""} · via {providerLabel(t.provider)}
              </p>
            </div>
            {canWrite && (
              <div className="flex items-start gap-2">
                {configured && <RefreshTrackingForm shipmentId={shipmentId} trackingId={t.id} />}
                <StopTrackingForm shipmentId={shipmentId} trackingId={t.id} />
              </div>
            )}
          </div>

          {t.lastError && t.state !== "active" && t.state !== "delivered" && <Notice tone={t.state === "not_found" ? "warning" : "error"}>{t.lastError}</Notice>}

          {(t.state === "active" || t.state === "delivered") && (
            <>
              <DescriptionList
                items={[
                  { label: "Carrier status", value: humanStatus(t.carrierStatus) },
                  { label: t.ata ? "Arrived (ATA)" : "ETA", value: formatDate(t.ata ?? t.eta) },
                  { label: "Route", value: [t.origin, t.destination].filter(Boolean).join(" → ") || null },
                  { label: "Vessel", value: t.vessel?.name ? `${t.vessel.name}${t.vessel.imo ? ` (IMO ${t.vessel.imo})` : ""}` : null },
                  { label: "Delivered", value: t.deliveredAt ? formatDate(t.deliveredAt) : null },
                  { label: "Carrier data as of", value: formatDateTime(t.lastSyncedAt) },
                ]}
              />
              {(t.position || t.route.length > 1) && <TrackingMap position={t.position} route={t.route} label={t.vessel?.name ? `${t.vessel.name} — last reported position` : `${t.reference} — last reported position`} />}
              <p className="text-xs text-faint">
                Last checked {formatDateTime(t.lastCheckedAt)}. Positions and ETAs are as reported by the carrier and can lag reality; they are not a guarantee of arrival.
              </p>
            </>
          )}
        </div>
      ))}

      {configured && canWrite && (
        <div className="border-t border-line p-5">
          <StartTrackingForm shipmentId={shipmentId} defaultReference={suggestion} defaultType={suggestion && suggestion === billOfLadingNumber && suggestion !== containerNumber ? "bl" : "container"} />
        </div>
      )}
    </Card>
  );
}
