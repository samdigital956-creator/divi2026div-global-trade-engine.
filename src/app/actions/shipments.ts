"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestMeta, tenantForAction } from "@/lib/auth/session";
import { addShipmentEvent, createShipment, updateShipment } from "@/server/shipments";
import { completeTask, createTask } from "@/server/work";
import { formToObject } from "@/server/validation";
import type { FormState } from "./form-state";
import { handle } from "./handle";

export async function createShipmentAction(_: FormState, form: FormData): Promise<FormState> {
  const values = formToObject(form);
  let id: string | undefined;
  const result = await handle(async () => {
    const { ctx } = await tenantForAction();
    id = await createShipment(ctx, values, await requestMeta());
  }, values);
  if (!id) return result;
  revalidatePath("/shipments");
  redirect(`/shipments/${id}?created=1`);
}

export async function updateShipmentAction(_: FormState, form: FormData): Promise<FormState> {
  const values = formToObject(form);
  const id = String(form.get("id") ?? "");
  let done = false;
  const result = await handle(async () => {
    const { ctx } = await tenantForAction();
    await updateShipment(ctx, id, values, await requestMeta());
    done = true;
  }, values);
  if (!done) return result;
  revalidatePath(`/shipments/${id}`);
  redirect(`/shipments/${id}?updated=1`);
}

export async function addEventAction(_: FormState, form: FormData): Promise<FormState> {
  const values = formToObject(form);
  const id = String(form.get("shipmentId") ?? "");
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await addShipmentEvent(ctx, id, values, await requestMeta());
    revalidatePath(`/shipments/${id}`);
    return { ok: true, message: "Event added to the timeline." };
  }, values);
}

export async function createTaskAction(_: FormState, form: FormData): Promise<FormState> {
  const values = formToObject(form);
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await createTask(ctx, values, await requestMeta());
    revalidatePath("/", "layout");
    return { ok: true, message: "Task created." };
  }, values);
}

export async function completeTaskAction(form: FormData) {
  const { ctx } = await tenantForAction();
  await completeTask(ctx, String(form.get("taskId") ?? ""), await requestMeta()).catch(() => {});
  revalidatePath("/", "layout");
}
