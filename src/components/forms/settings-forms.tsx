"use client";

import { useActionState } from "react";
import { createDocumentTypeAction, updateOrganizationAction } from "@/app/actions/org";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function OrgSettingsForm({ initial, editable }: { initial: Record<string, string | undefined>; editable: boolean }) {
  const [state, action] = useActionState(updateOrganizationAction, null);
  const v = { ...initial, ...(state?.ok ? {} : (state?.values ?? {})) };
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormFeedback state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Organization name" name="name" error={e.name} required>
          <Input name="name" defaultValue={v.name} error={e.name} disabled={!editable} />
        </Field>
        <Field label="Country" name="countryCode" error={e.countryCode} hint="ISO 3166-1 alpha-2">
          <Input name="countryCode" defaultValue={v.countryCode} error={e.countryCode} maxLength={2} className="uppercase" disabled={!editable} />
        </Field>
        <Field label="Default currency" name="defaultCurrency" error={e.defaultCurrency} hint="ISO 4217, e.g. USD">
          <Input name="defaultCurrency" defaultValue={v.defaultCurrency} error={e.defaultCurrency} maxLength={3} className="uppercase" disabled={!editable} />
        </Field>
        <Field label="Time zone" name="timezone" error={e.timezone} hint="IANA name, e.g. Europe/London">
          <Input name="timezone" defaultValue={v.timezone} error={e.timezone} disabled={!editable} />
        </Field>
      </div>
      {editable && (
        <div className="flex justify-end">
          <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
        </div>
      )}
    </form>
  );
}

export function DocumentTypeForm() {
  const [state, action] = useActionState(createDocumentTypeAction, null);
  const v = state?.ok ? {} : (state?.values ?? {});
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormFeedback state={state} />
      <Field label="Type name" name="name" error={e.name} required>
        <Input name="name" defaultValue={v.name} error={e.name} placeholder="Import permit" />
      </Field>
      <Field
        label="Fields"
        name="fields"
        error={e.fields}
        required
        hint={
          <>
            One per line: <code className="font-mono">Label | type | required</code>. Types: text, textarea, number, date.
          </>
        }
      >
        <Textarea name="fields" defaultValue={v.fields} error={e.fields} rows={5} className="font-mono text-xs" placeholder={"Permit number | text | required\nIssuing agency\nExpiry date | date | required"} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton variant="secondary" pendingText="Adding…">
          Add document type
        </SubmitButton>
      </div>
    </form>
  );
}
