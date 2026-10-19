import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">The page doesn&apos;t exist, or you don&apos;t have access to it in this organization.</p>
      <ButtonLink href="/dashboard" variant="secondary" className="mt-6">
        Go to dashboard
      </ButtonLink>
    </div>
  );
}
