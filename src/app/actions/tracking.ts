"use server";

import { revalidatePath } from "next/cache";
import { requestMeta, tenantForAction } from "@/lib/auth/session";
import { refreshTracking, startTracking, stopTracking } from "@/server/tracking";
import { formToObject } from "@/server/validation";
import type { FormState } from "./form-state";
import { handle } from "./handle";

const OUTCOME_MESSAGE: Record<string, string> = {
  not_found: "The carrier has no record of this reference yet. Check the number and carrier, then try again later.",
  limit_reached: "The tracking provider's daily or plan limit has been reached. Try again later.",
};

export async function startTrackingAction(_: FormState, form: FormData): Promise<FormState> {
  const values = formToObject(form);
  const shipmentId = String(form.get("shipmentId") ?? "");
  return handle(async () => {
    const { ctx } = await tenantForAction();
    const r = await startTracking(ctx, shipmentId, values, await requestMeta());
    revalidatePath(`/shipments/${shipmentId}`);
    if (r.outcome === "ok") return { ok: true, message: "Live tracking started." };
    // The tracking row shows the provider's reason, so the form does not repeat it.
    return { ok: false, values };
  }, values);
}

export async function refreshTrackingAction(_: FormState, form: FormData): Promise<FormState> {
  const shipmentId = String(form.get("shipmentId") ?? "");
  return handle(async () => {
    const { ctx } = await tenantForAction();
    const status = await refreshTracking(ctx, String(form.get("trackingId") ?? ""), await requestMeta());
    revalidatePath(`/shipments/${shipmentId}`);
    if (status === "ok") return { ok: true, message: "Tracking refreshed." };
    return { ok: false, message: OUTCOME_MESSAGE[status] ?? "The provider could not be reached. The last known data is shown." };
  });
}

export async function stopTrackingAction(form: FormData) {
  const { ctx } = await tenantForAction();
  await stopTracking(ctx, String(form.get("trackingId") ?? ""), await requestMeta()).catch(() => {});
  revalidatePath(`/shipments/${String(form.get("shipmentId") ?? "")}`);
}
