import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { config } from './config.js';

type QueryResult<T> = { rows: T[]; rowCount: number | null };
type Client = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<T>>; release(): void };
type Pool = { query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<T>>; connect(): Promise<Client>; end(): Promise<void> };
type PoolConstructor = new (options: { connectionString: string; max: number; idleTimeoutMillis: number }) => Pool;

const require = createRequire(import.meta.url);
const { Pool: PgPool } = require('pg') as { Pool: PoolConstructor };
let pool: Pool | undefined;
function getPool() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL must be configured before EventWiz can access PostgreSQL.');
  pool ??= new PgPool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
  return pool;
}
export const db = {
  query<T = Record<string, unknown>>(sql: string, values: unknown[] = []) { return getPool().query<T>(sql, values); },
  async transaction<T>(work: (client: Client) => Promise<T>) {
    const client = await getPool().connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  },
  async close() { if (pool) await pool.end(); pool = undefined; },
};
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const audit = (userId: string, action: string, subject: string) => db.query('INSERT INTO audit_logs (id,user_id,action,subject,created_at) VALUES ($1,$2,$3,$4,$5)', [id(), userId, action, subject, now()]);
