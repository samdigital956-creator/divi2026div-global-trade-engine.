import type { ReactNode } from "react";
import { cn } from "./cn";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border border-line bg-surface", className)}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">{eyebrow}</div>}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  neutral: "bg-line/60 text-ink-2 ring-line-strong",
  accent: "bg-accent-soft text-accent ring-accent/30",
  ok: "bg-ok-soft text-ok ring-ok/30",
  warn: "bg-warn-soft text-warn ring-warn/30",
  bad: "bg-bad-soft text-bad ring-bad/30",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone])}>{children}</span>;
}

const noticeTones = {
  info: "border-accent/30 bg-accent-soft text-ink-2",
  success: "border-ok/30 bg-ok-soft text-ink-2",
  warning: "border-warn/30 bg-warn-soft text-ink-2",
  error: "border-bad/30 bg-bad-soft text-ink-2",
};
const noticeIcon = { info: "ℹ", success: "✓", warning: "!", error: "×" };
const noticeIconColor = { info: "text-accent", success: "text-ok", warning: "text-warn", error: "text-bad" };

export function Notice({ tone = "info", title, children, className }: { tone?: keyof typeof noticeTones; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", noticeTones[tone], className)}>
      <span className={cn("mt-px grid size-5 shrink-0 place-items-center rounded-full bg-bg/50 text-xs font-bold", noticeIconColor[tone])} aria-hidden>
        {noticeIcon[tone]}
      </span>
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon = "◇" }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl border border-line-strong bg-elevated text-lg text-accent">{icon}</div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-line/70", className)} />;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wider text-muted">{i.label}</dt>
          <dd className="mt-1 break-words text-sm text-ink">{i.value ?? <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
