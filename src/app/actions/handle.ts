import "server-only";
import { unstable_rethrow } from "next/navigation";
import { publicError } from "@/lib/errors";
import type { FormState } from "./form-state";

/** Run a server action body, converting thrown errors into safe form state. */
export async function handle(fn: () => Promise<FormState | void>, values?: Record<string, string | undefined>): Promise<FormState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    unstable_rethrow(err); // let redirect()/notFound() through
    const e = publicError(err);
    return { ok: false, message: e.message, fieldErrors: e.fieldErrors, values };
  }
}
