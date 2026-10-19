"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/surface";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  const digest = (error as { digest?: string })?.digest;
  return (
    <div className="mx-auto max-w-lg py-16">
      <Notice tone="error" title="This page could not be loaded">
        An unexpected error occurred while loading data. No changes were made.
        {digest && <span className="mt-1 block font-mono text-xs text-faint">Reference: {digest}</span>}
      </Notice>
      <Button variant="secondary" className="mt-4" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
