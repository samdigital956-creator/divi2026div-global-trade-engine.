import Link from "next/link";
import { DocumentStatusBadge, ExtractionBadge } from "@/components/status";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Card, EmptyState, PageHeader } from "@/components/ui/surface";
import { Table, Td, Th } from "@/components/ui/table";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { formatBytes, relativeTime } from "@/lib/format";
import { DOCUMENT_STATUS_LABELS, listDocuments } from "@/server/documents";

export const metadata = { title: "Documents" };

const TABS = [{ value: "", label: "All" }, ...Object.entries(DOCUMENT_STATUS_LABELS).filter(([k]) => k !== "uploaded").map(([value, label]) => ({ value, label }))];

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { ctx } = await requireTenant();
  const { status = "" } = await searchParams;
  const docs = await listDocuments(ctx, { status: status || undefined, limit: 200 });
  const canUpload = can(ctx.role, "documents:upload");

  return (
    <>
      <PageHeader title="Documents" description="Every shipping document across your organization." actions={canUpload && <ButtonLink href="/documents/upload">Upload document</ButtonLink>} />
      <Card>
        <nav className="flex gap-1 overflow-x-auto border-b border-line px-3" aria-label="Filter by status">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={t.value ? `/documents?status=${t.value}` : "/documents"}
              aria-current={status === t.value ? "page" : undefined}
              className={cn("whitespace-nowrap border-b-2 px-3 py-3 text-sm", status === t.value ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {docs.length === 0 ? (
          <EmptyState
            icon="▤"
            title={status ? "Nothing here" : "No documents yet"}
            description={status === "needs_review" ? "No documents are waiting for review." : "Upload commercial invoices, packing lists, bills of lading and certificates of origin to a shipment."}
            action={canUpload && !status && <ButtonLink href="/documents/upload">Upload document</ButtonLink>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>Shipment</Th>
                <Th>Uploaded</Th>
                <Th>Extraction</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="hover:bg-hover/40">
                  <Td>
                    <Link href={`/documents/${d.id}`} className="font-medium text-ink hover:text-accent">
                      {d.typeName}
                    </Link>
                    <p className="max-w-xs truncate text-xs text-muted">
                      {d.originalFilename} · {formatBytes(d.sizeBytes)}
                    </p>
                  </Td>
                  <Td>
                    <Link href={`/shipments/${d.shipmentId}`} className="hover:text-ink">
                      {d.shipmentReference}
                    </Link>
                  </Td>
                  <Td>
                    {relativeTime(d.createdAt)}
                    {d.uploadedBy && <p className="text-xs text-muted">{d.uploadedBy}</p>}
                  </Td>
                  <Td>
                    <ExtractionBadge status={d.extractionStatus} />
                  </Td>
                  <Td>
                    <DocumentStatusBadge status={d.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
