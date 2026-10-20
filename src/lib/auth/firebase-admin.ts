import "server-only";
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { authEmulatorHost } from "@/lib/env";
import type { Identity, IdentityProvider } from "./identity";

/** Max age between sign-in and session creation (Firebase's recommended guard). */
const RECENT_SIGN_IN_SECONDS = 5 * 60;

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey: parsed.private_key };
  }
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return {
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }
  return null;
}

function app(): App {
  const existing = getApps().find((a) => a.name === "gtc");
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (authEmulatorHost()) {
    // The Admin SDK talks to the emulator automatically when this env var is set.
    return initializeApp({ projectId: projectId || "demo-gtc" }, "gtc");
  }
  const sa = serviceAccount();
  if (!sa) throw new Error("Firebase Admin credentials are not configured");
  return initializeApp({ credential: cert(sa), projectId: sa.projectId }, "gtc");
}

export class FirebaseIdentityProvider implements IdentityProvider {
  readonly id = "firebase";

  configured() {
    if (authEmulatorHost()) return true;
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST) return false; // emulator configured but refused (production)
    try {
      return serviceAccount() !== null;
    } catch {
      return false;
    }
  }

  async createSession(idToken: string, expiresIn: number) {
    const auth = getAuth(app());
    const decoded = await auth.verifyIdToken(idToken, true);
    if (Date.now() / 1000 - decoded.auth_time > RECENT_SIGN_IN_SECONDS) {
      throw new Error("Sign-in is not recent enough to create a session");
    }
    if (!decoded.email) throw new Error("Account has no email address");
    const cookie = await auth.createSessionCookie(idToken, { expiresIn });
    const identity: Identity = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
      name: (decoded.name as string | undefined) ?? null,
    };
    return { cookie, identity };
  }

  async verifySession(cookie: string): Promise<Identity | null> {
    try {
      // checkRevoked=true: honours sign-out-everywhere and disabled accounts.
      const decoded = await getAuth(app()).verifySessionCookie(cookie, true);
      if (!decoded.email) return null;
      return {
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified === true,
        name: (decoded.name as string | undefined) ?? null,
      };
    } catch {
      return null;
    }
  }

  async revokeSessions(uid: string) {
    await getAuth(app()).revokeRefreshTokens(uid);
  }
}
