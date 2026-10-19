import { notFound } from "next/navigation";
import { updateShipmentAction } from "@/app/actions/shipments";
import { ShipmentForm } from "@/components/forms/shipment-form";
import { Notice, PageHeader } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { getShipment } from "@/server/shipments";
import { shipmentFormOptions } from "../../options";

export const metadata = { title: "Edit shipment" };

export default async function EditShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireTenant();
  const s = await getShipment(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const initial = Object.fromEntries(
    Object.entries({
      reference: s.reference,
      transportMode: s.transportMode,
      status: s.status,
      supplierName: s.supplierName,
      originCountry: s.originCountry,
      destinationCountry: s.destinationCountry,
      originLocation: s.originLocation,
      destinationLocation: s.destinationLocation,
      carrierName: s.carrierName,
      containerNumber: s.containerNumber,
      billOfLadingNumber: s.billOfLadingNumber,
      incoterm: s.incoterm,
      estimatedDeparture: s.estimatedDeparture,
      estimatedArrival: s.estimatedArrival,
      notes: s.notes,
    }).map(([k, v]) => [k, v ?? undefined]),
  );
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow={`Shipments / ${s.reference}`} title="Edit shipment" />
      {can(ctx.role, "shipments:write") ? (
        <ShipmentForm action={updateShipmentAction} initial={initial} shipmentId={s.id} options={shipmentFormOptions} submitLabel="Save changes" cancelHref={`/shipments/${s.id}`} />
      ) : (
        <Notice tone="warning" title="Read-only access">Your role cannot edit shipments.</Notice>
      )}
    </div>
  );
}
