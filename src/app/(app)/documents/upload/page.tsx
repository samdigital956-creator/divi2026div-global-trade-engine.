import { UploadForm } from "@/components/forms/upload-form";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { extractionConfigured } from "@/lib/extraction/registry";
import { storage } from "@/lib/storage";
import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES } from "@/lib/uploads";
import { listDocumentTypes } from "@/server/documents";
import { listShipments } from "@/server/shipments";

export const metadata = { title: "Upload document" };

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ shipment?: string }> }) {
  const { ctx } = await requireTenant();
  const { shipment } = await searchParams;
  if (!can(ctx.role, "documents:upload")) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Upload document" />
        <Notice tone="warning" title="Read-only access">Your role cannot upload documents.</Notice>
      </div>
    );
  }
  const [shipments, types] = await Promise.all([listShipments(ctx, { pageSize: 100 }), listDocumentTypes(ctx)]);
  const storageReady = storage() !== null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Documents" title="Upload document" description="Files are checked by type and content, stored privately and never exposed via public links." />
      {!storageReady && (
        <Notice tone="error" title="Storage not configured" className="mb-6">
          Private document storage has not been configured on the server. Uploads are disabled until an administrator sets the S3 bucket variables.
        </Notice>
      )}
      {extractionConfigured() ? (
        <Notice tone="info" className="mb-6" title="AI-assisted review">
          After upload the document is read by AI (PDF, PNG or JPEG; this can take up to a minute). You then confirm or correct every value.
          The file is sent to the AI provider for processing.
        </Notice>
      ) : (
        <Notice tone="info" className="mb-6" title="Manual review">
          AI extraction is not configured, so you will enter key values yourself on the next screen.
        </Notice>
      )}
      <Card className="p-5 sm:p-6">
        {shipments.items.length === 0 ? (
          <EmptyState title="Create a shipment first" description="Every document belongs to a shipment." action={<ButtonLink href="/shipments/new">New shipment</ButtonLink>} />
        ) : (
          <UploadForm
            shipments={shipments.items.map((s) => ({ id: s.id, label: s.supplierName ? `${s.reference} — ${s.supplierName}` : s.reference }))}
            types={types.map((t) => ({ id: t.id, label: t.isCustom ? `${t.name} (custom)` : t.name }))}
            defaultShipmentId={shipments.items.some((s) => s.id === shipment) ? shipment : undefined}
            accept={ACCEPT_ATTRIBUTE}
            maxBytes={MAX_UPLOAD_BYTES}
          />
        )}
      </Card>
    </div>
  );
}
