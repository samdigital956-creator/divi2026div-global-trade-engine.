import "server-only";

/** A verified identity asserted by the external auth provider. */
export type Identity = {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
};

/**
 * Wraps the authentication provider. The application never stores or checks
 * passwords: it only exchanges provider-issued tokens for a provider-managed,
 * revocable session cookie and verifies that cookie on each request.
 */
export interface IdentityProvider {
  readonly id: string;
  configured(): boolean;
  /** Verify a fresh ID token and mint a session cookie. */
  createSession(idToken: string, expiresInMs: number): Promise<{ cookie: string; identity: Identity }>;
  /** Returns null for missing/expired/revoked sessions. */
  verifySession(cookie: string): Promise<Identity | null>;
  /** Revoke all sessions for the user (sign-out everywhere). */
  revokeSessions(uid: string): Promise<void>;
}

let override: IdentityProvider | null = null;
let firebase: IdentityProvider | null = null;

export async function identityProvider(): Promise<IdentityProvider> {
  if (override) return override;
  if (!firebase) {
    const { FirebaseIdentityProvider } = await import("./firebase-admin");
    firebase = new FirebaseIdentityProvider();
  }
  return firebase;
}

export function setIdentityProviderForTesting(p: IdentityProvider | null) {
  override = p;
}
