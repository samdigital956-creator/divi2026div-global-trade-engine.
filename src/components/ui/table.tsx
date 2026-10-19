import type { ReactNode } from "react";
import { cn } from "./cn";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("border-b border-line px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-muted", className)}>{children}</th>;
}
export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-line/60 px-5 py-3 align-middle text-ink-2", className)}>{children}</td>;
}
