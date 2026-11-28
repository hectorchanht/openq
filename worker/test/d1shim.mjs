// Minimal D1 shim over node:sqlite for the worker tests: implements the
// prepare().bind().first()/run()/all() surface that @dawn-studio/auth's
// createD1Store and the worker's own claim queries use, backed by a real
// in-memory SQLite database running the real schema.sql.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export function makeTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(path.join(here, '..', 'schema.sql'), 'utf8'));
  return {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          const row = db.prepare(sql).get(...args);
          return row ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all(...args) };
        },
        async run() {
          const r = db.prepare(sql).run(...args);
          return { meta: { changes: r.changes } };
        },
      };
      return stmt;
    },
    _raw: db,
  };
}
