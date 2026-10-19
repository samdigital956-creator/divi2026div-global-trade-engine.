import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { AcceptInvitationForm, CreateOrganizationForm } from "@/components/forms/onboarding-forms";
import { Badge, Notice } from "@/components/ui/surface";
import { ROLE_LABELS } from "@/lib/authz";
import { requireUser } from "@/lib/auth/session";
import { listMemberships, listPendingInvitations } from "@/server/accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up your organization" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requireUser();
  const [{ welcome }, invitations, memberships] = await Promise.all([searchParams, listPendingInvitations(user), listMemberships(user.id)]);

  return (
    <AuthShell
      title={welcome ? "Welcome aboard" : "Set up your organization"}
      subtitle={`Signed in as ${user.email}`}
      footer={
        <div className="flex items-center justify-center gap-4">
          {memberships.length > 0 && (
            <Link href="/dashboard" className="text-accent hover:underline">
              Go to dashboard
            </Link>
          )}
          <SignOutButton />
        </div>
      }
    >
      <div className="space-y-6">
        {!user.emailVerified && (
          <Notice tone="warning" title="Verify your email">
            We sent a verification link to {user.email}. You can create an organization now; joining an organization you were invited to requires a
            verified email. After verifying, sign out and back in to refresh your status.
          </Notice>
        )}

        {invitations.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Pending invitations</h2>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{i.orgName}</p>
                    <Badge tone="accent">{ROLE_LABELS[i.role]}</Badge>
                  </div>
                  <AcceptInvitationForm invitationId={i.id} disabled={!user.emailVerified} />
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3 text-xs text-faint">
              <span className="h-px flex-1 bg-line" /> or create a new organization <span className="h-px flex-1 bg-line" />
            </div>
          </div>
        )}

        <CreateOrganizationForm />
      </div>
    </AuthShell>
  );
}
