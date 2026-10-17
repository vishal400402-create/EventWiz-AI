import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
for (const name of files) {
  if ((await db.query('SELECT name FROM schema_migrations WHERE name = $1', [name])).rowCount) continue;
  const sql = await fs.readFile(path.join(directory, name), 'utf8');
  await db.transaction(async (client) => { await client.query(sql); await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]); });
  console.log(`Applied ${name}`);
}
await db.close();
