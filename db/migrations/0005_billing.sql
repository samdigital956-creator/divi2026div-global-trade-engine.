-- Phase 5: subscription billing through an external provider (Paddle first).

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'canceled'));

ALTER TABLE subscriptions
  ADD COLUMN billing_subscription_ref text UNIQUE,     -- provider subscription id, e.g. sub_…
  ADD COLUMN cancel_at_period_end    boolean NOT NULL DEFAULT false,
  ADD COLUMN last_billing_event_at   timestamptz;      -- newest provider event applied (out-of-order guard)
