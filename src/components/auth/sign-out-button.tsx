"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/components/ui/cn";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      className={cn("text-sm text-muted hover:text-ink disabled:opacity-50", className)}
      onClick={async () => {
        setPending(true);
        await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
        router.replace("/login");
        router.refresh();
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
