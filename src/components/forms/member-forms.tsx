"use client";

import { useActionState } from "react";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from "@/app/actions/org";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

export function InviteForm({ allowAdmin }: { allowAdmin: boolean }) {
  const [state, action] = useActionState(inviteMemberAction, null);
  const v = state?.ok ? {} : (state?.values ?? {});
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormFeedback state={state} />
      <div className="grid gap-4 sm:grid-cols-[1fr_180px_auto] sm:items-end">
        <Field label="Email" name="email" error={e.email}>
          <Input name="email" type="email" defaultValue={v.email} error={e.email} placeholder="colleague@company.com" />
        </Field>
        <Field label="Role" name="role" error={e.role}>
          <Select name="role" defaultValue={v.role ?? "member"}>
            {allowAdmin && <option value="admin">Admin</option>}
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </Select>
        </Field>
        <SubmitButton pendingText="Inviting…">Invite</SubmitButton>
      </div>
    </form>
  );
}

export function RoleSelect({ membershipId, role, disabled }: { membershipId: string; role: string; disabled?: boolean }) {
  const [state, action] = useActionState(changeRoleAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="flex gap-2">
        <Select name="role" defaultValue={role} disabled={disabled} aria-label="Role" className="h-8 w-32 text-xs">
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        {!disabled && (
          <SubmitButton size="sm" variant="ghost">
            Save
          </SubmitButton>
        )}
      </div>
      {state?.message && <p className={`text-xs ${state.ok ? "text-ok" : "text-bad"}`}>{state.message}</p>}
    </form>
  );
}

export function RemoveMemberButton({ membershipId, label }: { membershipId: string; label: string }) {
  const [state, action] = useActionState(removeMemberAction, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Remove ${label} from this organization?`)) e.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="membershipId" value={membershipId} />
      <SubmitButton size="sm" variant="ghost" className="text-bad hover:text-bad">
        Remove
      </SubmitButton>
      {state && !state.ok && <p className="text-xs text-bad">{state.message}</p>}
    </form>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const [state, action] = useActionState(revokeInvitationAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <SubmitButton size="sm" variant="ghost">
        Revoke
      </SubmitButton>
      {state && !state.ok && <p className="text-xs text-bad">{state.message}</p>}
    </form>
  );
}
