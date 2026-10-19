-- Global Trade & Customs AI Engine — core schema.
-- Every tenant-owned table carries org_id and is protected by RLS (see 0002_rls.sql).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Billing catalogue (global, not tenant-owned)
-- ---------------------------------------------------------------------------
CREATE TABLE subscription_plans (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                      text NOT NULL UNIQUE,
  name                     text NOT NULL,
  monthly_shipment_limit   integer,          -- NULL = unlimited
  monthly_document_limit   integer,
  storage_limit_bytes      bigint,
  seat_limit               integer,
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Limits for the built-in plans. Prices live in the billing provider, not here.
INSERT INTO subscription_plans (key, name, monthly_shipment_limit, monthly_document_limit, storage_limit_bytes, seat_limit) VALUES
  ('trial',      'Trial',      25,   100,  1073741824,   3),
  ('growth',     'Growth',     500,  5000, 53687091200,  25),
  ('enterprise', 'Enterprise', NULL, NULL, NULL,         NULL);

-- ---------------------------------------------------------------------------
-- Identity. Credentials live in the auth provider (Firebase Authentication);
-- this table only maps the provider's stable uid to an internal user id.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider   text NOT NULL DEFAULT 'firebase',
  auth_uid        text NOT NULL,
  email           citext NOT NULL,
  email_verified  boolean NOT NULL DEFAULT false,
  display_name    text,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, auth_uid)
);
CREATE INDEX idx_users_email ON users (email);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organizations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country_code         char(2),
  default_currency     char(3) NOT NULL DEFAULT 'USD',
  timezone             text NOT NULL DEFAULT 'UTC',
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member', 'viewer');

