import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured, clientAuthConfig } from "@/components/auth/auth-config";
import { RegisterForm } from "@/components/auth/auth-forms";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/onboarding");
  const config = await clientAuthConfig();
  return (
    <AuthShell
      title="Create your account"
      subtitle="Start managing import documentation with your team."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {config ? <RegisterForm config={config} /> : <AuthNotConfigured />}
    </AuthShell>
  );
}
