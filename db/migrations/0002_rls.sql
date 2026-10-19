-- Row Level Security.
--
-- Tenant-scoped requests run inside a transaction that executes
--   SET LOCAL ROLE gtc_app;
--   SELECT set_config('app.org_id', <org uuid>, true);
--   SELECT set_config('app.user_id', <user uuid>, true);
-- (see src/lib/db.ts → withTenant). gtc_app owns nothing and has no BYPASSRLS,
-- so these policies apply even when the pooled connection logs in as a superuser.
-- If app.org_id is unset, app_current_org() is NULL and every policy matches nothing.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gtc_app') THEN
    CREATE ROLE gtc_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- Allow the connecting (migration) user to SET ROLE gtc_app.
DO $$
BEGIN
  EXECUTE format('GRANT gtc_app TO %I', current_user);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not grant gtc_app to %: %', current_user, SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA public TO gtc_app;
GRANT EXECUTE ON FUNCTION app_current_org(), app_current_user() TO gtc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gtc_app;

-- Global read-only catalogue.
GRANT SELECT ON subscription_plans TO gtc_app;

-- Organizations: a tenant can see and edit only itself.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON organizations TO gtc_app;
CREATE POLICY org_self ON organizations
  USING (id = app_current_org()) WITH CHECK (id = app_current_org());

-- Users: visible only when they belong to the current organization.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
GRANT SELECT ON users TO gtc_app;
CREATE POLICY users_same_org ON users FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM organization_memberships m
    WHERE m.user_id = users.id AND m.org_id = app_current_org()
  ));

-- Subscriptions are managed by the system path (billing), read-only to tenants.
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON subscriptions TO gtc_app;
CREATE POLICY subscriptions_tenant ON subscriptions FOR SELECT
  USING (org_id = app_current_org());

-- Usage records: insert + read, never rewritten by the app.
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON usage_records TO gtc_app;
CREATE POLICY usage_tenant ON usage_records
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

-- Audit log: append-only for the application.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON audit_logs TO gtc_app;
CREATE POLICY audit_tenant ON audit_logs
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

-- Document types: built-ins (org_id NULL) are readable by all; custom types are tenant-owned.
ALTER TABLE document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_types FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_types TO gtc_app;
CREATE POLICY doctypes_read ON document_types FOR SELECT
  USING (org_id IS NULL OR org_id = app_current_org());
CREATE POLICY doctypes_insert ON document_types FOR INSERT
  WITH CHECK (org_id = app_current_org());
CREATE POLICY doctypes_update ON document_types FOR UPDATE
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
CREATE POLICY doctypes_delete ON document_types FOR DELETE
  USING (org_id = app_current_org());

-- Plain tenant tables: full CRUD inside the tenant only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization_memberships', 'organization_invitations',
    'shipments', 'shipment_events', 'shipment_documents', 'extracted_fields',
    'tasks', 'alerts', 'integration_configs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO gtc_app', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())',
      t);
  END LOOP;
END $$;
