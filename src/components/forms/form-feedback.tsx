import type { FormState } from "@/app/actions/form-state";
import { Notice } from "@/components/ui/surface";

/** Top-of-form success / error message for a server action result. */
export function FormFeedback({ state }: { state: FormState }) {
  if (!state?.message) return null;
  return <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>;
}
