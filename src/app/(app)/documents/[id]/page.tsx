import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmFieldButton, FieldsForm, RetryExtractionButton, ReviewPanel } from "@/components/forms/review-forms";
import { DocumentStatusBadge, ExtractionBadge } from "@/components/status";
import { AutoRefresh } from "@/components/auto-refresh";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, DescriptionList, Notice, PageHeader } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { extractionConfigured } from "@/lib/extraction/registry";
import { formatBytes, formatDateTime } from "@/lib/format";
import { approvalBlockers, getDocument, LOW_CONFIDENCE } from "@/server/documents";

export const metadata = { title: "Review document" };

export default async function DocumentReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ uploaded?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { ctx } = await requireTenant();
  const doc = await getDocument(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const blockers = approvalBlockers(doc);
  const editable = can(ctx.role, "documents:edit_fields") && doc.status !== "approved";
  const toConfirm = doc.fields.filter((f) => doc.values[f.key]?.value && doc.values[f.key].requiresConfirmation);
  const fileUrl = `/api/documents/${doc.id}/file`;
  const isPdf = doc.mimeType === "application/pdf";
  const isBrowserImage = doc.mimeType === "image/png" || doc.mimeType === "image/jpeg";
  // A job that never reported back (e.g. the server restarted) can be retried after a few minutes.
  // eslint-disable-next-line react-hooks/purity -- request-time check in a server component
  const stuck = doc.extractionStatus === "processing" && Date.now() - new Date(doc.updatedAt).getTime() > 4 * 60_000;
  const canRetry = editable && extractionConfigured() && (doc.extractionStatus !== "processing" || stuck);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/shipments/${doc.shipmentId}`} className="hover:text-ink">
            ← {doc.shipmentReference}
          </Link>
        }
        title={doc.typeName}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <DocumentStatusBadge status={doc.status} />
            <ExtractionBadge status={doc.extractionStatus} />
            <span className="truncate">{doc.originalFilename}</span>
          </span>
        }
        actions={
          <ButtonLink href={`${fileUrl}?mode=download`} variant="secondary" prefetch={false}>
            Download
          </ButtonLink>
        }
      />

      {sp.uploaded && <Notice tone="success" className="mb-4" title="Uploaded securely">The file passed type and content checks and is stored privately.</Notice>}
      {doc.extractionStatus === "processing" && (
        <Notice tone="info" className="mb-4" title={stuck ? "AI reading is taking too long" : "AI is reading this document…"}>
          {stuck
            ? "The extraction did not report back. Try again, or enter values manually."
            : "This usually takes under a minute. The values below will fill in automatically."}
          {stuck ? canRetry && <RetryExtractionButton documentId={doc.id} label="Try again" /> : <AutoRefresh />}
        </Notice>
      )}
      {doc.extractionStatus === "not_configured" && (
        <Notice tone="info" className="mb-4" title="AI extraction not configured">
          {extractionConfigured()
            ? "This document was uploaded before AI extraction was enabled. You can have it read now, or enter values manually."
            : "No AI/OCR provider credentials are set, so nothing was extracted automatically. Enter the values from the document below."}
          {canRetry && <RetryExtractionButton documentId={doc.id} label="Read with AI" />}
        </Notice>
      )}
      {doc.extractionStatus === "completed" && doc.status !== "approved" && (
        <Notice tone="info" className="mb-4" title={`Read by AI${doc.extractionProvider ? ` (${doc.extractionProvider})` : ""}`}>
          Values below were filled in automatically. Check each one against the document and confirm or correct it. Fields the AI could not read are left empty.
        </Notice>
      )}
      {doc.extractionStatus === "failed" && (
        <Notice tone="error" className="mb-4" title="Extraction failed">
          {doc.extractionError ?? "The provider returned an error."} Enter values manually.
          {canRetry && <RetryExtractionButton documentId={doc.id} label="Try again" />}
        </Notice>
      )}
      {doc.status === "rejected" && doc.reviewNote && (
        <Notice tone="error" className="mb-4" title={`Rejected${doc.reviewedBy ? ` by ${doc.reviewedBy}` : ""}`}>
          {doc.reviewNote}
        </Notice>
      )}
      {doc.status === "approved" && (
        <Notice tone="success" className="mb-4" title={`Approved${doc.reviewedBy ? ` by ${doc.reviewedBy}` : ""}`}>
          {formatDateTime(doc.reviewedAt)} · Values are locked. Reopen to make changes.
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader title="Preview" description="Opened through a 60-second signed link. Each view is recorded in the audit log." />
          <div className="bg-bg/60">
            {isPdf ? (
              <iframe src={`${fileUrl}?mode=view`} title={`Preview of ${doc.originalFilename}`} className="h-[70vh] min-h-96 w-full" />
            ) : isBrowserImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${fileUrl}?mode=view`} alt={`Preview of ${doc.originalFilename}`} className="mx-auto max-h-[70vh] object-contain" />
            ) : (
              <p className="p-8 text-center text-sm text-muted">This file type can’t be previewed in the browser. Use Download.</p>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          {toConfirm.length > 0 && editable && (
            <Card>
              <CardHeader title="Values to confirm" description="Machine-read values must be checked by a person before approval." />
              <ul className="divide-y divide-line">
                {toConfirm.map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted">{f.label}</p>
                      <p className="truncate text-sm font-medium">{doc.values[f.key].value}</p>
                    </div>
                    <ConfirmFieldButton documentId={doc.id} fieldKey={f.key} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Document values" description={editable ? "Edit any value; values you type are recorded as entered by you." : undefined} />
            <div className="p-5">
              <FieldsForm key={doc.extractionStatus === "processing" ? "processing" : "ready"} documentId={doc.id} fields={doc.fields} values={doc.values} editable={editable} lowConfidence={LOW_CONFIDENCE} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Review" />
            <div className="p-5">
              <ReviewPanel documentId={doc.id} status={doc.status} blockers={blockers} canApprove={can(ctx.role, "documents:approve")} />
            </div>
          </Card>

          <Card>
            <CardHeader title="File details" />
            <div className="p-5">
              <DescriptionList
                items={[
                  { label: "Uploaded", value: `${formatDateTime(doc.createdAt)}${doc.uploadedBy ? ` by ${doc.uploadedBy}` : ""}` },
                  { label: "Size / type", value: `${formatBytes(doc.sizeBytes)} · ${doc.mimeType}` },
                  { label: "SHA-256", value: <span className="break-all font-mono text-xs">{doc.sha256}</span> },
                  { label: "Extraction provider", value: doc.extractionProvider },
                  {
                    label: "Virus scan",
                    value:
                      doc.scanStatus === "clean"
                        ? `Clean (${doc.scanEngine ?? "scanner"}) · ${formatDateTime(doc.scannedAt)}`
                        : "Not scanned (scanner not configured at upload time)",
                  },
                ]}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
