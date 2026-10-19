import { createShipmentAction } from "@/app/actions/shipments";
import { ShipmentForm } from "@/components/forms/shipment-form";
import { Notice, PageHeader } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { shipmentFormOptions } from "../options";

export const metadata = { title: "New shipment" };

export default async function NewShipmentPage() {
  const { ctx } = await requireTenant();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Shipments" title="New shipment" description="Create the record first, then upload its documents." />
      {can(ctx.role, "shipments:write") ? (
        <ShipmentForm action={createShipmentAction} options={shipmentFormOptions} submitLabel="Create shipment" cancelHref="/shipments" />
      ) : (
        <Notice tone="warning" title="Read-only access">Your role can view shipments but not create them. Ask an admin to change your role.</Notice>
      )}
    </div>
  );
}
