import { switchOrganizationAction } from "@/app/actions/org";
import type { MembershipSummary } from "@/server/accounts";
import { ROLE_LABELS } from "@/lib/authz";

export function OrgSwitcher({ current, memberships }: { current: MembershipSummary; memberships: MembershipSummary[] }) {
  if (memberships.length < 2) {
    return (
      <div className="rounded-lg border border-line bg-elevated px-3 py-2">
        <p className="truncate text-sm font-medium">{current.orgName}</p>
        <p className="text-xs text-muted">{ROLE_LABELS[current.role]}</p>
      </div>
    );
  }
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-line bg-elevated px-3 py-2 hover:bg-hover">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{current.orgName}</span>
          <span className="block text-xs text-muted">{ROLE_LABELS[current.role]}</span>
        </span>
        <span className="text-muted transition-transform group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="absolute inset-x-0 z-20 mt-1 rounded-lg border border-line-strong bg-elevated p-1 shadow-xl shadow-black/40">
        {memberships.map((m) => (
          <form key={m.orgId} action={switchOrganizationAction}>
            <input type="hidden" name="orgId" value={m.orgId} />
            <button
              type="submit"
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-hover aria-[current=true]:text-accent"
              aria-current={m.orgId === current.orgId}
            >
              <span className="truncate">{m.orgName}</span>
              <span className="text-xs text-muted">{ROLE_LABELS[m.role]}</span>
            </button>
          </form>
        ))}
        <a href="/onboarding" className="mt-1 block rounded-md border-t border-line px-3 py-2 text-sm text-muted hover:bg-hover hover:text-ink">
          + New organization
        </a>
      </div>
    </details>
  );
}
