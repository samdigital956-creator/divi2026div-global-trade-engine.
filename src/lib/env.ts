import "server-only";

/**
 * Server-side configuration. Nothing here is sent to the browser except the
 * Firebase *web* config (which Firebase designs to be public).
 */
function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  get databaseUrl() {
    const url = optional("DATABASE_URL");
    if (!url) throw new Error("DATABASE_URL is not configured");
    return url;
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  /** Secret used to sign short-lived local-storage download tokens. */
  get appSecret() {
    const s = optional("APP_SECRET");
    if (!s || s.length < 32) throw new Error("APP_SECRET must be set to at least 32 characters");
    return s;
  },
  get appUrl() {
    return optional("APP_URL");
  },
};

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
};

export function firebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = optional("FIREBASE_WEB_API_KEY");
  const authDomain = optional("FIREBASE_AUTH_DOMAIN");
  const projectId = optional("FIREBASE_PROJECT_ID");
  if (!apiKey || !authDomain || !projectId) return null;
  return { apiKey, authDomain, projectId, appId: optional("FIREBASE_APP_ID") };
}

/**
 * The Auth emulator accepts unsigned tokens, so it is refused in production
 * unless explicitly allowed for a local production-build smoke test.
 */
export function authEmulatorHost(): string | undefined {
  const host = optional("FIREBASE_AUTH_EMULATOR_HOST");
  if (host && process.env.NODE_ENV === "production" && process.env.ALLOW_AUTH_EMULATOR !== "true") return undefined;
  return host;
}
