import "server-only";
import { authEmulatorHost, firebaseWebConfig } from "@/lib/env";
import type { ClientAuthConfig } from "@/lib/auth/firebase-client";
import { identityProvider } from "@/lib/auth/identity";
import { Notice } from "@/components/ui/surface";

/** Runtime config for the browser auth SDK, or null when auth isn't set up. */
export async function clientAuthConfig(): Promise<ClientAuthConfig | null> {
  const web = firebaseWebConfig();
  const server = (await identityProvider()).configured();
  if (!web || !server) return null;
  return { ...web, emulatorHost: authEmulatorHost() };
}

export function AuthNotConfigured() {
  return (
    <Notice tone="warning" title="Authentication is not configured">
      Set <code className="font-mono text-xs">FIREBASE_WEB_API_KEY</code>, <code className="font-mono text-xs">FIREBASE_AUTH_DOMAIN</code>,{" "}
      <code className="font-mono text-xs">FIREBASE_PROJECT_ID</code> and Firebase Admin credentials (
      <code className="font-mono text-xs">FIREBASE_SERVICE_ACCOUNT_JSON</code>) on the server, then restart. See README → Authentication.
    </Notice>
  );
}
