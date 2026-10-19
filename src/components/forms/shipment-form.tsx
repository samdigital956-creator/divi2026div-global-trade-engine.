"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/form-state";
import { FormFeedback } from "@/components/forms/form-feedback";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card, CardHeader } from "@/components/ui/surface";

type Values = Record<string, string | undefined>;
type Options = { statuses: { value: string; label: string }[]; modes: string[]; incoterms: string[] };

export function ShipmentForm({
  action,
  initial = {},
  options,
  submitLabel,
  cancelHref,
  shipmentId,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  initial?: Values;
  options: Options;
  submitLabel: string;
  cancelHref: string;
  shipmentId?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const v = { ...initial, ...(state?.values ?? {}) };
  const e = state?.fieldErrors ?? {};
  const f = (name: string) => ({ name, defaultValue: v[name] ?? "", error: e[name] });

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {shipmentId && <input type="hidden" name="id" value={shipmentId} />}
      <FormFeedback state={state} />

      <Card>
        <CardHeader title="Shipment" description="Your internal reference and how the goods move." />
        <div className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Reference" name="reference" error={e.reference} required hint="PO or internal file number">
            <Input {...f("reference")} placeholder="PO-2026-0142" />
          </Field>
          <Field label="Transport mode" name="transportMode" error={e.transportMode} required>
            <Select {...f("transportMode")}>
              <option value="">Select…</option>
              {options.modes.map((m) => (
                <option key={m} value={m}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" name="status" error={e.status}>
            <Select {...f("status")} defaultValue={v.status ?? "draft"}>
              {options.statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Supplier" name="supplierName" error={e.supplierName}>
            <Input {...f("supplierName")} />
          </Field>
          <Field label="Incoterm" name="incoterm" error={e.incoterm}>
            <Select {...f("incoterm")}>
              <option value="">—</option>
              {options.incoterms.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </Select>
          </Field>
          <Field label="Carrier" name="carrierName" error={e.carrierName}>
            <Input {...f("carrierName")} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Route & schedule" description="Dates are your planned estimates — no live tracking is connected yet." />
        <div className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Origin country" name="originCountry" error={e.originCountry} hint="ISO code, e.g. CN">
            <Input {...f("originCountry")} maxLength={2} className="uppercase" />
          </Field>
          <Field label="Origin port / place" name="originLocation" error={e.originLocation}>
            <Input {...f("originLocation")} placeholder="Yantian" />
          </Field>
          <Field label="Destination country" name="destinationCountry" error={e.destinationCountry} hint="ISO code, e.g. US">
            <Input {...f("destinationCountry")} maxLength={2} className="uppercase" />
          </Field>
          <Field label="Destination port / place" name="destinationLocation" error={e.destinationLocation}>
            <Input {...f("destinationLocation")} placeholder="Long Beach" />
          </Field>
          <Field label="Estimated departure" name="estimatedDeparture" error={e.estimatedDeparture}>
            <Input type="date" {...f("estimatedDeparture")} />
          </Field>
          <Field label="Estimated arrival" name="estimatedArrival" error={e.estimatedArrival}>
            <Input type="date" {...f("estimatedArrival")} />
          </Field>
          <Field label="Container number" name="containerNumber" error={e.containerNumber} hint="ISO 6346, e.g. MSCU1234567">
            <Input {...f("containerNumber")} className="uppercase" maxLength={11} />
          </Field>
          <Field label="Bill of lading no." name="billOfLadingNumber" error={e.billOfLadingNumber}>
            <Input {...f("billOfLadingNumber")} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Notes" />
        <div className="p-5">
          <Field label="Internal notes" name="notes" error={e.notes}>
            <Textarea {...f("notes")} rows={4} />
          </Field>
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
        <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
