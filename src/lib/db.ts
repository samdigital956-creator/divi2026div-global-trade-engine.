import "server-only";
import { Pool, type PoolClient } from "pg";
import { env } from "./env";
import type { Role } from "./authz";

/** Identity + tenant for a single request, resolved from a verified session. */
export type TenantContext = {
  userId: string;
  orgId: string;
  role: Role;
};

export type Tx = PoolClient;

const globalForPool = globalThis as unknown as { __gtcPool?: Pool };

export function pool(): Pool {
  if (!globalForPool.__gtcPool) {
    globalForPool.__gtcPool = new Pool({
      connectionString: env.databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForPool.__gtcPool;
}

export async function closePool() {
  await globalForPool.__gtcPool?.end();
  globalForPool.__gtcPool = undefined;
}

async function transaction<T>(setup: (c: PoolClient) => Promise<void>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await setup(client);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` as the restricted `gtc_app` role with the tenant bound, so Postgres
 * Row Level Security filters every statement to `ctx.orgId`. Use this for all
 * tenant data access; application-level checks are the first line of defence,
 * RLS is the second.
 */
export function withTenant<T>(ctx: Pick<TenantContext, "orgId" | "userId">, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return transaction(async (c) => {
    await c.query("SET LOCAL ROLE gtc_app");
    await c.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [
      ctx.orgId,
      ctx.userId,
    ]);
  }, fn);
}

/**
 * Trusted system path that is NOT subject to RLS. Only for bootstrap work that
 * has no tenant yet or spans the caller's own memberships (sign-in, listing my
 * organizations, creating an organization, accepting an invitation). Every
 * query here must filter by the verified user id explicitly.
 */
export function systemTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return transaction(async () => {}, fn);
}
