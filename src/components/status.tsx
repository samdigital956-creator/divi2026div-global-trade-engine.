import { Badge, type Tone } from "@/components/ui/surface";
import { DOCUMENT_STATUS_LABELS, EXTRACTION_STATUS_LABELS } from "@/server/documents";
import { STATUS_LABELS } from "@/server/shipments";

const shipmentTone: Record<keyof typeof STATUS_LABELS, Tone> = {
  draft: "neutral",
  booked: "accent",
  in_transit: "accent",
  at_port: "warn",
  customs_review: "warn",
  cleared: "ok",
  delivered: "ok",
  cancelled: "bad",
};

export function ShipmentStatusBadge({ status }: { status: keyof typeof STATUS_LABELS }) {
  return <Badge tone={shipmentTone[status]}>{STATUS_LABELS[status]}</Badge>;
}

const docTone: Record<keyof typeof DOCUMENT_STATUS_LABELS, Tone> = { uploaded: "neutral", needs_review: "warn", approved: "ok", rejected: "bad" };
export function DocumentStatusBadge({ status }: { status: keyof typeof DOCUMENT_STATUS_LABELS }) {
  return <Badge tone={docTone[status]}>{DOCUMENT_STATUS_LABELS[status]}</Badge>;
}

const extTone: Record<keyof typeof EXTRACTION_STATUS_LABELS, Tone> = {
  pending: "neutral",
  not_configured: "neutral",
  processing: "accent",
  completed: "accent",
  failed: "bad",
  manual: "neutral",
};
export function ExtractionBadge({ status }: { status: keyof typeof EXTRACTION_STATUS_LABELS }) {
  return <Badge tone={extTone[status]}>{EXTRACTION_STATUS_LABELS[status]}</Badge>;
}
