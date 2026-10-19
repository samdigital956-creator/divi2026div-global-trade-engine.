import { Client } from "pg";
import { migrate } from "../../scripts/migrate.mjs";

/** Recreate the test database schema from migrations before the suite runs. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/gtc_test";
  if (!/test/.test(new URL(url).pathname)) throw new Error(`Refusing to reset non-test database ${url}`);
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();
  await migrate(url, () => {});
}
