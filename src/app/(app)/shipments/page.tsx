import Link from "next/link";
import { ShipmentStatusBadge } from "@/components/status";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Card, EmptyState, PageHeader } from "@/components/ui/surface";
import { Table, Td, Th } from "@/components/ui/table";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { listShipments, SHIPMENT_STATUSES, STATUS_LABELS } from "@/server/shipments";

export const metadata = { title: "Shipments" };

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { ctx } = await requireTenant();
  const sp = await searchParams;
  const page = Math.max(Number(sp.page) || 1, 1);
  const result = await listShipments(ctx, { q: sp.q, status: sp.status, page, pageSize: 25 });
  const canWrite = can(ctx.role, "shipments:write");
  const filtered = !!(sp.q || sp.status);
  const pages = Math.max(Math.ceil(result.total / result.pageSize), 1);
  const qs = (p: number) => new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) }).toString();

  return (
    <>
      <PageHeader
        title="Shipments"
        description={`${result.total} ${result.total === 1 ? "shipment" : "shipments"}${filtered ? " match your filters" : ""}`}
        actions={canWrite && <ButtonLink href="/shipments/new">New shipment</ButtonLink>}
      />
      <Card>
        <form className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row" role="search">
          <Input name="q" defaultValue={sp.q} placeholder="Search reference, supplier, container, B/L…" aria-label="Search shipments" className="sm:max-w-sm" />
          <Select name="status" defaultValue={sp.status ?? ""} aria-label="Filter by status" className="sm:w-48">
            <option value="">All statuses</option>
            {SHIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {filtered && (
              <ButtonLink href="/shipments" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>

        {result.items.length === 0 ? (
          filtered ? (
            <EmptyState icon="⌕" title="No matching shipments" description="Try a different search term or status." action={<ButtonLink href="/shipments" variant="secondary">Clear filters</ButtonLink>} />
          ) : (
            <EmptyState
              icon="⛴"
              title="No shipments yet"
              description="Shipments group the commercial invoice, packing list, bill of lading and other documents for one consignment."
              action={canWrite && <ButtonLink href="/shipments/new">Create your first shipment</ButtonLink>}
            />
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Route</Th>
                <Th>Mode</Th>
                <Th>ETA</Th>
                <Th>Docs</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((s) => (
                <tr key={s.id} className="hover:bg-hover/40">
                  <Td>
                    <Link href={`/shipments/${s.id}`} className="font-medium text-ink hover:text-accent">
                      {s.reference}
                    </Link>
                    {s.supplierName && <p className="text-xs text-muted">{s.supplierName}</p>}
                  </Td>
                  <Td>{[s.originLocation ?? s.originCountry, s.destinationLocation ?? s.destinationCountry].filter(Boolean).join(" → ") || <span className="text-faint">—</span>}</Td>
                  <Td className="capitalize">{s.transportMode}</Td>
                  <Td>{formatDate(s.estimatedArrival) ?? <span className="text-faint">—</span>}</Td>
                  <Td className="tabular-nums">{s.documentCount}</Td>
                  <Td>
                    <ShipmentStatusBadge status={s.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
            <span>
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 && <ButtonLink href={`/shipments?${qs(page - 1)}`} variant="secondary" size="sm">Previous</ButtonLink>}
              {page < pages && <ButtonLink href={`/shipments?${qs(page + 1)}`} variant="secondary" size="sm">Next</ButtonLink>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
