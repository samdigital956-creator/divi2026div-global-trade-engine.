import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured, clientAuthConfig } from "@/components/auth/auth-config";
import { LoginForm } from "@/components/auth/auth-forms";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  const config = await clientAuthConfig();
  return (
    <AuthShell
      title="Sign in"
      subtitle="Access your organization's shipments and documents."
      footer={
        <>
          New to the platform?{" "}
          <Link href="/register" className="text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {config ? (
        <Suspense>
          <LoginForm config={config} />
        </Suspense>
      ) : (
        <AuthNotConfigured />
      )}
    </AuthShell>
  );
}
