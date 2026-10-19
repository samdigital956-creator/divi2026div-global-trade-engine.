import Link from "next/link";
import { completeTaskAction } from "@/app/actions/shipments";
import { Badge, EmptyState } from "@/components/ui/surface";
import { formatDate } from "@/lib/format";

type Task = Awaited<ReturnType<typeof import("@/server/work").listTasks>>[number];

const priorityTone = { urgent: "bad", high: "warn", normal: "neutral", low: "neutral" } as const;

export function TaskList({ tasks, canWrite, showShipment = true }: { tasks: Task[]; canWrite: boolean; showShipment?: boolean }) {
  if (tasks.length === 0) return <EmptyState icon="✓" title="No open tasks" description="Review tasks appear here automatically when documents are uploaded." />;
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-start gap-3 px-5 py-3">
          {canWrite && t.status === "open" ? (
            <form action={completeTaskAction} className="pt-0.5">
              <input type="hidden" name="taskId" value={t.id} />
              <button type="submit" className="grid size-4.5 place-items-center rounded border border-line-strong hover:border-accent hover:bg-accent-soft" aria-label={`Mark “${t.title}” done`} />
            </form>
          ) : (
            <span className={`mt-0.5 grid size-4.5 place-items-center rounded text-[10px] ${t.status === "done" ? "bg-ok-soft text-ok" : "border border-line-strong"}`}>{t.status === "done" ? "✓" : ""}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-sm ${t.status === "done" ? "text-faint line-through" : "text-ink"}`}>
              {t.documentId ? (
                <Link href={`/documents/${t.documentId}`} className="hover:text-accent">
                  {t.title}
                </Link>
              ) : (
                t.title
              )}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              {t.priority !== "normal" && <Badge tone={priorityTone[t.priority as keyof typeof priorityTone]}>{t.priority}</Badge>}
              {showShipment && t.shipmentReference && (
                <Link href={`/shipments/${t.shipmentId}`} className="hover:text-ink">
                  {t.shipmentReference}
                </Link>
              )}
              {t.dueAt && <span>Due {formatDate(t.dueAt)}</span>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