CREATE TABLE organization_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        member_role NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX idx_memberships_user ON organization_memberships (user_id);
CREATE TRIGGER trg_memberships_updated BEFORE UPDATE ON organization_memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE organization_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email        citext NOT NULL,
  role         member_role NOT NULL CHECK (role <> 'owner'),
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_invitations_open ON organization_invitations (org_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_invitations_email ON organization_invitations (email);

CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id                uuid NOT NULL REFERENCES subscription_plans(id),
  status                 text NOT NULL DEFAULT 'trialing'
                         CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  billing_provider       text,          -- e.g. 'stripe' once integrated
  billing_customer_ref   text,
  current_period_start   timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  current_period_end     timestamptz NOT NULL DEFAULT date_trunc('month', now()) + interval '1 month',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_subscriptions_updated BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE usage_records (
  id            bigserial PRIMARY KEY,
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric        text NOT NULL CHECK (metric IN ('shipment_created', 'document_uploaded', 'storage_bytes', 'ai_extraction')),
  quantity      bigint NOT NULL,
  reference_id  uuid,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_org_metric_time ON usage_records (org_id, metric, occurred_at);

-- ---------------------------------------------------------------------------
-- Shipments
-- ---------------------------------------------------------------------------
CREATE TABLE shipments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference             text NOT NULL CHECK (length(reference) BETWEEN 1 AND 64),
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'booked', 'in_transit', 'at_port', 'customs_review', 'cleared', 'delivered', 'cancelled')),
  transport_mode        text NOT NULL CHECK (transport_mode IN ('ocean', 'air', 'road', 'rail', 'multimodal')),
  supplier_name         text,
  origin_country        char(2),
  destination_country   char(2),
  origin_location       text,
  destination_location  text,
  carrier_name          text,
  container_number      text,
  bill_of_lading_number text,
  incoterm              text CHECK (incoterm IN ('EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP')),
  estimated_departure   date,
  estimated_arrival     date,
  notes                 text,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, reference),
  UNIQUE (org_id, id)
);
CREATE INDEX idx_shipments_org_status ON shipments (org_id, status);
CREATE INDEX idx_shipments_org_created ON shipments (org_id, created_at DESC);
CREATE INDEX idx_shipments_org_container ON shipments (org_id, container_number) WHERE container_number IS NOT NULL;
CREATE TRIGGER trg_shipments_updated BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE shipment_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  shipment_id   uuid NOT NULL,
  event_type    text NOT NULL,
  description   text NOT NULL,
  location      text,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  -- 'manual' and 'system' only today. Provider names (e.g. 'vizion') are reserved
  -- for real tracking integrations; nothing in this phase writes them.
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'system', 'vizion', 'searates')),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, shipment_id) REFERENCES shipments (org_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_events_shipment_time ON shipment_events (org_id, shipment_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
-- org_id NULL = built-in type available to every tenant.
CREATE TABLE document_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES organizations(id) ON DELETE CASCADE,
  key           text NOT NULL CHECK (key ~ '^[a-z0-9_]{2,48}$'),
  name          text NOT NULL,
  -- [{ "key": "invoice_number", "label": "Invoice number", "type": "text", "required": true }]
  field_schema  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(field_schema) = 'array'),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_document_types_global ON document_types (key) WHERE org_id IS NULL;
CREATE UNIQUE INDEX uq_document_types_org ON document_types (org_id, key) WHERE org_id IS NOT NULL;
CREATE TRIGGER trg_document_types_updated BEFORE UPDATE ON document_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO document_types (key, name, field_schema) VALUES
('commercial_invoice', 'Commercial invoice', '[
  {"key":"invoice_number","label":"Invoice number","type":"text","required":true},
  {"key":"invoice_date","label":"Invoice date","type":"date","required":true},
  {"key":"seller_name","label":"Seller / exporter","type":"text","required":true},
  {"key":"buyer_name","label":"Buyer / importer","type":"text","required":true},
  {"key":"currency","label":"Currency","type":"text","required":true},
  {"key":"total_value","label":"Total invoice value","type":"number","required":true},
  {"key":"incoterm","label":"Incoterm","type":"text","required":false},
  {"key":"country_of_origin","label":"Country of origin","type":"text","required":false},
  {"key":"goods_description","label":"Goods description","type":"textarea","required":true}
]'),
('packing_list', 'Packing list', '[
  {"key":"packing_list_number","label":"Packing list number","type":"text","required":false},
  {"key":"package_count","label":"Number of packages","type":"number","required":true},
  {"key":"package_type","label":"Package type","type":"text","required":false},
  {"key":"gross_weight_kg","label":"Gross weight (kg)","type":"number","required":true},
  {"key":"net_weight_kg","label":"Net weight (kg)","type":"number","required":false},
  {"key":"volume_cbm","label":"Volume (m³)","type":"number","required":false},
  {"key":"marks_and_numbers","label":"Marks & numbers","type":"textarea","required":false}
]'),
('bill_of_lading', 'Bill of lading', '[
  {"key":"bl_number","label":"B/L number","type":"text","required":true},
  {"key":"shipper","label":"Shipper","type":"text","required":true},
  {"key":"consignee","label":"Consignee","type":"text","required":true},
  {"key":"notify_party","label":"Notify party","type":"text","required":false},
  {"key":"vessel_voyage","label":"Vessel / voyage","type":"text","required":false},
  {"key":"port_of_loading","label":"Port of loading","type":"text","required":true},
  {"key":"port_of_discharge","label":"Port of discharge","type":"text","required":true},
  {"key":"container_numbers","label":"Container number(s)","type":"text","required":false},
  {"key":"issue_date","label":"Date of issue","type":"date","required":false}
]'),
('certificate_of_origin', 'Certificate of origin', '[
  {"key":"certificate_number","label":"Certificate number","type":"text","required":true},
  {"key":"issuing_authority","label":"Issuing authority","type":"text","required":true},
  {"key":"country_of_origin","label":"Country of origin","type":"text","required":true},
  {"key":"exporter","label":"Exporter","type":"text","required":true},
  {"key":"importer","label":"Importer / consignee","type":"text","required":false},
  {"key":"issue_date","label":"Date of issue","type":"date","required":true},
  {"key":"preference_agreement","label":"Trade agreement (if preferential)","type":"text","required":false}
]'),
('other', 'Other shipping document', '[
  {"key":"document_reference","label":"Document reference","type":"text","required":false},
  {"key":"summary","label":"Summary","type":"textarea","required":false}
]');

CREATE TABLE shipment_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  shipment_id         uuid NOT NULL,
  document_type_id    uuid NOT NULL REFERENCES document_types(id),
  original_filename   text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
  storage_key         text NOT NULL UNIQUE,
  mime_type           text NOT NULL,
  size_bytes          bigint NOT NULL CHECK (size_bytes > 0),
  sha256              char(64) NOT NULL,
  status              text NOT NULL DEFAULT 'uploaded'
                      CHECK (status IN ('uploaded', 'needs_review', 'approved', 'rejected')),
  extraction_status   text NOT NULL DEFAULT 'pending'
                      CHECK (extraction_status IN ('pending', 'not_configured', 'processing', 'completed', 'failed', 'manual')),
  extraction_provider text,
  extraction_error    text,
  review_note         text,
  uploaded_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, shipment_id) REFERENCES shipments (org_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_documents_shipment ON shipment_documents (org_id, shipment_id);
CREATE INDEX idx_documents_org_status ON shipment_documents (org_id, status);
CREATE TRIGGER trg_documents_updated BEFORE UPDATE ON shipment_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE extracted_fields (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  document_id            uuid NOT NULL,
  field_key              text NOT NULL,
  value                  text,
  source                 text NOT NULL CHECK (source IN ('manual', 'ai', 'ocr')),
  provider               text,
  confidence             numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  -- Machine-produced values must be confirmed by a person before approval.
  requires_confirmation  boolean NOT NULL DEFAULT false,
  confirmed_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at           timestamptz,
  updated_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, field_key),
  FOREIGN KEY (org_id, document_id) REFERENCES shipment_documents (org_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_fields_org_doc ON extracted_fields (org_id, document_id);
CREATE TRIGGER trg_fields_updated BEFORE UPDATE ON extracted_fields
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Work management
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_id   uuid,
  document_id   uuid,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description   text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_at        timestamptz,
  assigned_to   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, shipment_id) REFERENCES shipments (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, document_id) REFERENCES shipment_documents (org_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_tasks_org_status ON tasks (org_id, status, due_at);
CREATE INDEX idx_tasks_shipment ON tasks (org_id, shipment_id);
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_id   uuid,
  document_id   uuid,
  severity      text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  kind          text NOT NULL,
  message       text NOT NULL,
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, shipment_id) REFERENCES shipments (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, document_id) REFERENCES shipment_documents (org_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_alerts_org_open ON alerts (org_id, created_at DESC) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Integrations: non-secret configuration only. Secrets stay in server env vars
-- (or a secret manager) and are referenced by name in secret_ref.
-- ---------------------------------------------------------------------------
CREATE TABLE integration_configs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category     text NOT NULL CHECK (category IN ('tracking', 'ai', 'ocr', 'tariff', 'messaging', 'billing')),
  provider     text NOT NULL,
  is_enabled   boolean NOT NULL DEFAULT false,
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ref   text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, category, provider)
);
CREATE TRIGGER trg_integrations_updated BEFORE UPDATE ON integration_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log (append-only for the application role; see 0002_rls.sql)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id             bigserial PRIMARY KEY,
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      uuid,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org_time ON audit_logs (org_id, created_at DESC);
CREATE INDEX idx_audit_org_entity ON audit_logs (org_id, entity_type, entity_id);
