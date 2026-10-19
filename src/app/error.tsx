"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  const digest = (error as { digest?: string })?.digest;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        An unexpected error occurred. Your data has not been changed.
        {digest && <span className="mt-1 block font-mono text-xs text-faint">Reference: {digest}</span>}
      </p>
      <Button variant="secondary" className="mt-6" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
