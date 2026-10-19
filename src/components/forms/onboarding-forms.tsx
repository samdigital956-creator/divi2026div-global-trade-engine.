"use client";

import { useActionState } from "react";
import { acceptInvitationAction, createOrganizationAction } from "@/app/actions/org";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function CreateOrganizationForm() {
  const [state, action] = useActionState(createOrganizationAction, null);
  const v = state?.values ?? {};
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <FormFeedback state={state} />
      <Field label="Organization name" name="name" error={e.name} required>
        <Input name="name" defaultValue={v.name} error={e.name} placeholder="Acme Imports Ltd" autoFocus />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" name="countryCode" error={e.countryCode} hint="ISO code, e.g. US, GB, AE">
          <Input name="countryCode" defaultValue={v.countryCode} error={e.countryCode} maxLength={2} className="uppercase" />
        </Field>
        <Field label="Default currency" name="defaultCurrency" error={e.defaultCurrency}>
          <Input name="defaultCurrency" defaultValue={v.defaultCurrency ?? "USD"} error={e.defaultCurrency} maxLength={3} className="uppercase" />
        </Field>
      </div>
      <SubmitButton className="w-full" pendingText="Creating workspace…">
        Create organization
      </SubmitButton>
    </form>
  );
}

export function AcceptInvitationForm({ invitationId, disabled }: { invitationId: string; disabled?: boolean }) {
  const [state, action] = useActionState(acceptInvitationAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="invitationId" value={invitationId} />
      <SubmitButton size="sm" disabled={disabled} pendingText="Joining…">
        Accept
      </SubmitButton>
      {state?.message && !state.ok && <p className="text-xs text-bad">{state.message}</p>}
    </form>
  );
}
