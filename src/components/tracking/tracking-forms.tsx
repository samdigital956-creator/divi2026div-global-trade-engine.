"use client";

import { useActionState } from "react";
import { refreshTrackingAction, startTrackingAction, stopTrackingAction } from "@/app/actions/tracking";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function StartTrackingForm({ shipmentId, defaultReference, defaultType }: { shipmentId: string; defaultReference?: string | null; defaultType: "container" | "bl" }) {
  const [state, action] = useActionState(startTrackingAction, null);
  const e = state?.fieldErrors ?? {};
  const v = state?.ok ? {} : (state?.values ?? {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <FormFeedback state={state} />
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_8rem]">
        <Field label="Container or B/L number" name="reference" error={e.reference} required>
          <Input name="reference" defaultValue={v.reference ?? defaultReference ?? ""} error={e.reference} placeholder="MSCU1234567" autoComplete="off" className="font-mono uppercase" />
        </Field>
        <Field label="Type" name="referenceType">
          <Select name="referenceType" defaultValue={v.referenceType ?? defaultType}>
            <option value="container">Container</option>
            <option value="bl">Bill of lading</option>
          </Select>
        </Field>
        <Field label="Carrier SCAC" name="sealine" error={e.sealine} hint="Optional">
          <Input name="sealine" defaultValue={v.sealine} error={e.sealine} placeholder="MSCU" maxLength={4} className="font-mono uppercase" />
        </Field>
      </div>
      <SubmitButton size="sm" pendingText="Contacting carrier…">
        Start live tracking
      </SubmitButton>
    </form>
  );
}

export function RefreshTrackingForm({ shipmentId, trackingId }: { shipmentId: string; trackingId: string }) {
  const [state, action] = useActionState(refreshTrackingAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <input type="hidden" name="trackingId" value={trackingId} />
      <SubmitButton size="sm" variant="secondary" pendingText="Refreshing…">
        Refresh
      </SubmitButton>
      {state?.message && !state.ok && <p className="max-w-xs text-right text-xs text-bad">{state.message}</p>}
    </form>
  );
}

export function StopTrackingForm({ shipmentId, trackingId }: { shipmentId: string; trackingId: string }) {
  return (
    <form action={stopTrackingAction}>
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <input type="hidden" name="trackingId" value={trackingId} />
      <SubmitButton size="sm" variant="ghost" pendingText="Stopping…">
        Stop
      </SubmitButton>
    </form>
  );
}
