import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const control =
  "w-full rounded-lg border bg-bg/60 px-3 text-sm text-ink placeholder:text-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

export function Field({
  label,
  name,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={name} className="block text-sm font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-accent">*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="text-xs text-bad" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type WithError = { error?: string };

export function Input({ error, className, ...props }: ComponentProps<"input"> & WithError) {
  return (
    <input
      id={props.name}
      aria-invalid={!!error || undefined}
      aria-describedby={error ? `${props.name}-error` : undefined}
      className={cn(control, "h-10", error ? "border-bad/70" : "border-line-strong", className)}
      {...props}
    />
  );
}

export function Select({ error, className, children, ...props }: ComponentProps<"select"> & WithError) {
  return (
    <select
      id={props.name}
      aria-invalid={!!error || undefined}
      className={cn(control, "h-10 appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8", error ? "border-bad/70" : "border-line-strong", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%238392ad' stroke-width='1.5'%3E%3Cpath d='M1 1l5 5 5-5'/%3E%3C/svg%3E\")" }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ error, className, ...props }: ComponentProps<"textarea"> & WithError) {
  return (
    <textarea
      id={props.name}
      aria-invalid={!!error || undefined}
      className={cn(control, "min-h-24 py-2", error ? "border-bad/70" : "border-line-strong", className)}
      {...props}
    />
  );
}
