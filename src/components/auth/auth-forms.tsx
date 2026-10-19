"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "@firebase/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/surface";
import { authErrorMessage, clientAuth, establishServerSession, type ClientAuthConfig } from "@/lib/auth/firebase-client";

function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export function LoginForm({ config }: { config: ClientAuthConfig }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const auth = await clientAuth(config);
      const cred = await signInWithEmailAndPassword(auth, String(fd.get("email")), String(fd.get("password")));
      await establishServerSession(await cred.user.getIdToken());
      await signOut(auth);
      router.replace(safeNext(params.get("next")));
      router.refresh();
    } catch (err) {
      setError(authErrorMessage(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {params.get("reset") && <Notice tone="success">If an account exists for that email, a reset link has been sent.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Work email" name="email">
        <Input name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
      </Field>
      <Field label="Password" name="password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm text-accent hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />} {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export function RegisterForm({ config }: { config: ClientAuthConfig }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    const errs: Record<string, string> = {};
    if (name.length < 2) errs.name = "Enter your full name.";
    if (!/^\S+@\S+\.\S+$/.test(email)) errs.email = "Enter a valid email address.";
    if (password.length < 10) errs.password = "Use at least 10 characters.";
    if (password !== fd.get("confirm")) errs.confirm = "Passwords do not match.";
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setPending(true);
    setError(null);
    try {
      const auth = await clientAuth(config);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await sendEmailVerification(cred.user).catch(() => {});
      await establishServerSession(await cred.user.getIdToken(true));
      await signOut(auth);
      router.replace("/onboarding?welcome=1");
      router.refresh();
    } catch (err) {
      setError(authErrorMessage(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Full name" name="name" error={fieldErrors.name}>
        <Input name="name" autoComplete="name" error={fieldErrors.name} />
      </Field>
      <Field label="Work email" name="email" error={fieldErrors.email}>
        <Input name="email" type="email" autoComplete="email" error={fieldErrors.email} placeholder="you@company.com" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" name="password" error={fieldErrors.password} hint="At least 10 characters.">
          <Input name="password" type="password" autoComplete="new-password" error={fieldErrors.password} />
        </Field>
        <Field label="Confirm password" name="confirm" error={fieldErrors.confirm}>
          <Input name="confirm" type="password" autoComplete="new-password" error={fieldErrors.confirm} />
        </Field>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />} {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-xs text-faint">We&apos;ll send a verification email. Your password is managed by our identity provider and never stored by this application.</p>
    </form>
  );
}

export function ForgotPasswordForm({ config }: { config: ClientAuthConfig }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const auth = await clientAuth(config);
      await sendPasswordResetEmail(auth, email).catch((err) => {
        // Don't reveal whether the account exists.
        if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
      });
      router.replace("/login?reset=1");
    } catch (err) {
      setError(authErrorMessage(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Work email" name="email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />} Send reset link
      </Button>
    </form>
  );
}
