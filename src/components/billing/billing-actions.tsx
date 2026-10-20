"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { changePlanAction, openPortalAction, prepareCheckoutAction } from "@/app/actions/billing";
import { FormFeedback } from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/surface";
import { SubmitButton, Spinner } from "@/components/ui/submit-button";

type PaddleGlobal = {
  Environment: { set(env: string): void };
  Initialize(opts: { token: string; eventCallback?: (e: { name?: string }) => void }): void;
  Checkout: { open(opts: unknown): void };
};

const PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";
let paddleReady: Promise<PaddleGlobal> | null = null;

function loadPaddle(environment: string, token: string, onEvent: (name: string) => void): Promise<PaddleGlobal> {
  paddleReady ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PADDLE_JS;
    s.async = true;
    s.onload = () => {
      const P = (window as unknown as { Paddle?: PaddleGlobal }).Paddle;
      if (!P) return reject(new Error("Paddle.js did not load"));
      if (environment === "sandbox") P.Environment.set("sandbox");
      P.Initialize({ token, eventCallback: (e) => e.name && onEvent(e.name) });
      resolve(P);
    };
    s.onerror = () => {
      paddleReady = null;
      reject(new Error("Could not load the payment form. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return paddleReady;
}

/** Opens Paddle's checkout overlay for a plan; the plan changes when Paddle's webhook arrives. */
export function CheckoutButton({ planKey, label }: { planKey: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    const r = await prepareCheckoutAction(planKey);
    if (!r.ok) {
      setError(r.message);
      setBusy(false);
      return;
    }
    try {
      const paddle = await loadPaddle(r.environment, r.clientToken, (name) => {
        if (name === "checkout.completed") {
          setDone(true);
          // Give the webhook a moment, then show the new plan.
          setTimeout(() => router.refresh(), 4000);
        }
      });
      paddle.Checkout.open({
        items: [{ priceId: r.priceId, quantity: 1 }],
        customer: { email: r.email },
        customData: { gtc_checkout: r.checkoutToken },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open checkout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={start} disabled={busy} aria-busy={busy} className="w-full">
        {busy && <Spinner />}
        {busy ? "Opening checkout…" : label}
      </Button>
      {error && <p className="text-xs text-bad">{error}</p>}
      {done && <Notice tone="success">Payment received. Your plan updates as soon as Paddle confirms it.</Notice>}
    </div>
  );
}

export function ChangePlanButton({ planKey, label }: { planKey: string; label: string }) {
  const [state, action] = useActionState(changePlanAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="plan" value={planKey} />
      <SubmitButton variant="secondary" className="w-full" pendingText="Requesting…">
        {label}
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function PortalButton() {
  const [state, action] = useActionState(openPortalAction, null);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="secondary" pendingText="Opening…">
        Manage billing
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
