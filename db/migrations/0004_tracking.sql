-- Phase 4: live container tracking through an external provider (Traqo first).

-- One row per reference (container or B/L) a shipment is tracked by.
CREATE TABLE container_trackings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL,
  shipment_id           uuid NOT NULL,
  -- Provider id from src/lib/tracking (traqo today; vizion, searates, terminal49, carrier APIs later).
  provider              text NOT NULL CHECK (provider ~ '^[a-z0-9_-]{2,32}$'),
  reference             text NOT NULL CHECK (reference ~ '^[A-Z0-9./-]{3,50}$'),
  reference_type        text NOT NULL CHECK (reference_type IN ('container', 'bl')),
  sealine               text CHECK (sealine ~ '^[A-Z]{4}$'),
  sealine_name          text,
  provider_shipment_id  text,
  state                 text NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending', 'active', 'not_found', 'failed', 'delivered', 'stopped')),
  carrier_status        text,
  eta                   timestamptz,
  ata                   timestamptz,
  delivered_at          timestamptz,
  is_delayed            boolean NOT NULL DEFAULT false,
  latitude              double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude             double precision CHECK (longitude BETWEEN -180 AND 180),
  route                 jsonb,          -- [[lat, lng], ...] as reported by the provider
  vessel_name           text,
  vessel_imo            text,
  vessel_mmsi           text,
  origin                text,
  destination           text,
  last_synced_at        timestamptz,    -- provider's carrier sync time
  next_refresh_at       timestamptz,
  last_checked_at       timestamptz,    -- when we last asked the provider
  last_error            text,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, shipment_id, reference),
  FOREIGN KEY (org_id, shipment_id) REFERENCES shipments (org_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_trackings_org_state ON container_trackings (org_id, state);
CREATE INDEX idx_trackings_provider_ref ON container_trackings (provider, reference);
CREATE TRIGGER trg_trackings_updated BEFORE UPDATE ON container_trackings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE container_trackings ENABLE ROW LEVEL SECURITY;
ALTER TABLE container_trackings FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON container_trackings TO gtc_app;
CREATE POLICY tenant_isolation ON container_trackings
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

-- Provider events land on the shipment timeline, de-duplicated by the provider's stable id.
ALTER TABLE shipment_events DROP CONSTRAINT IF EXISTS shipment_events_source_check;
ALTER TABLE shipment_events ADD CONSTRAINT shipment_events_source_check
  CHECK (source ~ '^[a-z0-9_-]{2,32}$');
ALTER TABLE shipment_events
  ADD COLUMN provider_event_uid text,
  ADD COLUMN is_actual boolean;
CREATE UNIQUE INDEX uq_events_provider_uid ON shipment_events (shipment_id, source, provider_event_uid)
  WHERE provider_event_uid IS NOT NULL;

-- Webhook deliveries already processed (at-least-once delivery → dedupe). System table.
CREATE TABLE webhook_deliveries (
  provider     text NOT NULL,
  delivery_id  text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, delivery_id)
);

ALTER TABLE usage_records DROP CONSTRAINT IF EXISTS usage_records_metric_check;
ALTER TABLE usage_records ADD CONSTRAINT usage_records_metric_check
  CHECK (metric IN ('shipment_created', 'document_uploaded', 'storage_bytes', 'ai_extraction', 'tracking_started'));

-- Each tracked reference costs a provider slot, so plans cap it per billing period.
ALTER TABLE subscription_plans ADD COLUMN monthly_tracking_limit integer;  -- NULL = unlimited
UPDATE subscription_plans SET monthly_tracking_limit = 5   WHERE key = 'trial';
UPDATE subscription_plans SET monthly_tracking_limit = 200 WHERE key = 'growth';
