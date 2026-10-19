import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/surface";
import { Table, Td, Th } from "@/components/ui/table";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { listAuditLogs } from "@/server/organization";

export const metadata = { title: "Audit history" };

const FILTERS = [
  { value: "", label: "All activity" },
  { value: "document.", label: "Documents" },
  { value: "document.viewed", label: "Document views" },
  { value: "document.downloaded", label: "Document downloads" },
  { value: "document.approved", label: "Approvals" },
  { value: "shipment.", label: "Shipments" },
  { value: "member.", label: "Members" },
  { value: "org.", label: "Organization" },
  { value: "upload.rejected", label: "Rejected uploads" },
];

function entityHref(type: string, id: string | null) {
  if (!id) return null;
  if (type === "shipment") return `/shipments/${id}`;
  if (type === "document") return `/documents/${id}`;
  return null;
}

function summarise(meta: Record<string, unknown>) {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (k === "fields" && typeof v === "object" && v && !Array.isArray(v)) continue;
    if (v === null || v === undefined || typeof v === "object") continue;
    parts.push(`${k}: ${String(v).slice(0, 60)}`);
  }
  if (Array.isArray(meta.fields)) parts.push(`fields: ${(meta.fields as string[]).join(", ")}`);
  return parts.join(" · ");
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; before?: string }> }) {
  const { ctx } = await requireTenant();
  if (!can(ctx.role, "audit:read")) {
    return (
      <>
        <PageHeader title="Audit history" />
        <Notice tone="warning" title="Restricted">Only admins and owners can view the audit history.</Notice>
      </>
    );
  }
  const sp = await searchParams;
  const before = Number(sp.before) || undefined;
  const { items, nextBefore } = await listAuditLogs(ctx, { action: sp.action, before, limit: 50 });

  return (
    <>
      <PageHeader title="Audit history" description="Append-only record of access and changes in your organization." />
      <Card>
        <form className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <Select name="action" defaultValue={sp.action ?? ""} aria-label="Filter activity" className="sm:w-64">
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
        {items.length === 0 ? (
          <EmptyState title="No activity" description={sp.action ? "No events match this filter." : "Activity will appear here as your team works."} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const href = entityHref(a.entityType, a.entityId);
                return (
                  <tr key={a.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(a.createdAt)}</Td>
                    <Td className="text-sm">{a.actor ?? <span className="text-faint">System</span>}</Td>
                    <Td>
                      <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs text-ink">{a.action}</code>
                    </Td>
                    <Td className="max-w-md text-xs">
                      {href ? (
                        <Link href={href} className="text-accent hover:underline">
                          {a.entityType}
                        </Link>
                      ) : (
                        <span>{a.entityType}</span>
                      )}
                      {summarise(a.metadata) && <span className="ml-1 break-words text-muted">· {summarise(a.metadata)}</span>}
                      {a.ip && <span className="ml-1 text-faint">· {a.ip}</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {(before || nextBefore) && (
          <div className="flex justify-between border-t border-line px-5 py-3">
            {before ? <ButtonLink href={`/audit${sp.action ? `?action=${encodeURIComponent(sp.action)}` : ""}`} variant="ghost" size="sm">Newest</ButtonLink> : <span />}
            {nextBefore && (
              <ButtonLink href={`/audit?${new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), before: String(nextBefore) })}`} variant="secondary" size="sm">
                Older
              </ButtonLink>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
