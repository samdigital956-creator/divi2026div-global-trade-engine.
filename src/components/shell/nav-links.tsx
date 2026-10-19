"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/components/ui/cn";

export type NavItem = { href: string; label: string; icon: string };

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-0.5">
      {items.map((item) => {
        // Longest matching prefix wins, so /settings/members highlights "Team", not "Settings".
        const matches = (h: string) => pathname === h || pathname.startsWith(h + "/");
        const best = items.filter((i) => matches(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
        const isActive = best?.href === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-accent-soft text-ink ring-1 ring-inset ring-accent/25" : "text-muted hover:bg-hover hover:text-ink",
            )}
          >
            <span className={isActive ? "text-accent" : undefined}>
              <Icon d={item.icon} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav({ children }: { children: React.ReactNode }) {
  // Remember which page the menu was opened on, so navigating closes it.
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) =>
    setOpenOn((typeof next === "function" ? next(open) : next) ? pathname : null);
  return (
    <>
      <button
        type="button"
        className="grid size-9 place-items-center rounded-lg border border-line-strong text-ink-2 lg:hidden"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
      </button>
      {open && (
        <div className="fixed inset-0 top-14 z-40 lg:hidden">
          <div className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72 max-w-[85vw] overflow-y-auto border-r border-line bg-surface p-4">{children}</div>
        </div>
      )}
    </>
  );
}
