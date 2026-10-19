"use client";

import { useActionState } from "react";
import { createTaskAction } from "@/app/actions/shipments";
import { Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function QuickTaskForm({ shipmentId }: { shipmentId?: string }) {
  const [state, action] = useActionState(createTaskAction, null);
  return (
    <form action={action} className="space-y-2 border-t border-line p-4">
      {shipmentId && <input type="hidden" name="shipmentId" value={shipmentId} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="title" placeholder="Add a task…" aria-label="Task title" error={state?.fieldErrors?.title} defaultValue={state?.ok ? "" : state?.values?.title} />
        <Select name="priority" defaultValue="normal" aria-label="Priority" className="sm:w-32">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </Select>
        <SubmitButton size="md" variant="secondary">
          Add
        </SubmitButton>
      </div>
      {state?.message && <p className={`text-xs ${state.ok ? "text-ok" : "text-bad"}`}>{state.fieldErrors?.title ?? state.message}</p>}
    </form>
  );
}
