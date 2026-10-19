"use client";

import { useActionState } from "react";
import { addEventAction } from "@/app/actions/shipments";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function AddEventForm({ shipmentId }: { shipmentId: string }) {
  const [state, action] = useActionState(addEventAction, null);
  const e = state?.fieldErrors ?? {};
  const v = state?.ok ? {} : (state?.values ?? {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <FormFeedback state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" name="eventType">
          <Select name="eventType" defaultValue={v.eventType ?? "note"}>
            <option value="note">Note</option>
            <option value="booking">Booking</option>
            <option value="departure">Departure</option>
            <option value="arrival">Arrival</option>
            <option value="customs">Customs</option>
            <option value="delivery">Delivery</option>
            <option value="issue">Issue</option>
          </Select>
        </Field>
        <Field label="When" name="occurredAt" error={e.occurredAt} hint="Leave empty for now (UTC)">
          <Input type="datetime-local" name="occurredAt" defaultValue={v.occurredAt} error={e.occurredAt} />
        </Field>
      </div>
      <Field label="Description" name="description" error={e.description} required>
        <Input name="description" defaultValue={v.description} error={e.description} placeholder="e.g. Supplier confirmed cargo ready" />
      </Field>
      <Field label="Location" name="location">
        <Input name="location" defaultValue={v.location} />
      </Field>
      <SubmitButton size="sm" variant="secondary" pendingText="Adding…">
        Add to timeline
      </SubmitButton>
    </form>
  );
}
