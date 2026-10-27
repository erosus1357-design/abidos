// Store integrations: webhooks (any platform), Shopify API pull, product mapping, orders → daily counts
const crypto = require('crypto');
const express = require('express');

const KINDS = ['shopify', 'youcan', 'lightfunnels', 'dropify', 'sheets', 'custom'];
const STATUSES = ['new', 'confirmed', 'cancelled', 'shipped', 'delivered', 'returned'];
const TZ = process.env.TIMEZONE || 'Africa/Casablanca';

module.exports = function setup({ app, db, auth, admin }) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, kind TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL, secret TEXT DEFAULT '',
    default_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    default_platform TEXT DEFAULT 'Meta',
    api_domain TEXT DEFAULT '', api_token TEXT DEFAULT '',
    active INTEGER DEFAULT 1, last_event_at TEXT, last_sync_at TEXT, last_error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS store_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    ext_key TEXT NOT NULL, title TEXT DEFAULT '',
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    orders INTEGER DEFAULT 0,
    UNIQUE(integration_id, ext_key)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
    ext_id TEXT NOT NULL, number TEXT DEFAULT '',
    created_at TEXT, date TEXT NOT NULL,
    ext_key TEXT DEFAULT '', item_title TEXT DEFAULT '', quantity INTEGER DEFAULT 1,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    platform TEXT DEFAULT 'Other',
    status TEXT DEFAULT 'new', status_locked INTEGER DEFAULT 0,
    total REAL DEFAULT 0, currency TEXT DEFAULT '',
    customer TEXT DEFAULT '', phone TEXT DEFAULT '', city TEXT DEFAULT '',
    utm_source TEXT DEFAULT '', utm_campaign TEXT DEFAULT '', utm_content TEXT DEFAULT '',
    raw TEXT, updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(integration_id, ext_id)
  );
  CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);
  CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(number);
  CREATE TABLE IF NOT EXISTS webhook_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id INTEGER REFERENCES integrations(id) ON DELETE CASCADE,
    received_at TEXT DEFAULT (datetime('now')), topic TEXT, ok INTEGER, message TEXT, body TEXT
  );`);
  try { db.exec("ALTER TABLE products ADD COLUMN counts_source TEXT DEFAULT 'manual'"); } catch { }

  // ---------- helpers ----------
  const localDate = iso => {
    const d = iso ? new Date(iso) : new Date();
    const v = isNaN(d) ? new Date() : d;
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(v);
  };
  const first = (o, keys) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return v; } };
  const str = v => v == null ? '' : typeof v === 'object' ? (v.name || v.title || v.value || JSON.stringify(v)) : String(v);

  function findUtm(body) {
    const out = {};
    const take = (k, v) => { k = String(k).toLowerCase(); if (/^utm_(source|medium|campaign|content|term)$/.test(k) && v && !out[k]) out[k] = String(v); };
    const fromUrl = u => { try { const url = new URL(String(u), 'https://x.io'); url.searchParams.forEach((v, k) => take(k, v)); } catch { } };
    const walk = (o, depth = 0) => {
      if (!o || depth > 6) return;
      if (Array.isArray(o)) return o.forEach(x => {
        if (x && typeof x === 'object' && 'name' in x && 'value' in x) take(x.name, x.value);
        walk(x, depth + 1);
      });
      if (typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string') { take(k, v); if (/^(landing|referr|source_url|url|page|link)/i.test(k) && v.includes('utm_')) fromUrl(v); }
        else walk(v, depth + 1);
      }
    };
    walk(body);
    return out;
  }
  function mapPlatform(src, fallback) {
    const s = String(src || '').toLowerCase();
    if (/(facebook|^fb|meta|instagram|^ig)/.test(s)) return 'Meta';
    if (/tiktok|^tt/.test(s)) return 'TikTok';
    if (/google|youtube|gads|adwords/.test(s)) return 'Google';
    if (/snap/.test(s)) return 'Snapchat';
    return fallback || 'Other';
  }
  function mapStatus(v) {
    const s = String(v || '').toLowerCase();
    if (!s) return null;
    if (/(return|retour|refus|rto)/.test(s)) return 'returned';
    if (/(deliver|livr|paid|completed|encaiss)/.test(s)) return 'delivered';
    if (/(ship|expedi|fulfill|in_transit|transit|dispatch|out_for|packed|en_cours|en cours)/.test(s) && !/unfulfill/.test(s)) return 'shipped';
    if (/(cancel|annul|wrong|fake|duplicate|refund)/.test(s)) return 'cancelled';
    if (/(confirm|valid|accept)/.test(s)) return 'confirmed';
    if (/(new|pending|nouveau|open|unfulfilled|created|placed)/.test(s)) return 'new';
    return null;
  }

  // Normalize any store payload to { ext_id, number, created_at, items[], total, currency, customer, phone, city, status, utm }
  function normalize(body, topic = '') {
    let o = body;
    for (let i = 0; i < 3; i++) { const inner = first(o, ['node', 'order', 'data', 'payload', 'object', 'resource']); if (inner && typeof inner === 'object' && !Array.isArray(inner)) o = inner; else break; }
    const cust = first(o, ['customer', 'client', 'shipping_address', 'shippingAddress', 'billing_address']) || {};
    const ship = first(o, ['shipping_address', 'shippingAddress', 'address']) || {};
    let rawItems = first(o, ['line_items', 'lineItems', 'items', 'products', 'variants', 'order_items', 'cart', 'order_lines']);
    if (rawItems && !Array.isArray(rawItems)) rawItems = rawItems.edges ? rawItems.edges.map(e => e.node) : rawItems.nodes || Object.values(rawItems);
    if (!rawItems || !rawItems.length) rawItems = [o];
    const items = rawItems.map(it => {
      const prod = typeof it.product === 'object' ? it.product : {};
      const variant = typeof it.variant === 'object' ? it.variant : {};
      const sku = first(it, ['sku', 'SKU', 'product_sku']) || first(variant, ['sku']) || first(prod, ['sku']);
      const pid = first(it, ['product_id', 'productId']) || first(prod, ['id']);
      const title = str(first(it, ['title', 'name', 'product_name', 'productName', 'product_title', 'produit', 'product']) || first(prod, ['name', 'title']) || '');
      return { key: String(sku || pid || title || 'unknown').trim().slice(0, 120), title: title.slice(0, 200), qty: +first(it, ['quantity', 'qty', 'quantite']) || 1 };
    }).filter(i => i.key);
    const cancelled = first(o, ['cancelled_at', 'canceled_at', 'cancelledAt']);
    let status = cancelled ? 'cancelled'
      : mapStatus(first(o, ['status', 'order_status', 'state', 'delivery_status', 'statut'])) || mapStatus(first(o, ['fulfillment_status', 'fulfillmentStatus'])) || null;
    const tp = String(topic).toLowerCase();
    if (!status && /cancel/.test(tp)) status = 'cancelled';
    if (!status && /fulfill/.test(tp)) status = 'shipped';
      const extId = String(first(o, ['id', 'order_id', 'orderId', 'uuid', 'reference', 'ref', 'order_number', 'number', 'name']) ?? '');
    return {
      ext_id: extId,
      number: String(first(o, ['order_number', 'number', 'name', 'reference', 'ref', 'ref_id']) ?? extId).replace(/^#/, ''),
      created_at: first(o, ['created_at', 'createdAt', 'date', 'order_date', 'date_created', 'processed_at']),
      items,
      total: +first(o, ['total_price', 'total', 'totalPrice', 'grand_total', 'amount', 'price', 'prix']) || 0,
      currency: str(first(o, ['currency', 'currency_code', 'presentment_currency']) || ''),
      customer: str(first(o, ['customer_name', 'full_name', 'fullName', 'nom']) || [first(cust, ['first_name', 'firstName']), first(cust, ['last_name', 'lastName'])].filter(Boolean).join(' ') || first(cust, ['name', 'full_name']) || ''),
      phone: str(first(o, ['phone', 'customer_phone', 'telephone', 'tel', 'mobile']) || first(cust, ['phone']) || first(ship, ['phone']) || ''),
      city: str(first(o, ['city', 'ville']) || first(ship, ['city']) || ''),
      status,
      utm: findUtm(body),
    };
  }

  function resolveBuyer(integ, productId, utm) {
    const users = db.prepare('SELECT id, username FROM users WHERE active=1').all();
    const hay = Object.values(utm).join(' ').toLowerCase();
    for (const u of users) {
      const re = new RegExp(`(^|[^a-z0-9])(mb[_-]?)?${u.username.replace(/[^a-z0-9]/g, '')}([^a-z0-9]|$)`);
      if (hay && re.test(hay)) return u.id;
    }
    if (productId) {
      const assigned = db.prepare('SELECT user_id FROM product_buyers WHERE product_id=?').all(productId).map(r => r.user_id);
      if (integ.default_user_id && assigned.includes(integ.default_user_id)) return integ.default_user_id;
      if (assigned.length === 1) return assigned[0];
      if (assigned.length) return assigned[0];
    }
    return integ.default_user_id || null;
  }

  // Recompute order-driven counts in daily_stats for given dates (products with counts_source='store')
  function recompute(dates) {
    dates = [...new Set(dates)].filter(Boolean);
    if (!dates.length) return;
    const ph = dates.map(() => '?').join(',');
    db.exec('SAVEPOINT rc');
    try {
      db.prepare(`UPDATE daily_stats SET leads=0, confirmed=0, cancelled=0, shipped=0, delivered=0, returned=0, upsells=0
        WHERE date IN (${ph}) AND product_id IN (SELECT id FROM products WHERE counts_source='store')`).run(...dates);
      const groups = db.prepare(`SELECT o.date, o.user_id, o.product_id, o.platform, COUNT(*) leads,
          SUM(o.status IN ('confirmed','shipped','delivered','returned')) confirmed,
          SUM(o.status='cancelled') cancelled,
          SUM(o.status IN ('shipped','delivered','returned')) shipped,
          SUM(o.status='delivered') delivered, SUM(o.status='returned') returned,
          SUM(o.quantity>1) upsells
        FROM orders o JOIN products p ON p.id=o.product_id
        WHERE o.date IN (${ph}) AND p.counts_source='store' AND o.user_id IS NOT NULL
        GROUP BY o.date, o.user_id, o.product_id, o.platform`).all(...dates);
      const up = db.prepare(`INSERT INTO daily_stats (date,user_id,product_id,platform,leads,confirmed,cancelled,shipped,delivered,returned,upsells,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(date,user_id,product_id,platform) DO UPDATE SET leads=excluded.leads, confirmed=excluded.confirmed,
        cancelled=excluded.cancelled, shipped=excluded.shipped, delivered=excluded.delivered, returned=excluded.returned,
        upsells=excluded.upsells, updated_at=excluded.updated_at`);
      for (const g of groups) up.run(g.date, g.user_id, g.product_id, g.platform, g.leads, g.confirmed, g.cancelled, g.shipped, g.delivered, g.returned, g.upsells);
      // drop rows that became fully empty (no spend, no counts)
      db.prepare(`DELETE FROM daily_stats WHERE date IN (${ph}) AND spend=0 AND leads=0 AND confirmed=0 AND delivered=0 AND returned=0 AND shipped=0
        AND (notes IS NULL OR notes='') AND product_id IN (SELECT id FROM products WHERE counts_source='store')`).run(...dates);
      db.exec('RELEASE rc');
    } catch (e) { db.exec('ROLLBACK TO rc'); db.exec('RELEASE rc'); throw e; }
  }

  // Store one normalized order; returns date touched
  function ingest(integ, n, raw) {
    if (!n.ext_id) throw new Error('No order id found in payload');
    const item = n.items[0] || { key: 'unknown', title: '', qty: 1 };
    const qty = n.items.reduce((a, i) => a + (i.qty || 1), 0);
    // register store products for mapping
    const upSp = db.prepare(`INSERT INTO store_products (integration_id, ext_key, title) VALUES (?,?,?)
      ON CONFLICT(integration_id, ext_key) DO UPDATE SET title=CASE WHEN excluded.title<>'' THEN excluded.title ELSE store_products.title END`);
    n.items.forEach(i => upSp.run(integ.id, i.key, i.title));
    // first mapped item decides the product
    let productId = null, chosen = item;
    for (const i of n.items) {
      const m = db.prepare('SELECT product_id FROM store_products WHERE integration_id=? AND ext_key=?').get(integ.id, i.key);
      let pid = m?.product_id;
      if (!pid) { // auto-match on our SKU or exact name
        const p = db.prepare('SELECT id FROM products WHERE lower(sku)=lower(?) OR lower(name)=lower(?)').get(i.key, i.title || i.key);
        if (p) {
          pid = p.id;
          db.prepare('UPDATE store_products SET product_id=? WHERE integration_id=? AND ext_key=?').run(pid, integ.id, i.key);
          db.prepare("UPDATE products SET counts_source='store' WHERE id=?").run(pid);
        }
      }
      if (pid) { productId = pid; chosen = i; break; }
    }
    const existing = db.prepare('SELECT * FROM orders WHERE integration_id=? AND ext_id=?').get(integ.id, n.ext_id);
    const date = existing?.date || localDate(n.created_at);
    const platform = mapPlatform(n.utm.utm_source, integ.default_platform);
    const userId = existing?.user_id && existing.product_id === productId ? existing.user_id : resolveBuyer(integ, productId, n.utm);
    const status = existing?.status_locked ? existing.status : (n.status || existing?.status || 'new');
    db.prepare(`INSERT INTO orders (integration_id, ext_id, number, created_at, date, ext_key, item_title, quantity, product_id, user_id, platform, status,
        total, currency, customer, phone, city, utm_source, utm_campaign, utm_content, raw, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(integration_id, ext_id) DO UPDATE SET number=excluded.number, ext_key=excluded.ext_key, item_title=excluded.item_title,
        quantity=excluded.quantity, product_id=excluded.product_id, user_id=excluded.user_id, platform=excluded.platform, status=excluded.status,
        total=excluded.total, currency=excluded.currency, customer=excluded.customer, phone=excluded.phone, city=excluded.city,
        utm_source=excluded.utm_source, utm_campaign=excluded.utm_campaign, utm_content=excluded.utm_content, raw=excluded.raw, updated_at=excluded.updated_at`)
      .run(integ.id, n.ext_id, n.number, n.created_at ? String(n.created_at) : null, date, chosen.key, chosen.title, qty, productId, userId, platform, status,
        n.total, n.currency, n.customer.slice(0, 120), n.phone.slice(0, 40), n.city.slice(0, 80),
        n.utm.utm_source || '', n.utm.utm_campaign || '', n.utm.utm_content || n.utm.utm_term || '', JSON.stringify(raw).slice(0, 20000));
    db.prepare('UPDATE store_products SET orders=(SELECT COUNT(*) FROM orders WHERE integration_id=store_products.integration_id AND ext_key=store_products.ext_key) WHERE integration_id=?').run(integ.id);
    return { date, mapped: !!productId, buyer: !!userId };
  }

  function log(integId, topic, ok, message, body) {
    db.prepare('INSERT INTO webhook_log (integration_id, topic, ok, message, body) VALUES (?,?,?,?,?)').run(integId, String(topic || '').slice(0, 80), ok ? 1 : 0, String(message).slice(0, 300), String(body || '').slice(0, 8000));
    db.prepare('DELETE FROM webhook_log WHERE integration_id=? AND id NOT IN (SELECT id FROM webhook_log WHERE integration_id=? ORDER BY id DESC LIMIT 100)').run(integId, integId);
  }

  function verifySignature(integ, req, rawBuf) {
    if (!integ.secret) return true;
    const h = req.headers;
    const sig = h['x-shopify-hmac-sha256'] || h['lightfunnels-hmac'] || h['x-youcan-hmac-sha256'] || h['x-youcan-signature'] || h['x-signature'] || h['x-hub-signature-256'];
    if (!sig) return !!(req.query.secret && req.query.secret === integ.secret);
    const mac = crypto.createHmac('sha256', integ.secret).update(rawBuf);
    const b64 = mac.digest('base64'), hex = crypto.createHmac('sha256', integ.secret).update(rawBuf).digest('hex');
    const s = String(sig).replace(/^sha256=/, '');
    return s === b64 || s.toLowerCase() === hex;
  }

  function parseBody(req, buf) {
    const ct = String(req.headers['content-type'] || '');
    const text = buf.toString('utf8');
    if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
    try { return JSON.parse(text); } catch { return Object.fromEntries(new URLSearchParams(text)); }
  }

  // ---------- public webhook endpoint (mounted BEFORE express.json) ----------
  app.post('/hook/:token', express.raw({ type: () => true, limit: '2mb' }), (req, res) => {
    const integ = db.prepare('SELECT * FROM integrations WHERE token=? AND active=1').get(req.params.token);
    if (!integ) return res.status(404).json({ error: 'Unknown webhook' });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const topic = req.headers['x-shopify-topic'] || req.headers['lightfunnels-topic'] || req.headers['x-youcan-event'] || req.headers['x-event'] || req.query.event || '';
    if (!verifySignature(integ, req, buf)) { log(integ.id, topic, false, 'Invalid signature', buf.toString().slice(0, 2000)); return res.status(401).json({ error: 'Invalid signature' }); }
    let body;
    try { body = parseBody(req, buf); } catch { body = {}; }
    // status-only update: { order: "1234", status: "delivered" }
    try {
      const list = Array.isArray(body) ? body : Array.isArray(body.orders) ? body.orders : [body];
      const dates = []; let msgs = [];
      for (const b of list) {
        const n = normalize(b, topic);
        const r = ingest(integ, n, b);
        dates.push(r.date);
        msgs.push(`#${n.number || n.ext_id}${r.mapped ? '' : ' (product not mapped)'}${r.buyer ? '' : ' (no buyer)'}`);
      }
      recompute(dates);
      db.prepare("UPDATE integrations SET last_event_at=datetime('now'), last_error=NULL WHERE id=?").run(integ.id);
      log(integ.id, topic, true, `${list.length} order(s): ${msgs.slice(0, 5).join(', ')}`, buf.toString());
      res.json({ ok: true, received: list.length });
    } catch (e) {
      log(integ.id, topic, false, e.message, buf.toString());
      db.prepare('UPDATE integrations SET last_error=? WHERE id=?').run(e.message, integ.id);
      res.status(200).json({ ok: false, error: e.message }); // 200 so the store doesn't disable the webhook
    }
  });

  // ---------- Shopify API pull ----------
  async function shopifySync(integ) {
    if (!integ.api_domain || !integ.api_token) throw new Error('Domaine Shopify et token Admin API obligatoires');
    const shop = integ.api_domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const since = integ.last_sync_at ? new Date(new Date(integ.last_sync_at + 'Z') - 36e5).toISOString() : new Date(Date.now() - 30 * 864e5).toISOString();
    let url = `https://${shop}/admin/api/2025-01/orders.json?status=any&limit=250&updated_at_min=${encodeURIComponent(since)}`;
    let count = 0; const dates = [];
    for (let page = 0; url && page < 40; page++) {
      const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': integ.api_token, Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Shopify ${r.status}: ${(await r.text()).slice(0, 150)}`);
      const j = await r.json();
      for (const o of j.orders || []) { dates.push(ingest(integ, normalize(o), o).date); count++; }
      const link = r.headers.get('link') || '';
      const m = link.match(/<([^>]+)>;\s*rel="next"/); url = m ? m[1] : null;
    }
    recompute(dates);
    db.prepare("UPDATE integrations SET last_sync_at=datetime('now'), last_error=NULL WHERE id=?").run(integ.id);
    log(integ.id, 'api-sync', true, `Synced ${count} order(s) from Shopify API`, '');
    return count;
  }
  const syncAll = async () => {
    for (const integ of db.prepare("SELECT * FROM integrations WHERE kind='shopify' AND active=1 AND api_token<>''").all()) {
      try { await shopifySync(integ); } catch (e) { db.prepare('UPDATE integrations SET last_error=? WHERE id=?').run(e.message, integ.id); log(integ.id, 'api-sync', false, e.message, ''); }
    }
  };
  setInterval(syncAll, 10 * 60e3).unref();

  // ---------- admin API ----------
  const pub = i => ({ ...i, api_token: i.api_token ? '••••' + i.api_token.slice(-4) : '', has_api: !!i.api_token });
  app.get('/api/integrations', auth, admin, (req, res) => {
    const rows = db.prepare(`SELECT i.*, u.name AS buyer_name,
      (SELECT COUNT(*) FROM orders o WHERE o.integration_id=i.id) AS orders,
      (SELECT COUNT(*) FROM store_products sp WHERE sp.integration_id=i.id AND sp.product_id IS NULL) AS unmapped
      FROM integrations i LEFT JOIN users u ON u.id=i.default_user_id ORDER BY i.id`).all();
    res.json(rows.map(pub));
  });
  app.post('/api/integrations', auth, admin, (req, res) => {
    const b = req.body || {};
    if (!b.name || !KINDS.includes(b.kind)) return res.status(400).json({ error: 'Nom et type de boutique obligatoires' });
    const token = crypto.randomBytes(18).toString('hex');
    const r = db.prepare('INSERT INTO integrations (name,kind,token,secret,default_user_id,default_platform,api_domain,api_token) VALUES (?,?,?,?,?,?,?,?)')
      .run(b.name.trim(), b.kind, token, String(b.secret || '').trim(), +b.default_user_id || null, b.default_platform || 'Meta', String(b.api_domain || '').trim(), String(b.api_token || '').trim());
    res.json({ id: r.lastInsertRowid });
  });
  app.put('/api/integrations/:id', auth, admin, (req, res) => {
    const i = db.prepare('SELECT * FROM integrations WHERE id=?').get(+req.params.id);
    if (!i) return res.status(404).json({ error: 'Introuvable' });
    const b = req.body || {};
    const apiToken = b.api_token && !String(b.api_token).startsWith('••••') ? String(b.api_token).trim() : i.api_token;
    db.prepare('UPDATE integrations SET name=?, secret=?, default_user_id=?, default_platform=?, api_domain=?, api_token=?, active=? WHERE id=?')
      .run(b.name ?? i.name, b.secret ?? i.secret, b.default_user_id === undefined ? i.default_user_id : (+b.default_user_id || null), b.default_platform ?? i.default_platform,
        b.api_domain ?? i.api_domain, apiToken, b.active === undefined ? i.active : (b.active ? 1 : 0), i.id);
    res.json({ ok: true });
  });
  app.delete('/api/integrations/:id', auth, admin, (req, res) => {
    const dates = db.prepare('SELECT DISTINCT date FROM orders WHERE integration_id=?').all(+req.params.id).map(r => r.date);
    if (req.query.orders === 'delete') db.prepare('DELETE FROM orders WHERE integration_id=?').run(+req.params.id);
    db.prepare('DELETE FROM integrations WHERE id=?').run(+req.params.id);
    recompute(dates); res.json({ ok: true });
  });
  app.post('/api/integrations/:id/sync', auth, admin, async (req, res) => {
    const i = db.prepare('SELECT * FROM integrations WHERE id=?').get(+req.params.id);
    if (!i) return res.status(404).json({ error: 'Introuvable' });
    try { res.json({ synced: await shopifySync(i) }); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/integrations/:id/test', auth, admin, (req, res) => {
    const i = db.prepare('SELECT * FROM integrations WHERE id=?').get(+req.params.id);
    const sp = db.prepare('SELECT * FROM store_products WHERE integration_id=? AND product_id IS NOT NULL LIMIT 1').get(i.id);
    const p = sp ? null : db.prepare('SELECT * FROM products WHERE active=1 LIMIT 1').get();
    const sample = { id: 'TEST-' + Date.now(), order_number: 'TEST-' + Math.floor(Math.random() * 9000 + 1000), created_at: new Date().toISOString(), total_price: 299, currency: 'MAD',
      customer: { first_name: 'Test', last_name: 'Client', phone: '0600000000' }, line_items: [{ sku: sp?.ext_key || p?.sku || 'TEST-SKU', title: sp?.title || p?.name || 'Test product', quantity: 1 }],
      landing_site: '/?utm_source=facebook&utm_campaign=test' };
    try { const r = ingest(i, normalize(sample), sample); recompute([r.date]); log(i.id, 'test', true, `Test order #${sample.order_number}${r.mapped ? '' : ' (product not mapped)'}`, JSON.stringify(sample)); res.json(r); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/integrations/:id/products', auth, admin, (req, res) => {
    res.json(db.prepare('SELECT * FROM store_products WHERE integration_id=? ORDER BY product_id IS NOT NULL, orders DESC').all(+req.params.id));
  });
  app.put('/api/store-products/:id', auth, admin, (req, res) => {
    const sp = db.prepare('SELECT * FROM store_products WHERE id=?').get(+req.params.id);
    if (!sp) return res.status(404).json({ error: 'Introuvable' });
    const pid = +req.body.product_id || null;
    db.prepare('UPDATE store_products SET product_id=? WHERE id=?').run(pid, sp.id);
    if (pid) db.prepare("UPDATE products SET counts_source='store' WHERE id=?").run(pid);
    // re-attribute existing orders for this store product
    const integ = db.prepare('SELECT * FROM integrations WHERE id=?').get(sp.integration_id);
    const orders = db.prepare('SELECT * FROM orders WHERE integration_id=? AND ext_key=?').all(sp.integration_id, sp.ext_key);
    const upd = db.prepare('UPDATE orders SET product_id=?, user_id=? WHERE id=?');
    for (const o of orders) upd.run(pid, pid ? resolveBuyer(integ, pid, { utm_source: o.utm_source, utm_campaign: o.utm_campaign, utm_content: o.utm_content }) : o.user_id, o.id);
    recompute(orders.map(o => o.date));
    res.json({ ok: true, orders: orders.length });
  });
  app.get('/api/integrations/:id/log', auth, admin, (req, res) => {
    res.json(db.prepare('SELECT * FROM webhook_log WHERE integration_id=? ORDER BY id DESC LIMIT 50').all(+req.params.id));
  });

  // ---------- orders (admin: all, buyer: own) ----------
  app.get('/api/orders', auth, (req, res) => {
    const w = ['o.date BETWEEN ? AND ?'], p = [req.query.from || '0000-01-01', req.query.to || '9999-12-31'];
    if (req.user.role !== 'admin') { w.push('o.user_id=?'); p.push(req.user.id); }
    else if (req.query.user_id) { w.push('o.user_id=?'); p.push(+req.query.user_id); }
    if (req.query.product_id) { w.push('o.product_id=?'); p.push(+req.query.product_id); }
    if (req.query.platform) { w.push('o.platform=?'); p.push(req.query.platform); }
    if (req.query.q) { w.push('(o.number LIKE ? OR o.customer LIKE ? OR o.phone LIKE ? OR o.utm_campaign LIKE ?)'); const q = `%${req.query.q}%`; p.push(q, q, q, q); }
    const counts = db.prepare(`SELECT o.status, COUNT(*) n FROM orders o WHERE ${w.join(' AND ')} GROUP BY o.status`).all(...p);
    if (req.query.status) { w.push('o.status=?'); p.push(req.query.status); }
    const rows = db.prepare(`SELECT o.id, o.integration_id, o.ext_id, o.number, o.created_at, o.date, o.ext_key, o.item_title, o.quantity, o.product_id, o.user_id, o.platform, o.status,
        o.total, o.currency, o.customer, ${req.user.role === 'admin' ? 'o.phone,' : ''} o.city, o.utm_source, o.utm_campaign, o.utm_content,
        i.name AS store, i.kind, pr.name AS pname, u.name AS uname
      FROM orders o LEFT JOIN integrations i ON i.id=o.integration_id LEFT JOIN products pr ON pr.id=o.product_id LEFT JOIN users u ON u.id=o.user_id
      WHERE ${w.join(' AND ')} ORDER BY o.created_at DESC, o.id DESC LIMIT 1000`).all(...p);
    res.json({ rows, counts });
  });
  app.put('/api/orders/:id', auth, admin, (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(+req.params.id);
    if (!o) return res.status(404).json({ error: 'Introuvable' });
    const b = req.body || {};
    const status = STATUSES.includes(b.status) ? b.status : o.status;
    db.prepare('UPDATE orders SET status=?, status_locked=1, user_id=?, platform=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(status, b.user_id === undefined ? o.user_id : (+b.user_id || null), b.platform || o.platform, o.id);
    recompute([o.date]); res.json({ ok: true });
  });
  // bulk status update, e.g. from Lead to Next / call center export: [{number, status}]
  app.post('/api/orders/status-import', auth, admin, (req, res) => {
    const rows = req.body?.rows || []; let ok = 0; const miss = []; const dates = [];
    const find = db.prepare('SELECT id, date FROM orders WHERE number=? OR ext_id=? OR phone=? ORDER BY id DESC');
    const upd = db.prepare("UPDATE orders SET status=?, status_locked=1, updated_at=datetime('now') WHERE id=?");
    for (const r of rows) {
      const key = String(r.number || r.order || r.order_number || r.reference || r.ref || r.phone || '').replace(/^#/, '').trim();
      const st = STATUSES.includes(String(r.status).toLowerCase()) ? String(r.status).toLowerCase() : mapStatus(r.status);
      if (!key || !st) { miss.push(key || '(empty)'); continue; }
      const found = find.all(key, key, key);
      if (!found.length) { miss.push(key); continue; }
      found.forEach(f => { upd.run(st, f.id); dates.push(f.date); }); ok++;
    }
    recompute(dates);
    res.json({ ok, missing: miss.slice(0, 50) });
  });

  return { recompute, normalize, KINDS, STATUSES };
};
