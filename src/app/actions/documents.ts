"use server";

import { revalidatePath } from "next/cache";
import { requestMeta, tenantForAction } from "@/lib/auth/session";
import { approveDocument, confirmField, rejectDocument, reopenDocument, saveDocumentFields } from "@/server/documents";
import type { FormState } from "./form-state";
import { handle } from "./handle";

function fieldValues(form: FormData) {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("f:") && typeof v === "string") out[k.slice(2)] = v;
  return out;
}

export async function saveFieldsAction(_: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("documentId") ?? "");
  const values = fieldValues(form);
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await saveDocumentFields(ctx, id, values, await requestMeta());
    revalidatePath(`/documents/${id}`);
    return { ok: true, message: "Values saved." };
  }, values);
}

export async function confirmFieldAction(_: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("documentId") ?? "");
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await confirmField(ctx, id, String(form.get("fieldKey") ?? ""), await requestMeta());
    revalidatePath(`/documents/${id}`);
    return { ok: true, message: "Value confirmed." };
  });
}

export async function reviewDecisionAction(_: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("documentId") ?? "");
  const decision = String(form.get("decision") ?? "");
  return handle(async () => {
    const { ctx } = await tenantForAction();
    const meta = await requestMeta();
    if (decision === "approve") await approveDocument(ctx, id, meta);
    else if (decision === "reject") await rejectDocument(ctx, id, String(form.get("note") ?? ""), meta);
    else if (decision === "reopen") await reopenDocument(ctx, id, meta);
    else return { ok: false, message: "Unknown action." };
    revalidatePath(`/documents/${id}`);
    revalidatePath("/documents");
    return { ok: true, message: decision === "approve" ? "Document approved." : decision === "reject" ? "Document rejected." : "Document reopened for review." };
  });
}
