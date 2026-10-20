-- Phase 3: rate limiting, invitation emails, upload malware scanning.

-- Fixed-window counters shared by every app instance. Not tenant data: keys
-- are opaque strings such as "login:ip:1.2.3.4" and rows expire after a day.
CREATE TABLE rate_limit_buckets (
  key           text        NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX idx_rate_limit_window ON rate_limit_buckets (window_start);

-- Delivery status of invitation emails (sent through the configured provider).
ALTER TABLE organization_invitations
  ADD COLUMN email_status text NOT NULL DEFAULT 'not_sent'
    CHECK (email_status IN ('not_sent', 'sent', 'failed', 'not_configured')),
  ADD COLUMN email_sent_at timestamptz,
  ADD COLUMN email_provider_id text;

-- Result of the malware scan performed before a file is stored.
ALTER TABLE shipment_documents
  ADD COLUMN scan_status text NOT NULL DEFAULT 'not_scanned'
    CHECK (scan_status IN ('not_scanned', 'clean')),
  ADD COLUMN scan_engine text,
  ADD COLUMN scanned_at timestamptz;
