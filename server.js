// BuyersHQ — media buying performance platform (admin + media buyers)
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
const APP_NAME = process.env.APP_NAME || 'Sellerhub';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.transaction = fn => () => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','buyer')),
  commission_pct REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  country TEXT DEFAULT '',
  currency TEXT DEFAULT 'USD',
  usd_rate REAL DEFAULT 1,           -- 1 unit of local currency = usd_rate USD
  sell_price REAL DEFAULT 0,         -- local currency
  product_cost REAL DEFAULT 0,       -- USD per unit
  call_center_fee REAL DEFAULT 0,    -- USD per confirmed order
  packaging_fee REAL DEFAULT 0,      -- USD per shipped order
  shipping_fee REAL DEFAULT 0,       -- USD per shipped order
  return_fee REAL DEFAULT 0,         -- USD per returned order
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS product_buyers (
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, user_id)
);
CREATE TABLE IF NOT EXISTS daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'Meta',
  spend REAL DEFAULT 0,
  leads INTEGER DEFAULT 0,
  confirmed INTEGER DEFAULT 0,
  cancelled INTEGER DEFAULT 0,
  wrong INTEGER DEFAULT 0,
  duplicate INTEGER DEFAULT 0,
  shipped INTEGER DEFAULT 0,
  delivered INTEGER DEFAULT 0,
  returned INTEGER DEFAULT 0,
  upsells INTEGER DEFAULT 0,
  revenue_override REAL,             -- optional, local currency
  notes TEXT DEFAULT '',
  updated_by INTEGER,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(date, user_id, product_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_stats_date ON daily_stats(date);
CREATE INDEX IF NOT EXISTS idx_stats_user ON daily_stats(user_id);
`);

// Bootstrap first admin
if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
  const u = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const p = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare("INSERT INTO users (username,name,password_hash,role) VALUES (?,?,?,'admin')")
    .run(u, 'Admin', bcrypt.hashSync(p, 10));
  console.log(`[setup] admin created: ${u}${process.env.ADMIN_PASSWORD ? '' : ' / admin123 (CHANGE IT!)'}`);
}

const app = express();
app.disable('x-powered-by');
const jsonParser = express.json({ limit: '5mb' });
app.use((req, res, next) => req.path.startsWith('/hook/') ? next() : jsonParser(req, res, next));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// ---------- auth ----------
const SESSION_DAYS = 14;
const loginAttempts = new Map();

function auth(req, res, next) {
  const t = req.cookies.sid;
  if (!t) return res.status(401).json({ error: 'Non connecté' });
  const row = db.prepare(`SELECT u.id,u.username,u.name,u.role,u.active,u.commission_pct,s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`).get(t);
  if (!row || row.expires_at < Date.now() || !row.active) {
    db.prepare('DELETE FROM sessions WHERE token=?').run(t);
    return res.status(401).json({ error: 'Session expirée' });
  }
  req.user = row;
  next();
}
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Réservé à l’admin' });
const integrations = require('./integrations')({ app, db, auth, admin });

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 min' });
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    a.n++; loginAttempts.set(ip, a);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, u.id, Date.now() + SESSION_DAYS * 864e5);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: SESSION_DAYS * 864e5 });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE token=?').run(req.cookies.sid);
  res.clearCookie('sid'); res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json({ ...req.user, appName: APP_NAME }));
app.post('/api/me/password', auth, (req, res) => {
  const { current, next: nw } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  if (!nw || nw.length < 6) return res.status(400).json({ error: 'Nouveau mot de passe : 6 caractères minimum' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(nw, 10), u.id);
  res.json({ ok: true });
});

// ---------- users (admin) ----------
app.get('/api/users', auth, admin, (req, res) => {
  res.json(db.prepare(`SELECT id,username,name,role,commission_pct,active,created_at,
    (SELECT COUNT(*) FROM product_buyers pb WHERE pb.user_id=users.id) AS products
    FROM users ORDER BY role, name`).all());
});
app.post('/api/users', auth, admin, (req, res) => {
  const { username, name, password, role = 'buyer', commission_pct = 0 } = req.body || {};
  if (!username || !name || !password) return res.status(400).json({ error: 'Identifiant, nom et mot de passe obligatoires' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
  try {
    const r = db.prepare('INSERT INTO users (username,name,password_hash,role,commission_pct) VALUES (?,?,?,?,?)')
      .run(username.trim().toLowerCase(), name.trim(), bcrypt.hashSync(password, 10), role === 'admin' ? 'admin' : 'buyer', +commission_pct || 0);
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: 'Cet identifiant existe déjà' }); }
});
app.put('/api/users/:id', auth, admin, (req, res) => {
  const id = +req.params.id;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'Introuvable' });
  const { name = u.name, commission_pct = u.commission_pct, active = u.active, password, role = u.role } = req.body || {};
  if (id === req.user.id && (!active || role !== 'admin')) return res.status(400).json({ error: 'Vous ne pouvez pas vous bloquer ou vous rétrograder' });
  db.prepare('UPDATE users SET name=?,commission_pct=?,active=?,role=? WHERE id=?').run(name, +commission_pct || 0, active ? 1 : 0, role, id);
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  }
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  res.json({ ok: true });
});
app.delete('/api/users/:id', auth, admin, (req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas vous supprimer' });
  db.prepare('DELETE FROM users WHERE id=?').run(+req.params.id);
  res.json({ ok: true });
});

// ---------- products ----------
const PRODUCT_FIELDS = ['sku', 'name', 'country', 'currency', 'counts_source', 'usd_rate', 'sell_price', 'product_cost', 'call_center_fee', 'packaging_fee', 'shipping_fee', 'return_fee', 'active'];
app.get('/api/products', auth, (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM products ORDER BY active DESC, name').all()
    : db.prepare('SELECT p.* FROM products p JOIN product_buyers pb ON pb.product_id=p.id WHERE pb.user_id=? ORDER BY p.active DESC, p.name').all(req.user.id);
  const assigned = db.prepare('SELECT pb.product_id, u.id, u.name FROM product_buyers pb JOIN users u ON u.id=pb.user_id').all();
  rows.forEach(p => {
    p.buyers = req.user.role === 'admin' ? assigned.filter(a => a.product_id === p.id).map(a => ({ id: a.id, name: a.name })) : undefined;
    p.break_even_cpd = breakEven(p);
  });
  res.json(rows);
});
function breakEven(p) {
  // max ad cost per delivered order before losing money (ignores returns)
  return +(p.sell_price * p.usd_rate - p.product_cost - p.call_center_fee - p.packaging_fee - p.shipping_fee).toFixed(2);
}
function saveProduct(body, id) {
  const v = PRODUCT_FIELDS.map(f => {
    const x = body[f];
    if (f === 'counts_source') return x === 'store' ? 'store' : 'manual';
    if (['sku', 'name', 'country', 'currency'].includes(f)) return String(x ?? '').trim();
    if (f === 'active') return x === undefined ? 1 : (x ? 1 : 0);
    return +x || (f === 'usd_rate' ? 1 : 0);
  });
  if (id) db.prepare(`UPDATE products SET ${PRODUCT_FIELDS.map(f => f + '=?').join(',')} WHERE id=?`).run(...v, id);
  else id = db.prepare(`INSERT INTO products (${PRODUCT_FIELDS.join(',')}) VALUES (${PRODUCT_FIELDS.map(() => '?').join(',')})`).run(...v).lastInsertRowid;
  if (Array.isArray(body.buyer_ids)) {
    db.prepare('DELETE FROM product_buyers WHERE product_id=?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO product_buyers VALUES (?,?)');
    body.buyer_ids.forEach(u => ins.run(id, +u));
  }
  return id;
}
app.post('/api/products', auth, admin, (req, res) => {
  if (!req.body?.sku || !req.body?.name) return res.status(400).json({ error: 'SKU et nom obligatoires' });
  try { res.json({ id: saveProduct(req.body) }); } catch (e) { res.status(400).json({ error: 'Ce SKU existe déjà' }); }
});
app.put('/api/products/:id', auth, admin, (req, res) => {
  try { saveProduct(req.body, +req.params.id); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/products/:id', auth, admin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(+req.params.id); res.json({ ok: true });
});

// ---------- daily stats ----------
const STAT_NUM = ['spend', 'leads', 'confirmed', 'cancelled', 'wrong', 'duplicate', 'shipped', 'delivered', 'returned', 'upsells'];
const PLATFORMS = ['Meta', 'TikTok', 'Google', 'Snapchat', 'Other'];

function canUseProduct(user, productId) {
  if (user.role === 'admin') return true;
  return !!db.prepare('SELECT 1 FROM product_buyers WHERE user_id=? AND product_id=?').get(user.id, productId);
}
function upsertStat(user, b) {
  const userId = user.role === 'admin' && b.user_id ? +b.user_id : user.id;
  const productId = +b.product_id;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw new Error('Date invalide (AAAA-MM-JJ)');
  if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) throw new Error('Produit inconnu');
  if (!canUseProduct(user, productId)) throw new Error('Ce produit ne vous est pas assigné');
  const platform = PLATFORMS.includes(b.platform) ? b.platform : 'Other';
  const nums = STAT_NUM.map(f => Math.max(0, +b[f] || 0));
  const ro = b.revenue_override === '' || b.revenue_override == null ? null : +b.revenue_override;
  const storeCounts = db.prepare('SELECT counts_source FROM products WHERE id=?').get(productId).counts_source === 'store';
  if (storeCounts) {
    db.prepare(`INSERT INTO daily_stats (date,user_id,product_id,platform,spend,wrong,duplicate,revenue_override,notes,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(date,user_id,product_id,platform) DO UPDATE SET
      spend=excluded.spend, wrong=excluded.wrong, duplicate=excluded.duplicate, revenue_override=excluded.revenue_override,
      notes=excluded.notes, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .run(b.date, userId, productId, platform, Math.max(0, +b.spend || 0), Math.max(0, +b.wrong || 0), Math.max(0, +b.duplicate || 0), ro, String(b.notes || ''), user.id);
    integrations.recompute([b.date]);
    return;
  }
  db.prepare(`INSERT INTO daily_stats (date,user_id,product_id,platform,${STAT_NUM.join(',')},revenue_override,notes,updated_by,updated_at)
    VALUES (?,?,?,?,${STAT_NUM.map(() => '?').join(',')},?,?,?,datetime('now'))
    ON CONFLICT(date,user_id,product_id,platform) DO UPDATE SET
    ${STAT_NUM.map(f => `${f}=excluded.${f}`).join(',')},revenue_override=excluded.revenue_override,notes=excluded.notes,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(b.date, userId, productId, platform, ...nums, ro, String(b.notes || ''), user.id);
}
app.post('/api/stats', auth, (req, res) => {
  try { upsertStat(req.user, req.body || {}); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/stats/import', auth, (req, res) => {
  const rows = req.body?.rows || [];
  const bySku = Object.fromEntries(db.prepare('SELECT id,sku FROM products').all().map(p => [p.sku.toLowerCase(), p.id]));
  const byUser = Object.fromEntries(db.prepare('SELECT id,username FROM users').all().map(u => [u.username, u.id]));
  let ok = 0; const errors = [];
  const tx = db.transaction(() => rows.forEach((r, i) => {
    try {
      const product_id = r.product_id || bySku[String(r.sku || '').toLowerCase()];
      if (!product_id) throw new Error(`unknown SKU "${r.sku}"`);
      const user_id = r.username ? byUser[String(r.username).toLowerCase()] : undefined;
      if (r.username && !user_id) throw new Error(`unknown user "${r.username}"`);
      upsertStat(req.user, { ...r, product_id, user_id }); ok++;
    } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
  }));
  tx();
  res.json({ ok, errors: errors.slice(0, 50) });
});
app.delete('/api/stats/:id', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM daily_stats WHERE id=?').get(+req.params.id);
  if (!s) return res.status(404).json({ error: 'Introuvable' });
  if (req.user.role !== 'admin' && s.user_id !== req.user.id) return res.status(403).json({ error: 'Interdit' });
  db.prepare('DELETE FROM daily_stats WHERE id=?').run(s.id); res.json({ ok: true });
});

// filters → SQL
function filters(req) {
  const w = ['s.date BETWEEN ? AND ?']; const p = [req.query.from || '0000-01-01', req.query.to || '9999-12-31'];
  if (req.user.role !== 'admin') { w.push('s.user_id=?'); p.push(req.user.id); }
  else if (req.query.user_id) { w.push('s.user_id=?'); p.push(+req.query.user_id); }
  if (req.query.product_id) { w.push('s.product_id=?'); p.push(+req.query.product_id); }
  if (req.query.platform) { w.push('s.platform=?'); p.push(req.query.platform); }
  if (req.query.country) { w.push('pr.country=?'); p.push(req.query.country); }
  return { where: w.join(' AND '), params: p };
}
// money per row (USD)
const MONEY = `
  COALESCE(s.revenue_override, s.delivered * pr.sell_price) * pr.usd_rate AS revenue,
  s.delivered * pr.product_cost AS cogs,
  s.confirmed * pr.call_center_fee AS cc_fees,
  (s.delivered + s.returned) * (pr.packaging_fee + pr.shipping_fee) AS ship_fees,
  s.returned * pr.return_fee AS return_fees`;
const SUMS = `SUM(spend) spend, SUM(leads) leads, SUM(confirmed) confirmed, SUM(cancelled) cancelled, SUM(wrong) wrong,
  SUM(duplicate) duplicate, SUM(shipped) shipped, SUM(delivered) delivered, SUM(returned) returned, SUM(upsells) upsells,
  SUM(revenue) revenue, SUM(cogs) cogs, SUM(cc_fees) cc_fees, SUM(ship_fees) ship_fees, SUM(return_fees) return_fees, COUNT(*) entries`;

function derive(r) {
  const n = k => +r[k] || 0, div = (a, b) => b ? a / b : null;
  const fees = n('cc_fees') + n('ship_fees') + n('return_fees');
  const profit = n('revenue') - n('cogs') - fees - n('spend');
  return {
    ...r, fees, profit,
    cpl: div(n('spend'), n('leads')),
    cpo: div(n('spend'), n('confirmed')),
    cpd: div(n('spend'), n('delivered')),
    conf_rate: div(n('confirmed'), n('leads')),
    ship_rate: div(n('shipped'), n('confirmed')),
    deliv_rate: div(n('delivered'), n('delivered') + n('returned')),
    deliv_of_conf: div(n('delivered'), n('confirmed')),
    return_rate: div(n('returned'), n('delivered') + n('returned')),
    roas: div(n('revenue'), n('spend')),
    roi: div(profit, n('spend')),
    margin: div(profit, n('revenue')),
    profit_per_order: div(profit, n('delivered')),
    aov: div(n('revenue'), n('delivered')),
  };
}
function agg(req, groupSel, groupBy, orderBy) {
  const { where, params } = filters(req);
  const sql = `SELECT ${groupSel ? groupSel + ',' : ''} ${SUMS} FROM (
      SELECT s.*, pr.name AS pname, pr.sku, pr.country, u.name AS uname, ${MONEY}
      FROM daily_stats s JOIN products pr ON pr.id=s.product_id JOIN users u ON u.id=s.user_id WHERE ${where}) s
      ${groupBy ? 'GROUP BY ' + groupBy : ''} ${orderBy ? 'ORDER BY ' + orderBy : ''}`;
  return db.prepare(sql).all(...params).map(derive);
}

app.get('/api/dashboard', auth, (req, res) => {
  // previous period of same length for deltas
  let prev = null;
  if (req.query.from && req.query.to) {
    const f = new Date(req.query.from + 'T00:00:00Z'), t = new Date(req.query.to + 'T00:00:00Z');
    const days = Math.round((t - f) / 864e5) + 1;
    const pt = new Date(f - 864e5), pf = new Date(f - days * 864e5);
    prev = agg({ ...req, query: { ...req.query, from: pf.toISOString().slice(0, 10), to: pt.toISOString().slice(0, 10) } })[0];
  }
  const isAdmin = req.user.role === 'admin';
  res.json({
    totals: agg(req)[0],
    prev,
    daily: agg(req, 'date', 'date', 'date'),
    products: agg(req, 'product_id, pname, sku, country', 'product_id', 'spend DESC'),
    platforms: agg(req, 'platform', 'platform', 'spend DESC'),
    buyers: isAdmin ? agg(req, 'user_id, uname', 'user_id', 'spend DESC') : [],
    countries: agg(req, 'country', 'country', 'spend DESC'),
  });
});
app.get('/api/stats', auth, (req, res) => {
  const { where, params } = filters(req);
  const rows = db.prepare(`SELECT s.*, pr.name pname, pr.sku, pr.country, u.name uname, ${MONEY}
    FROM daily_stats s JOIN products pr ON pr.id=s.product_id JOIN users u ON u.id=s.user_id
    WHERE ${where} ORDER BY s.date DESC, s.id DESC LIMIT 2000`).all(...params);
  res.json(rows.map(derive));
});

// ---------- settings (announcement, leaderboard visibility) ----------
db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
const getSettings = () => {
  const s = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
  return { announcement: s.announcement || '', leaderboard_public: s.leaderboard_public !== '0', currency_note: s.currency_note || '' };
};
app.get('/api/settings', auth, (req, res) => res.json(getSettings()));
app.put('/api/settings', auth, admin, (req, res) => {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const b = req.body || {};
  if (b.announcement !== undefined) up.run('announcement', String(b.announcement).slice(0, 300));
  if (b.leaderboard_public !== undefined) up.run('leaderboard_public', b.leaderboard_public ? '1' : '0');
  res.json(getSettings());
});

// orders-based filters (same semantics as stats filters)
function orderFilters(req) {
  const w = ['o.date BETWEEN ? AND ?'], p = [req.query.from || '0000-01-01', req.query.to || '9999-12-31'];
  if (req.user.role !== 'admin') { w.push('o.user_id=?'); p.push(req.user.id); }
  else if (req.query.user_id) { w.push('o.user_id=?'); p.push(+req.query.user_id); }
  if (req.query.product_id) { w.push('o.product_id=?'); p.push(+req.query.product_id); }
  if (req.query.platform) { w.push('o.platform=?'); p.push(req.query.platform); }
  if (req.query.country) { w.push('o.product_id IN (SELECT id FROM products WHERE country=?)'); p.push(req.query.country); }
  return { where: w.join(' AND '), params: p };
}
app.get('/api/insights', auth, (req, res) => {
  const { where, params } = orderFilters(req);
  const cities = db.prepare(`SELECT COALESCE(NULLIF(TRIM(o.city),''),'—') city, COUNT(*) orders,
      SUM(o.status='delivered') delivered, SUM(o.status='returned') returned
    FROM orders o WHERE ${where} GROUP BY 1 ORDER BY orders DESC LIMIT 12`).all(...params);
  const dups = db.prepare(`SELECT o.phone, COUNT(*) n, GROUP_CONCAT(o.number, ', ') numbers, MAX(o.customer) customer
    FROM orders o WHERE ${where} AND o.phone<>'' GROUP BY o.phone HAVING n>1 ORDER BY n DESC LIMIT 50`).all(...params);
  const totalOrders = db.prepare(`SELECT COUNT(*) n FROM orders o WHERE ${where}`).get(...params).n;
  res.json({ cities, duplicates: req.user.role === 'admin' ? dups : dups.map(d => ({ ...d, phone: d.phone.slice(0, 4) + '••••' })), dupCount: dups.reduce((a, d) => a + d.n - 1, 0), totalOrders });
});
// Top sellers leaderboard — buyers see rank & performance, never other buyers' money
app.get('/api/leaderboard', auth, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && !getSettings().leaderboard_public) return res.json({ hidden: true, rows: [] });
  const q = { ...req, user: { role: 'admin' }, query: { from: req.query.from, to: req.query.to } };
  const rows = agg(q, 'user_id, uname', 'user_id').filter(r => r.leads > 0)
    .sort((a, b) => (b.profit - a.profit) || (b.delivered - a.delivered));
  res.json({
    rows: rows.map((r, i) => ({
      rank: i + 1, user_id: r.user_id, uname: r.uname, me: r.user_id === req.user.id,
      leads: r.leads, confirmed: r.confirmed, delivered: r.delivered, conf_rate: r.conf_rate, deliv_rate: r.deliv_rate,
      ...(isAdmin || r.user_id === req.user.id ? { spend: r.spend, profit: r.profit, cpd: r.cpd, roas: r.roas } : {}),
    }))
  });
});

app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));
const STATIC = { '/styles.css': 'styles.css', '/app.js': 'app.js', '/ui-integrations.js': 'ui-integrations.js' };
for (const [route, file] of Object.entries(STATIC)) app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
app.get(/^\/(?!api|hook).*/, (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// cleanup expired sessions hourly
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now()), 36e5).unref();
app.set('trust proxy', 1);
app.listen(PORT, () => console.log(`${APP_NAME} running on http://localhost:${PORT}`));
