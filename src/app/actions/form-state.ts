export type FormState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of submitted values so forms keep their input after a failed submit. */
  values?: Record<string, string | undefined>;
} | null;
