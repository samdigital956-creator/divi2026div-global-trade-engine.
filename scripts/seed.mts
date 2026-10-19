/**
 * DEVELOPMENT-ONLY seed data. Creates a clearly labelled demo organization with
 * sample shipments (no documents, no tracking events, no tariff data).
 *
 *   SEED_OWNER_EMAIL=you@example.com npm run db:seed
 *
 * If SEED_OWNER_EMAIL belongs to a user who has signed in at least once, they
 * are made owner of the demo org so they can see it.
 */
import { Client } from "pg";

if (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
  console.error("Refusing to seed a production environment.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const c = new Client({ connectionString: url });
await c.connect();
try {
  await c.query("BEGIN");
  const existing = await c.query("SELECT id FROM organizations WHERE slug = 'demo-imports'");
  if (existing.rowCount) {
    console.log("Demo organization already exists; nothing to do.");
    await c.query("ROLLBACK");
    process.exit(0);
  }
  const seedUser = await c.query(
    `INSERT INTO users (auth_provider, auth_uid, email, email_verified, display_name)
     VALUES ('seed', 'seed-demo-owner', 'demo-owner@example.invalid', true, 'Demo Owner')
     ON CONFLICT (auth_provider, auth_uid) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
  );
  const owner = seedUser.rows[0].id;
  const org = await c.query(
    `INSERT INTO organizations (name, slug, country_code, created_by) VALUES ('Demo Imports (sample data)', 'demo-imports', 'US', $1) RETURNING id`,
    [owner],
  );
  const orgId = org.rows[0].id;
  await c.query(`INSERT INTO organization_memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [orgId, owner]);
  await c.query(`INSERT INTO subscriptions (org_id, plan_id, status) SELECT $1, id, 'trialing' FROM subscription_plans WHERE key = 'trial'`, [orgId]);

  const samples = [
    ["DEMO-001", "ocean", "booked", "Sample Supplier A", "CN", "US", "Yantian", "Long Beach", "FOB"],
    ["DEMO-002", "air", "draft", "Sample Supplier B", "DE", "US", "Frankfurt", "Chicago", "FCA"],
    ["DEMO-003", "ocean", "in_transit", "Sample Supplier C", "VN", "GB", "Hai Phong", "Felixstowe", "CIF"],
  ];
  for (const [ref, mode, status, supplier, oc, dc, ol, dl, inco] of samples) {
    const s = await c.query(
      `INSERT INTO shipments (org_id, reference, transport_mode, status, supplier_name, origin_country, destination_country,
         origin_location, destination_location, incoterm, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Sample record created by the development seed script.',$11) RETURNING id`,
      [orgId, ref, mode, status, supplier, oc, dc, ol, dl, inco, owner],
    );
    await c.query(
      `INSERT INTO shipment_events (org_id, shipment_id, event_type, description, source, created_by)
       VALUES ($1, $2, 'created', 'Sample shipment created by seed script', 'system', $3)`,
      [orgId, s.rows[0].id, owner],
    );
    await c.query(`INSERT INTO usage_records (org_id, metric, quantity, reference_id) VALUES ($1, 'shipment_created', 1, $2)`, [orgId, s.rows[0].id]);
  }

  const email = process.env.SEED_OWNER_EMAIL?.toLowerCase();
  if (email) {
    const u = await c.query("SELECT id FROM users WHERE email = $1 AND auth_provider = 'firebase'", [email]);
    if (u.rowCount) {
      await c.query(`INSERT INTO organization_memberships (org_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, [orgId, u.rows[0].id]);
      console.log(`Added ${email} as owner of the demo organization.`);
    } else {
      console.log(`No signed-in user with email ${email} yet — sign in once, then re-run after deleting the demo org.`);
    }
  }
  await c.query("COMMIT");
  console.log("✓ Seeded demo organization 'Demo Imports (sample data)'.");
} catch (err) {
  await c.query("ROLLBACK");
  console.error(err);
  process.exitCode = 1;
} finally {
  await c.end();
}
