import { INCOTERMS, SHIPMENT_STATUSES, STATUS_LABELS, TRANSPORT_MODES } from "@/server/shipments";

export const shipmentFormOptions = {
  statuses: SHIPMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
  modes: [...TRANSPORT_MODES],
  incoterms: [...INCOTERMS],
};
