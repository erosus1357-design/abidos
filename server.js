// Sellerhub — media buying performance platform (admin + media buyers)
const express = require('express');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const openDb = require('./db');

const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || 'Sellerhub';
const db = openDb();

const SCHEMA = `
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
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  country TEXT DEFAULT '',
  currency TEXT DEFAULT 'USD',
  usd_rate REAL DEFAULT 1,
  sell_price REAL DEFAULT 0,
  product_cost REAL DEFAULT 0,
  call_center_fee REAL DEFAULT 0,
  packaging_fee REAL DEFAULT 0,
  shipping_fee REAL DEFAULT 0,
  return_fee REAL DEFAULT 0,
  counts_source TEXT DEFAULT 'manual',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS product_buyers (
  product_id INTEGER,
  user_id INTEGER,
  PRIMARY KEY (product_id, user_id)
);
CREATE TABLE IF NOT EXISTS daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
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
  revenue_override REAL,
  notes TEXT DEFAULT '',
  updated_by INTEGER,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(date, user_id, product_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_stats_date ON daily_stats(date);
CREATE INDEX IF NOT EXISTS idx_stats_user ON daily_stats(user_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(require('compression')());
const jsonParser = express.json({ limit: '5mb' });
app.use((req, res, next) => req.path.startsWith('/hook/') ? next() : jsonParser(req, res, next));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.get('/healthz', (req, res) => res.send('ok'));

// ---------- auth ----------
const SESSION_DAYS = 14;
const loginAttempts = new Map();

async function auth(req, res, next) {
  try {
    const t = req.cookies.sid;
    if (!t) return res.status(401).json({ error: 'Non connecté' });
    const row = await db.get(`SELECT u.id,u.username,u.name,u.role,u.active,u.commission_pct,s.expires_at
      FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`, t);
    if (!row || row.expires_at < Date.now() || !row.active) {
      await db.run('DELETE FROM sessions WHERE token=?', t);
      return res.status(401).json({ error: 'Session expirée' });
    }
    req.user = row;
    next();
  } catch (e) { next(e); }
}
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Réservé à l’admin' });
const integrations = require('./integrations')({ app, db, auth, admin });

app.post('/api/login', async (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 min' });
  const { username, password } = req.body || {};
  const u = await db.get('SELECT * FROM users WHERE username=? AND active=1', String(username || '').trim().toLowerCase());
  if (!u || !await bcrypt.compare(String(password || ''), u.password_hash)) {
    a.n++; loginAttempts.set(ip, a);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)', token, u.id, Date.now() + SESSION_DAYS * 864e5);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: SESSION_DAYS * 864e5 });
  res.json({ ok: true });
});
app.post('/api/logout', async (req, res) => {
  if (req.cookies.sid) await db.run('DELETE FROM sessions WHERE token=?', req.cookies.sid);
  res.clearCookie('sid'); res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json({ ...req.user, appName: APP_NAME }));
app.post('/api/me/password', auth, async (req, res) => {
  const { current, next: nw } = req.body || {};
  const u = await db.get('SELECT * FROM users WHERE id=?', req.user.id);
  if (!await bcrypt.compare(String(current || ''), u.password_hash)) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  if (!nw || nw.length < 6) return res.status(400).json({ error: 'Nouveau mot de passe : 6 caractères minimum' });
  await db.run('UPDATE users SET password_hash=? WHERE id=?', await bcrypt.hash(nw, 10), u.id);
  res.json({ ok: true });
});

// ---------- users (admin) ----------
app.get('/api/users', auth, admin, async (req, res) => {
  res.json(await db.all(`SELECT id,username,name,role,commission_pct,active,created_at,
    (SELECT COUNT(*) FROM product_buyers pb WHERE pb.user_id=users.id) AS products
    FROM users ORDER BY role, name`));
});
app.post('/api/users', auth, admin, async (req, res) => {
  const { username, name, password, role = 'buyer', commission_pct = 0 } = req.body || {};
  if (!username || !name || !password) return res.status(400).json({ error: 'Identifiant, nom et mot de passe obligatoires' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
  try {
    const r = await db.run('INSERT INTO users (username,name,password_hash,role,commission_pct) VALUES (?,?,?,?,?)',
      username.trim().toLowerCase(), name.trim(), await bcrypt.hash(password, 10), role === 'admin' ? 'admin' : 'buyer', +commission_pct || 0);
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: 'Cet identifiant existe déjà' }); }
});
app.put('/api/users/:id', auth, admin, async (req, res) => {
  const id = +req.params.id;
  const u = await db.get('SELECT * FROM users WHERE id=?', id);
  if (!u) return res.status(404).json({ error: 'Introuvable' });
  const { name = u.name, commission_pct = u.commission_pct, active = u.active, password, role = u.role } = req.body || {};
  if (id === req.user.id && (!active || role !== 'admin')) return res.status(400).json({ error: 'Vous ne pouvez pas vous bloquer ou vous rétrograder' });
  if (password && password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
  await db.run('UPDATE users SET name=?,commission_pct=?,active=?,role=? WHERE id=?', name, +commission_pct || 0, active ? 1 : 0, role, id);
  if (password) {
    await db.run('UPDATE users SET password_hash=? WHERE id=?', await bcrypt.hash(password, 10), id);
    await db.run('DELETE FROM sessions WHERE user_id=?', id);
  }
  if (!active) await db.run('DELETE FROM sessions WHERE user_id=?', id);
  res.json({ ok: true });
});
app.delete('/api/users/:id', auth, admin, async (req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas vous supprimer' });
  await db.batch([
    ['DELETE FROM sessions WHERE user_id=?', id], ['DELETE FROM product_buyers WHERE user_id=?', id], ['DELETE FROM daily_stats WHERE user_id=?', id],
    ['UPDATE orders SET user_id=NULL WHERE user_id=?', id], ['UPDATE integrations SET default_user_id=NULL WHERE default_user_id=?', id], ['DELETE FROM users WHERE id=?', id],
  ]);
  res.json({ ok: true });
});

// ---------- products ----------
const PRODUCT_FIELDS = ['sku', 'name', 'country', 'currency', 'counts_source', 'usd_rate', 'sell_price', 'product_cost', 'call_center_fee', 'packaging_fee', 'shipping_fee', 'return_fee', 'active'];
const breakEven = p => +(p.sell_price * p.usd_rate - p.product_cost - p.call_center_fee - p.packaging_fee - p.shipping_fee).toFixed(2);
app.get('/api/products', auth, async (req, res) => {
  const rows = req.user.role === 'admin'
    ? await db.all('SELECT * FROM products ORDER BY active DESC, name')
    : await db.all('SELECT p.* FROM products p JOIN product_buyers pb ON pb.product_id=p.id WHERE pb.user_id=? ORDER BY p.active DESC, p.name', req.user.id);
  const assigned = req.user.role === 'admin' ? await db.all('SELECT pb.product_id, u.id, u.name FROM product_buyers pb JOIN users u ON u.id=pb.user_id') : [];
  rows.forEach(p => {
    p.buyers = req.user.role === 'admin' ? assigned.filter(a => a.product_id === p.id).map(a => ({ id: a.id, name: a.name })) : undefined;
    p.break_even_cpd = breakEven(p);
  });
  res.json(rows);
});
async function saveProduct(body, id) {
  const v = PRODUCT_FIELDS.map(f => {
    const x = body[f];
    if (f === 'counts_source') return x === 'store' ? 'store' : 'manual';
    if (['sku', 'name', 'country', 'currency'].includes(f)) return String(x ?? '').trim();
    if (f === 'active') return x === undefined ? 1 : (x ? 1 : 0);
    return +x || (f === 'usd_rate' ? 1 : 0);
  });
  if (id) await db.run(`UPDATE products SET ${PRODUCT_FIELDS.map(f => f + '=?').join(',')} WHERE id=?`, ...v, id);
  else id = (await db.run(`INSERT INTO products (${PRODUCT_FIELDS.join(',')}) VALUES (${PRODUCT_FIELDS.map(() => '?').join(',')})`, ...v)).lastInsertRowid;
  if (Array.isArray(body.buyer_ids)) {
    await db.batch([['DELETE FROM product_buyers WHERE product_id=?', id], ...body.buyer_ids.map(u => ['INSERT OR IGNORE INTO product_buyers (product_id,user_id) VALUES (?,?)', id, +u])]);
  }
  return id;
}
app.post('/api/products', auth, admin, async (req, res) => {
  if (!req.body?.sku || !req.body?.name) return res.status(400).json({ error: 'SKU et nom obligatoires' });
  try { res.json({ id: await saveProduct(req.body) }); } catch (e) { res.status(400).json({ error: 'Ce SKU existe déjà' }); }
});
app.put('/api/products/:id', auth, admin, async (req, res) => {
  try { await saveProduct(req.body, +req.params.id); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'Ce SKU existe déjà' : e.message }); }
});
app.delete('/api/products/:id', auth, admin, async (req, res) => {
  const id = +req.params.id;
  await db.batch([
    ['DELETE FROM product_buyers WHERE product_id=?', id], ['DELETE FROM daily_stats WHERE product_id=?', id],
    ['UPDATE store_products SET product_id=NULL WHERE product_id=?', id], ['UPDATE orders SET product_id=NULL WHERE product_id=?', id], ['DELETE FROM products WHERE id=?', id],
  ]);
  res.json({ ok: true });
});

// ---------- daily stats ----------
const STAT_NUM = ['spend', 'leads', 'confirmed', 'cancelled', 'wrong', 'duplicate', 'shipped', 'delivered', 'returned', 'upsells'];
const PLATFORMS = ['Meta', 'TikTok', 'Google', 'Snapchat', 'Other'];

async function upsertStat(user, b) {
  const userId = user.role === 'admin' && b.user_id ? +b.user_id : user.id;
  const productId = +b.product_id;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw new Error('Date invalide (AAAA-MM-JJ)');
  const product = await db.get('SELECT id, counts_source FROM products WHERE id=?', productId);
  if (!product) throw new Error('Produit inconnu');
  if (user.role !== 'admin' && !await db.get('SELECT 1 x FROM product_buyers WHERE user_id=? AND product_id=?', user.id, productId)) throw new Error('Ce produit ne vous est pas assigné');
  const platform = PLATFORMS.includes(b.platform) ? b.platform : 'Other';
  const nums = STAT_NUM.map(f => Math.max(0, +b[f] || 0));
  const ro = b.revenue_override === '' || b.revenue_override == null ? null : +b.revenue_override;
  if (product.counts_source === 'store') {
    await db.run(`INSERT INTO daily_stats (date,user_id,product_id,platform,spend,wrong,duplicate,revenue_override,notes,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(date,user_id,product_id,platform) DO UPDATE SET
      spend=excluded.spend, wrong=excluded.wrong, duplicate=excluded.duplicate, revenue_override=excluded.revenue_override,
      notes=excluded.notes, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
      b.date, userId, productId, platform, Math.max(0, +b.spend || 0), Math.max(0, +b.wrong || 0), Math.max(0, +b.duplicate || 0), ro, String(b.notes || ''), user.id);
    await integrations.recompute([b.date]);
    return;
  }
  await db.run(`INSERT INTO daily_stats (date,user_id,product_id,platform,${STAT_NUM.join(',')},revenue_override,notes,updated_by,updated_at)
    VALUES (?,?,?,?,${STAT_NUM.map(() => '?').join(',')},?,?,?,datetime('now'))
    ON CONFLICT(date,user_id,product_id,platform) DO UPDATE SET
    ${STAT_NUM.map(f => `${f}=excluded.${f}`).join(',')},revenue_override=excluded.revenue_override,notes=excluded.notes,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    b.date, userId, productId, platform, ...nums, ro, String(b.notes || ''), user.id);
}
app.post('/api/stats', auth, async (req, res) => {
  try { await upsertStat(req.user, req.body || {}); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/stats/import', auth, async (req, res) => {
  const rows = req.body?.rows || [];
  const bySku = Object.fromEntries((await db.all('SELECT id,sku FROM products')).map(p => [p.sku.toLowerCase(), p.id]));
  const byUser = Object.fromEntries((await db.all('SELECT id,username FROM users')).map(u => [u.username, u.id]));
  let ok = 0; const errors = [];
  for (const [i, r] of rows.entries()) {
    try {
      const product_id = r.product_id || bySku[String(r.sku || '').toLowerCase()];
      if (!product_id) throw new Error(`SKU inconnu "${r.sku}"`);
      const user_id = r.username ? byUser[String(r.username).toLowerCase()] : undefined;
      if (r.username && !user_id) throw new Error(`utilisateur inconnu "${r.username}"`);
      await upsertStat(req.user, { ...r, product_id, user_id }); ok++;
    } catch (e) { errors.push(`Ligne ${i + 2} : ${e.message}`); }
  }
  res.json({ ok, errors: errors.slice(0, 50) });
});
app.delete('/api/stats/:id', auth, async (req, res) => {
  const s = await db.get('SELECT * FROM daily_stats WHERE id=?', +req.params.id);
  if (!s) return res.status(404).json({ error: 'Introuvable' });
  if (req.user.role !== 'admin' && s.user_id !== req.user.id) return res.status(403).json({ error: 'Interdit' });
  await db.run('DELETE FROM daily_stats WHERE id=?', s.id); res.json({ ok: true });
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
    cpl: div(n('spend'), n('leads')), cpo: div(n('spend'), n('confirmed')), cpd: div(n('spend'), n('delivered')),
    conf_rate: div(n('confirmed'), n('leads')), ship_rate: div(n('shipped'), n('confirmed')),
    deliv_rate: div(n('delivered'), n('delivered') + n('returned')), deliv_of_conf: div(n('delivered'), n('confirmed')),
    return_rate: div(n('returned'), n('delivered') + n('returned')),
    roas: div(n('revenue'), n('spend')), roi: div(profit, n('spend')), margin: div(profit, n('revenue')),
    profit_per_order: div(profit, n('delivered')), aov: div(n('revenue'), n('delivered')),
  };
}
async function agg(req, groupSel, groupBy, orderBy) {
  const { where, params } = filters(req);
  const sql = `SELECT ${groupSel ? groupSel + ',' : ''} ${SUMS} FROM (
      SELECT s.*, pr.name AS pname, pr.sku, pr.country, u.name AS uname, ${MONEY}
      FROM daily_stats s JOIN products pr ON pr.id=s.product_id JOIN users u ON u.id=s.user_id WHERE ${where}) s
      ${groupBy ? 'GROUP BY ' + groupBy : ''} ${orderBy ? 'ORDER BY ' + orderBy : ''}`;
  return (await db.all(sql, ...params)).map(derive);
}

app.get('/api/dashboard', auth, async (req, res) => {
  let prevP = Promise.resolve([null]);
  if (req.query.from && req.query.to) {
    const f = new Date(req.query.from + 'T00:00:00Z'), t = new Date(req.query.to + 'T00:00:00Z');
    const days = Math.round((t - f) / 864e5) + 1;
    const pt = new Date(f - 864e5), pf = new Date(f - days * 864e5);
    prevP = agg({ ...req, user: req.user, query: { ...req.query, from: pf.toISOString().slice(0, 10), to: pt.toISOString().slice(0, 10) } });
  }
  const isAdmin = req.user.role === 'admin';
  const [totals, prev, daily, products, platforms, buyers, countries] = await Promise.all([
    agg(req), prevP, agg(req, 'date', 'date', 'date'),
    agg(req, 'product_id, pname, sku, country', 'product_id', 'spend DESC'),
    agg(req, 'platform', 'platform', 'spend DESC'),
    isAdmin ? agg(req, 'user_id, uname', 'user_id', 'spend DESC') : [],
    agg(req, 'country', 'country', 'spend DESC'),
  ]);
  res.json({ totals: totals[0], prev: prev[0], daily, products, platforms, buyers, countries });
});
app.get('/api/stats', auth, async (req, res) => {
  const { where, params } = filters(req);
  const rows = await db.all(`SELECT s.*, pr.name pname, pr.sku, pr.country, u.name uname, ${MONEY}
    FROM daily_stats s JOIN products pr ON pr.id=s.product_id JOIN users u ON u.id=s.user_id
    WHERE ${where} ORDER BY s.date DESC, s.id DESC LIMIT 2000`, ...params);
  res.json(rows.map(derive));
});

// ---------- settings (announcement, leaderboard visibility) ----------
const getSettings = async () => {
  const s = Object.fromEntries((await db.all('SELECT key, value FROM settings')).map(r => [r.key, r.value]));
  return { announcement: s.announcement || '', leaderboard_public: s.leaderboard_public !== '0' };
};
app.get('/api/settings', auth, async (req, res) => res.json(await getSettings()));
app.put('/api/settings', auth, admin, async (req, res) => {
  const up = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value';
  const b = req.body || {};
  if (b.announcement !== undefined) await db.run(up, 'announcement', String(b.announcement).slice(0, 300));
  if (b.leaderboard_public !== undefined) await db.run(up, 'leaderboard_public', b.leaderboard_public ? '1' : '0');
  res.json(await getSettings());
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
app.get('/api/insights', auth, async (req, res) => {
  const { where, params } = orderFilters(req);
  const [cities, dups, total] = await Promise.all([
    db.all(`SELECT COALESCE(NULLIF(TRIM(o.city),''),'—') city, COUNT(*) orders,
      SUM(o.status='delivered') delivered, SUM(o.status='returned') returned
      FROM orders o WHERE ${where} GROUP BY 1 ORDER BY orders DESC LIMIT 12`, ...params),
    db.all(`SELECT o.phone, COUNT(*) n, GROUP_CONCAT(o.number, ', ') numbers, MAX(o.customer) customer
      FROM orders o WHERE ${where} AND o.phone<>'' GROUP BY o.phone HAVING n>1 ORDER BY n DESC LIMIT 50`, ...params),
    db.get(`SELECT COUNT(*) n FROM orders o WHERE ${where}`, ...params),
  ]);
  res.json({ cities, duplicates: req.user.role === 'admin' ? dups : dups.map(d => ({ ...d, phone: d.phone.slice(0, 4) + '••••' })), dupCount: dups.reduce((a, d) => a + d.n - 1, 0), totalOrders: total.n });
});
// Top sellers leaderboard — buyers see rank & performance, never other buyers' money
app.get('/api/leaderboard', auth, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && !(await getSettings()).leaderboard_public) return res.json({ hidden: true, rows: [] });
  const q = { ...req, user: { role: 'admin' }, query: { from: req.query.from, to: req.query.to } };
  const rows = (await agg(q, 'user_id, uname', 'user_id')).filter(r => r.leads > 0)
    .sort((a, b) => (b.profit - a.profit) || (b.delivered - a.delivered));
  res.json({
    rows: rows.map((r, i) => ({
      rank: i + 1, user_id: r.user_id, uname: r.uname, me: r.user_id === req.user.id,
      leads: r.leads, confirmed: r.confirmed, delivered: r.delivered, conf_rate: r.conf_rate, deliv_rate: r.deliv_rate,
      ...(isAdmin || r.user_id === req.user.id ? { spend: r.spend, profit: r.profit, cpd: r.cpd, roas: r.roas } : {}),
    }))
  });
});

app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist'), { maxAge: '7d' }));
const STATIC = { '/styles.css': 'styles.css', '/app.js': 'app.js', '/ui-integrations.js': 'ui-integrations.js' };
for (const [route, file] of Object.entries(STATIC)) app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
app.get(/^\/(?!api|hook).*/, (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Erreur serveur : ' + err.message }); });

async function main() {
  await db.exec(SCHEMA);
  await integrations.init();
  try { await db.exec("ALTER TABLE products ADD COLUMN counts_source TEXT DEFAULT 'manual'"); } catch { }
  if (!await db.get("SELECT 1 x FROM users WHERE role='admin'")) {
    const u = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
    const p = process.env.ADMIN_PASSWORD || 'admin123';
    await db.run("INSERT INTO users (username,name,password_hash,role) VALUES (?,?,?,'admin')", u, 'Admin', await bcrypt.hash(p, 10));
    console.log(`[setup] admin created: ${u}${process.env.ADMIN_PASSWORD ? '' : ' / admin123 (CHANGE IT!)'}`);
  }
  setInterval(() => db.run('DELETE FROM sessions WHERE expires_at<?', Date.now()).catch(() => { }), 36e5).unref();
  app.listen(PORT, () => console.log(`${APP_NAME} running on http://localhost:${PORT} (db: ${db.kind})`));
}
main().catch(e => { console.error('Startup failed:', e); process.exit(1); });
