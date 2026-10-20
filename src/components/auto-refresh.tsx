"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetch server data every few seconds while a background job runs. */
export function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);
  return null;
}
