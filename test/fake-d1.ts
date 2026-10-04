// A small stand-in for Cloudflare D1 over Node's built-in SQLite, enough for the job store's
// queries: prepare().bind().run() / first() / all(), with meta.changes on run() like D1.
// The real migrations are applied, so the schema under test is the deployed one.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Value = string | number | null;

export function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(dir, file), 'utf8'));
  }

  const statement = (sql: string, params: Value[] = []) => ({
    bind: (...values: Value[]) => statement(sql, values),
    async run() {
      const info = db.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(info.changes) }, results: [] };
    },
    async first<T>() {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async all<T>() {
      return { success: true, meta: {}, results: db.prepare(sql).all(...params) as T[] };
    },
  });

  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}
