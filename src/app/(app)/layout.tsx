import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/logo";
import { MobileNav, NavLinks, type NavItem } from "@/components/shell/nav-links";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { can } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ICONS = {
  dashboard: "M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z",
  shipments: "M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10",
  documents: "M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zm0 0v5h5M9 13h6M9 17h6",
  members: "M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6zm13 9v-1a4 4 0 00-3-3.87M16 4.13a3 3 0 010 5.74",
  audit: "M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, org, memberships, ctx } = await requireTenant();
  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: ICONS.dashboard },
    { href: "/shipments", label: "Shipments", icon: ICONS.shipments },
    { href: "/documents", label: "Documents", icon: ICONS.documents },
    { href: "/settings/members", label: "Team", icon: ICONS.members },
    ...(can(ctx.role, "audit:read") ? [{ href: "/audit", label: "Audit history", icon: ICONS.audit }] : []),
    { href: "/settings", label: "Settings", icon: ICONS.settings },
  ];

  const sidebar = (
    <div className="flex h-full flex-col gap-6">
      <OrgSwitcher current={org} memberships={memberships} />
      <NavLinks items={items} />
      <div className="mt-auto border-t border-line pt-4">
        <p className="truncate text-sm font-medium text-ink-2">{user.displayName ?? user.email}</p>
        {user.displayName && <p className="truncate text-xs text-muted">{user.email}</p>}
        <SignOutButton className="mt-2" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-screen self-start flex-col border-r border-line bg-surface/60 p-4 lg:flex">
        <Link href="/dashboard" className="mb-6 px-1">
          <Logo />
        </Link>
        {sidebar}
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/85 px-4 backdrop-blur lg:hidden">
          <Link href="/dashboard">
            <Logo />
          </Link>
          <MobileNav>{sidebar}</MobileNav>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
