"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestMeta, tenantForAction } from "@/lib/auth/session";
import { publicError } from "@/lib/errors";
import { billingPortalUrl, changePlan, prepareCheckout } from "@/server/billing";
import type { FormState } from "./form-state";
import { handle } from "./handle";

export type CheckoutResult =
  | { ok: true; environment: "sandbox" | "production"; clientToken: string; priceId: string; email: string; checkoutToken: string }
  | { ok: false; message: string };

/** Returns what Paddle.js needs; the browser opens the checkout overlay. */
export async function prepareCheckoutAction(planKey: string): Promise<CheckoutResult> {
  try {
    const { ctx, user } = await tenantForAction();
    return { ok: true, ...(await prepareCheckout(ctx, planKey, user.email, await requestMeta())) };
  } catch (err) {
    return { ok: false, message: publicError(err).message };
  }
}

export async function changePlanAction(_: FormState, form: FormData): Promise<FormState> {
  return handle(async () => {
    const { ctx } = await tenantForAction();
    await changePlan(ctx, String(form.get("plan") ?? ""), await requestMeta());
    revalidatePath("/settings/billing");
    return { ok: true, message: "Plan change requested. It applies as soon as Paddle confirms it, usually within a minute." };
  });
}

export async function openPortalAction(): Promise<FormState> {
  let url: string | undefined;
  const result = await handle(async () => {
    const { ctx } = await tenantForAction();
    url = await billingPortalUrl(ctx, await requestMeta());
  });
  if (!url) return result;
  redirect(url);
}
