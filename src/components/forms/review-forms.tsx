"use client";

import { useActionState, useState } from "react";
import { confirmFieldAction, retryExtractionAction, reviewDecisionAction, saveFieldsAction } from "@/app/actions/documents";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge, Notice } from "@/components/ui/surface";
import type { FieldDefinition } from "@/lib/extraction/types";

type FieldValue = {
  value: string | null;
  source: "manual" | "ai" | "ocr";
  confidence: number | null;
  requiresConfirmation: boolean;
  confirmedBy: string | null;
};

export function FieldsForm({
  documentId,
  fields,
  values,
  editable,
  lowConfidence,
}: {
  documentId: string;
  fields: FieldDefinition[];
  values: Record<string, FieldValue>;
  editable: boolean;
  lowConfidence: number;
}) {
  const [state, action] = useActionState(saveFieldsAction, null);
  const e = state?.fieldErrors ?? {};
  const echoed = state?.ok ? {} : (state?.values ?? {});

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="documentId" value={documentId} />
      <FormFeedback state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((def) => {
          const v = values[def.key];
          const name = `f:${def.key}`;
          const defaultValue = echoed[def.key] ?? v?.value ?? "";
          const hint = v ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {v.source === "manual" ? (
                <Badge>Entered{v.confirmedBy ? ` by ${v.confirmedBy}` : ""}</Badge>
              ) : (
                <>
                  <Badge tone={v.requiresConfirmation ? "warn" : "ok"}>{v.requiresConfirmation ? "AI · unconfirmed" : `AI · confirmed by ${v.confirmedBy ?? "reviewer"}`}</Badge>
                  {v.confidence !== null && <Badge tone={v.confidence < lowConfidence ? "bad" : "neutral"}>{Math.round(v.confidence * 100)}% confidence</Badge>}
                </>
              )}
            </span>
          ) : undefined;
          const common = { name, defaultValue, error: e[def.key], disabled: !editable };
          return (
            <Field key={def.key} label={def.label} name={name} required={def.required} error={e[def.key]} hint={hint} className={def.type === "textarea" ? "sm:col-span-2" : undefined}>
              {def.type === "textarea" ? (
                <Textarea {...common} rows={3} />
              ) : (
                <Input {...common} type={def.type === "date" ? "date" : "text"} inputMode={def.type === "number" ? "decimal" : undefined} />
              )}
            </Field>
          );
        })}
      </div>
      {editable && (
        <div className="flex justify-end">
          <SubmitButton variant="secondary" pendingText="Saving…">
            Save values
          </SubmitButton>
        </div>
      )}
    </form>
  );
}

export function ConfirmFieldButton({ documentId, fieldKey }: { documentId: string; fieldKey: string }) {
  const [state, action] = useActionState(confirmFieldAction, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="fieldKey" value={fieldKey} />
      <SubmitButton size="sm" variant="secondary">
        Confirm
      </SubmitButton>
      {state && !state.ok && <span className="text-xs text-bad">{state.message}</span>}
    </form>
  );
}

export function RetryExtractionButton({ documentId, label }: { documentId: string; label: string }) {
  const [state, action] = useActionState(retryExtractionAction, null);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="documentId" value={documentId} />
      <SubmitButton size="sm" variant="secondary" pendingText="Reading document…">
        {label}
      </SubmitButton>
      {state?.message && <p className={`text-xs ${state.ok ? "text-ok" : "text-bad"}`}>{state.message}</p>}
    </form>
  );
}

export function ReviewPanel({
  documentId,
  status,
  blockers,
  canApprove,
}: {
  documentId: string;
  status: "uploaded" | "needs_review" | "approved" | "rejected";
  blockers: string[];
  canApprove: boolean;
}) {
  const [state, action] = useActionState(reviewDecisionAction, null);
  const [rejecting, setRejecting] = useState(false);

  if (!canApprove) {
    return <p className="text-sm text-muted">An admin or owner approves documents. You can enter and save values.</p>;
  }

  return (
    <div className="space-y-4">
      <FormFeedback state={state} />
      {status === "approved" || status === "rejected" ? (
        <form action={action}>
          <input type="hidden" name="documentId" value={documentId} />
          <input type="hidden" name="decision" value="reopen" />
          <SubmitButton variant="secondary" className="w-full">
            Reopen for review
          </SubmitButton>
        </form>
      ) : (
        <>
          {blockers.length > 0 && (
            <Notice tone="warning" title="Before approving">
              <ul className="list-disc space-y-0.5 pl-4">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Notice>
          )}
          <form action={action}>
            <input type="hidden" name="documentId" value={documentId} />
            <input type="hidden" name="decision" value="approve" />
            <SubmitButton className="w-full" disabled={blockers.length > 0} pendingText="Approving…">
              Approve document
            </SubmitButton>
          </form>
          {rejecting ? (
            <form action={action} className="space-y-3">
              <input type="hidden" name="documentId" value={documentId} />
              <input type="hidden" name="decision" value="reject" />
              <Field label="Reason for rejection" name="note" error={state?.fieldErrors?.note}>
                <Textarea name="note" rows={3} placeholder="e.g. Invoice total does not match purchase order" />
              </Field>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
                <SubmitButton variant="danger" className="flex-1" pendingText="Rejecting…">
                  Reject document
                </SubmitButton>
              </div>
            </form>
          ) : (
            <Button type="button" variant="danger" className="w-full" onClick={() => setRejecting(true)}>
              Reject…
            </Button>
          )}
        </>
      )}
      <p className="text-xs text-faint">Approval records that a person checked these values against the document. It is not a customs declaration or classification decision.</p>
    </div>
  );
}
