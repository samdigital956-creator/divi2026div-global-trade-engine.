import { InviteForm, RemoveMemberButton, RevokeInvitationButton, RoleSelect } from "@/components/forms/member-forms";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/surface";
import { Table, Td, Th } from "@/components/ui/table";
import { can, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/authz";
import { requireTenant } from "@/lib/auth/session";
import { formatDate, relativeTime } from "@/lib/format";
import { listMembers } from "@/server/organization";

export const metadata = { title: "Team" };

export default async function MembersPage() {
  const { ctx } = await requireTenant();
  const { members, invitations } = await listMembers(ctx);
  const canManage = can(ctx.role, "members:manage");

  return (
    <>
      <PageHeader title="Team members & roles" description={`${members.length} ${members.length === 1 ? "member" : "members"}`} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {canManage && (
            <Card>
              <CardHeader title="Invite a teammate" description="They sign up (or sign in) with this email, verify it, and accept the invitation during onboarding." />
              <div className="p-5">
                <InviteForm allowAdmin={ctx.role === "owner" || ctx.role === "admin"} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Members" />
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Last sign-in</Th>
                  {canManage && <Th className="text-right">Actions</Th>}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const self = m.userId === ctx.userId;
                  const lockedOwner = m.role === "owner" && ctx.role !== "owner";
                  return (
                    <tr key={m.membershipId}>
                      <Td>
                        <p className="font-medium text-ink">
                          {m.displayName ?? m.email} {self && <span className="text-xs text-muted">(you)</span>}
                        </p>
                        {m.displayName && <p className="text-xs text-muted">{m.email}</p>}
                      </Td>
                      <Td>
                        {canManage && !lockedOwner ? <RoleSelect membershipId={m.membershipId} role={m.role} /> : <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>}
                      </Td>
                      <Td>{m.lastLoginAt ? relativeTime(m.lastLoginAt) : <span className="text-faint">Never</span>}</Td>
                      {canManage && <Td className="text-right">{!lockedOwner && !self && <RemoveMemberButton membershipId={m.membershipId} label={m.displayName ?? m.email} />}</Td>}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader title="Pending invitations" />
            {invitations.length === 0 ? (
              <EmptyState title="No pending invitations" />
            ) : (
              <ul className="divide-y divide-line">
                {invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{i.email}</p>
                      <p className="text-xs text-muted">
                        {ROLE_LABELS[i.role]} · {i.expired ? <span className="text-bad">expired</span> : `expires ${formatDate(i.expiresAt)}`}
                      </p>
                    </div>
                    {canManage && <RevokeInvitationButton invitationId={i.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Roles" />
          <dl className="divide-y divide-line">
            {ROLES.map((r) => (
              <div key={r} className="px-5 py-3">
                <dt className="text-sm font-medium">{ROLE_LABELS[r]}</dt>
                <dd className="mt-0.5 text-sm text-muted">{ROLE_DESCRIPTIONS[r]}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
