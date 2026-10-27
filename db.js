// Database layer: Turso (libSQL over HTTP) in production, local SQLite file otherwise.
// Same async API for both: exec, get, all, run, batch.
const path = require('path');
const fs = require('fs');

const norm = a => a.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

function turso(url, authToken) {
  const { createClient } = require(process.env.LIBSQL_NODE ? '@libsql/client' : '@libsql/client/web');
  const c = createClient({ url, authToken });
  const rows = r => r.rows.map(row => Object.fromEntries(r.columns.map((col, i) => [col, typeof row[i] === 'bigint' ? Number(row[i]) : row[i]])));
  return {
    kind: 'turso',
    exec: sql => c.executeMultiple(sql),
    all: async (sql, ...a) => rows(await c.execute({ sql, args: norm(a) })),
    get: async (sql, ...a) => rows(await c.execute({ sql, args: norm(a) }))[0],
    run: async (sql, ...a) => { const r = await c.execute({ sql, args: norm(a) }); return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null }; },
    batch: async stmts => { if (stmts.length) await c.batch(stmts.map(s => ({ sql: s[0], args: norm(s.slice(1)) })), 'write'); },
  };
}

function local(file) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const st = new Map();
  const p = sql => { let s = st.get(sql); if (!s) { s = d.prepare(sql); st.set(sql, s); } return s; };
  const plain = o => o && { ...o };
  return {
    kind: 'sqlite',
    exec: async sql => d.exec(sql),
    all: async (sql, ...a) => p(sql).all(...norm(a)).map(plain),
    get: async (sql, ...a) => plain(p(sql).get(...norm(a))),
    run: async (sql, ...a) => { const r = p(sql).run(...norm(a)); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
    batch: async stmts => {
      d.exec('BEGIN');
      try { for (const s of stmts) p(s[0]).run(...norm(s.slice(1))); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; }
    },
  };
}

module.exports = function openDb() {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) return turso(url, process.env.TURSO_AUTH_TOKEN);
  return local(process.env.DB_PATH || path.join(__dirname, 'data', 'app.db'));
};
