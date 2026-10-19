import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthNotConfigured, clientAuthConfig } from "@/components/auth/auth-config";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset password" };

export default async function ForgotPasswordPage() {
  const config = await clientAuthConfig();
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a secure link to choose a new password."
      footer={
        <Link href="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {config ? <ForgotPasswordForm config={config} /> : <AuthNotConfigured />}
    </AuthShell>
  );
}
