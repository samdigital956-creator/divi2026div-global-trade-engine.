"use client";

import { getApps, initializeApp } from "@firebase/app";
import { connectAuthEmulator, getAuth, inMemoryPersistence, setPersistence, type Auth } from "@firebase/auth";

export type ClientAuthConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
  emulatorHost?: string;
};

let cached: Auth | null = null;

/**
 * Firebase Auth in the browser is used only to sign in and obtain a fresh ID
 * token. Persistence is in-memory: the durable session is the server-issued
 * httpOnly cookie, so no tokens are left in localStorage/IndexedDB.
 */
export async function clientAuth(cfg: ClientAuthConfig): Promise<Auth> {
  if (cached) return cached;
  const app = getApps().find((a) => a.name === "gtc-web") ?? initializeApp(cfg, "gtc-web");
  const auth = getAuth(app);
  if (cfg.emulatorHost) connectAuthEmulator(auth, `http://${cfg.emulatorHost}`, { disableWarnings: true });
  await setPersistence(auth, inMemoryPersistence);
  cached = auth;
  return auth;
}

export async function establishServerSession(idToken: string) {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? "Could not start a session. Please try again.");
  }
}

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
  "auth/weak-password": "Choose a stronger password (at least 10 characters).",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/operation-not-allowed": "Email/password sign-in is not enabled for this project.",
};

export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (err instanceof Error && !code) return err.message;
  return "Something went wrong. Please try again.";
}
