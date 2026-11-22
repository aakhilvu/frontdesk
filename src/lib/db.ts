import { Pool, type PoolClient, type QueryResultRow } from "pg";

// Reuse one pool across hot reloads (dev) and warm serverless invocations (Vercel).
const g = globalThis as unknown as { __fdPool?: Pool };

function pool(): Pool {
  if (!g.__fdPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    g.__fdPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return g.__fdPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pool().query(text, params)).rows as T[];
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
