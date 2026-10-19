import type { ZodError } from "zod";

export function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Turn FormData into a plain object, treating empty strings as absent. */
export function formToObject(form: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") out[k] = v.trim() === "" ? undefined : v;
  }
  return out;
}
