/* Sellerhub — front-end (vanilla JS) */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PLATFORMS = ['Meta', 'TikTok', 'Google', 'Snapchat', 'Other'];
const S = { me: null, settings: {}, products: [], users: [], range: 'this_month', from: null, to: null, f: {}, charts: {}, mini: false };
try { S.mini = localStorage.getItem('sh_mini') === '1'; } catch { }

// ---------- format ----------
const nf = (v, d = 0) => Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v, d = 0) => v == null || isNaN(v) ? '—' : (v < 0 ? '-$' : '$') + nf(v, d);
const money2 = v => money(v, 2);
const int = v => v == null ? '—' : Math.round(v).toLocaleString('fr-FR');
const pct = v => v == null || isNaN(v) ? '—' : (v * 100).toFixed(1).replace('.', ',') + ' %';
const x2 = v => v == null || isNaN(v) ? '—' : v.toFixed(2).replace('.', ',') + 'x';
const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
const ymd = d => d.toISOString().slice(0, 10);
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const firstName = n => String(n || '').split(' ')[0];

// ---------- api ----------
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { S.me = null; renderLogin(); throw new Error('Session expirée'); }
  if (!r.ok) throw new Error(j.error || 'Erreur');
  return j;
}
function toast(msg, err) { const d = document.createElement('div'); d.textContent = msg; if (err) d.className = 'e'; $('#toast').appendChild(d); setTimeout(() => d.remove(), 3400); }

// ---------- theme ----------
function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('sh_theme', t); } catch { } }
try { applyTheme(localStorage.getItem('sh_theme') || 'dark'); } catch { applyTheme('dark'); }
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ---------- dates ----------
function rangeDates(key) {
  const now = new Date(); const t = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const d = n => new Date(t.getTime() + n * 864e5); const dow = (t.getUTCDay() + 6) % 7;
  switch (key) {
    case 'today': return [t, t];
    case 'yesterday': return [d(-1), d(-1)];
    case 'this_week': return [d(-dow), t];
    case 'last_7': return [d(-6), t];
    case 'this_month': return [new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)), t];
    case 'last_month': return [new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)), new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0))];
    case 'last_30': return [d(-29), t];
    case 'all': return [new Date(Date.UTC(2020, 0, 1)), t];
    default: return [d(-29), t];
  }
}
function setRange(k) { S.range = k; if (k !== 'custom') { const [f, t] = rangeDates(k); S.from = ymd(f); S.to = ymd(t); } }
setRange('this_month');
const RANGES = [['today', "Aujourd'hui"], ['yesterday', 'Hier'], ['this_week', 'Cette semaine'], ['last_7', '7 jours'], ['this_month', 'Ce mois'], ['last_month', 'Mois dernier'], ['last_30', '30 jours'], ['all', 'Tout']];
const qs = (extra = {}) => '?' + new URLSearchParams({ from: S.from, to: S.to, ...Object.fromEntries(Object.entries({ ...S.f, ...extra }).filter(([, v]) => v !== '' && v != null)) });

// ---------- icons ----------
const sv = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  home: sv('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"/>'),
  cart: sv('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21.5 8H6"/>'),
  list: sv('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  crown: sv('<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z"/>'),
  box: sv('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
  calc: sv('<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18h7"/>'),
  users: sv('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.6 5.2"/>'),
  plug: sv('<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5"/>'),
  cog: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  user: sv('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
  out: sv('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  menu: sv('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  side: sv('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>'),
  search: sv('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  sun: sv('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: sv('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>'),
  globe: sv('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  eye: sv('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  mega: sv('<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1ZM17 8a5 5 0 0 1 0 8"/>'),
  wallet: sv('<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z"/><circle cx="16.5" cy="14.5" r="1.2"/>'),
  target: sv('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  check: sv('<path d="M20 6 9 17l-5-5"/>'),
  truck: sv('<path d="M1 6h13v10H1zM14 10h4l3 3v3h-7"/><circle cx="5.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>'),
  percent: sv('<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
  coin: sv('<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.6-3-1.6M12 6.5v11"/>'),
  bolt: sv('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>'),
  chart: sv('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'),
  map: sv('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  copy: sv('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  alert: sv('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>'),
  shield: sv('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  arrow: sv('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  edit: sv('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  trash: sv('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  mail: sv('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  lock: sv('<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  download: sv('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'),
  upload: sv('<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>'),
};
const LOGO = `<svg class="mark" viewBox="0 0 48 48" fill="none"><defs><linearGradient id="lg" x1="0" y1="0" x2="48" y2="48"><stop stop-color="#f8cf62"/><stop offset="1" stop-color="#e2862a"/></linearGradient></defs>
  <rect width="48" height="48" rx="14" fill="url(#lg)"/><path d="M14 31.5c2.2 2.4 5.6 3.8 9.6 3.8 5.4 0 9.2-2.6 9.2-6.9 0-8.6-17-5.4-17-12.3 0-2.9 2.8-5 7-5 3.2 0 5.8 1.1 7.5 3" stroke="#1b1205" stroke-width="3.6" stroke-linecap="round"/>
  <circle cx="36" cy="12" r="3" fill="#1b1205"/></svg>`;

// ---------- boot ----------
async function boot() {
  try {
    S.me = await api('/me'); document.title = S.me.appName;
    [S.settings] = await Promise.all([api('/settings'), loadRefs()]);
    route();
  } catch { renderLogin(); }
}
async function loadRefs() {
  const [p, u] = await Promise.all([api('/products'), S.me.role === 'admin' ? api('/users') : null]);
  S.products = p; if (u) S.users = u;
}
window.addEventListener('hashchange', () => S.me && route());

function renderLogin() {
  $('#app').innerHTML = `<div class="login"><div class="box">
    <div class="logo">${LOGO}<h1>${esc(S.me?.appName || 'Sellerhub')}</h1><p>Connectez-vous à votre espace</p></div>
    <form id="lf">
      <label class="f">Nom d'utilisateur<div class="ifield">${I.user}<input name="username" autocomplete="username" required autofocus placeholder="ex : yassine"></div></label>
      <label class="f">Mot de passe<div class="ifield">${I.lock}<input name="password" type="password" autocomplete="current-password" required placeholder="••••••••"></div></label>
      <div class="err" id="lerr"></div>
      <button class="btn pri" style="justify-content:center;padding:13px;font-size:14px">Se connecter</button>
    </form>
    <div class="foot">© ${new Date().getFullYear()} Sellerhub · Le QG des top sellers</div></div></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    try { await api('/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); location.hash = '#/overview'; boot(); }
    catch (er) { $('#lerr').textContent = er.message; }
  };
}

// ---------- navigation ----------
function navItems() {
  const A = S.me.role === 'admin';
  return [
    ['Principal', [['overview', I.home, 'Accueil'], ['orders', I.cart, A ? 'Commandes' : 'Mes commandes'], ['entries', I.list, A ? 'Données journalières' : 'Mes dépenses & données']]],
    ['Performance', [...(A || S.settings.leaderboard_public ? [['leaderboard', I.crown, 'Top Sellers']] : []), ['products', I.box, A ? 'Produits & marges' : 'Mes produits'], ['simulator', I.calc, 'Simulateur de profit']]],
    ...(A ? [['Administration', [['team', I.users, 'Media buyers'], ['integrations', I.plug, 'Intégrations boutiques'], ['platform', I.cog, 'Paramètres plateforme']]]] : []),
    ['Compte', [['settings', I.user, 'Mon compte']]],
  ];
}
function shell(active, content) {
  const A = S.me.role === 'admin';
  const countries = [...new Set(S.products.map(p => p.country).filter(Boolean))].sort();
  const viewing = A && S.f.user_id ? S.users.find(u => u.id == S.f.user_id) : null;
  $('#app').innerHTML = `
  <div class="shell ${S.mini ? 'mini' : ''}" id="shell">
    <aside class="side" id="side">
      <div class="brand">${LOGO}<span>${esc(S.me.appName)}<small>Top sellers HQ</small></span></div>
      <div class="search">${I.search}<input id="navq" placeholder="Rechercher une page…"></div>
      <nav class="nav" id="nav">${navItems().map(([sec, items]) => `<div class="sec">${sec}</div>${items.map(([k, ic, t]) => `<a href="#/${k}" data-t="${esc(t.toLowerCase())}" class="${active === k ? 'on' : ''}">${ic}<span>${t}</span></a>`).join('')}`).join('')}</nav>
      <div class="me"><div class="av">${initials(S.me.name)}</div><div class="who"><b>${esc(S.me.name)}</b><span class="role">${A ? 'Admin' : 'Media buyer'}</span></div>
      <button class="iconbtn" id="logout" title="Déconnexion">${I.out}</button></div>
    </aside>
    <div class="wrap">
      <div class="topbar">
        <button class="tb-btn mobtog" id="mtog">${I.menu}</button>
        <button class="tb-btn hide-m" id="mini" title="Réduire le menu">${I.side}</button>
        <button class="tb-btn hide-m" id="pal">${I.search}<span>Rechercher…</span><kbd>⌘K</kbd></button>
        <span class="sp"></span>
        ${countries.length ? `<select class="tb-sel hide-m" id="tcountry"><option value="">🌍 Tous les pays</option>${countries.map(c => `<option ${S.f.country === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
        ${A ? `<select class="tb-sel ${viewing ? 'viewas' : ''}" id="tview"><option value="">👁 Voir en tant que…</option>${S.users.filter(u => u.role === 'buyer').map(u => `<option value="${u.id}" ${S.f.user_id == u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
        <button class="tb-btn" id="theme" title="Thème">${document.documentElement.dataset.theme === 'light' ? I.moon : I.sun}</button>
        <a class="btn pri hide-m" href="#/entries?new=1">${I.plus}Saisie du jour</a>
      </div>
      ${S.settings.announcement ? `<div class="announce">${I.mega}<span>${esc(S.settings.announcement)}</span></div>` : ''}
      ${viewing ? `<div class="announce" style="background:var(--violet-soft);border-color:rgba(139,108,255,.3)">${I.eye}<span>Vous voyez la plateforme comme <b>${esc(viewing.name)}</b></span><span style="flex:1"></span><button class="btn sm" id="stopview">Quitter la vue</button></div>` : ''}
      <main class="main" id="main">${content}</main>
    </div>
  </div>`;
  $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); S.me = null; renderLogin(); };
  $('#mtog').onclick = () => $('#side').classList.toggle('open');
  $('#mini').onclick = () => { S.mini = !S.mini; $('#shell').classList.toggle('mini', S.mini); try { localStorage.setItem('sh_mini', S.mini ? '1' : '0'); } catch { } };
  $('#pal').onclick = palette;
  $('#theme').onclick = () => { applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); route(); };
  if ($('#tcountry')) $('#tcountry').onchange = e => { S.f.country = e.target.value; route(); };
  if ($('#tview')) $('#tview').onchange = e => { S.f.user_id = e.target.value; route(); };
  if ($('#stopview')) $('#stopview').onclick = () => { S.f.user_id = ''; route(); };
  $('#navq').oninput = e => { const q = e.target.value.toLowerCase(); $$('#nav a').forEach(a => a.style.display = a.dataset.t.includes(q) ? '' : 'none'); $$('#nav .sec').forEach(s => s.style.display = q ? 'none' : ''); };
}
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && S.me) { e.preventDefault(); palette(); } if (e.key === 'Escape') { $('#modal-root').innerHTML = ''; $('.palette')?.remove(); } });
function palette() {
  const items = navItems().flatMap(([, it]) => it);
  const d = document.createElement('div'); d.className = 'palette';
  d.innerHTML = `<div class="pbox"><input placeholder="Aller à…" autofocus><div id="pl"></div></div>`;
  document.body.appendChild(d);
  let sel = 0, list = items;
  const draw = () => { $('#pl', d).innerHTML = list.map(([k, ic, t], i) => `<a href="#/${k}" class="${i === sel ? 'on' : ''}">${ic}${t}</a>`).join('') || '<div class="empty">Aucun résultat</div>'; $$('a', d).forEach(a => a.onclick = () => d.remove()); };
  const inp = $('input', d); inp.focus();
  inp.oninput = () => { sel = 0; list = items.filter(i => i[2].toLowerCase().includes(inp.value.toLowerCase())); draw(); };
  inp.onkeydown = e => { if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, list.length - 1); draw(); } if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); } if (e.key === 'Enter' && list[sel]) { location.hash = '#/' + list[sel][0]; d.remove(); } };
  d.onclick = e => e.target === d && d.remove();
  draw();
}

function route() {
  Object.values(S.charts).forEach(c => c.destroy()); S.charts = {};
  $('#modal-root').innerHTML = ''; $('.palette')?.remove();
  const page = (location.hash.replace('#/', '') || 'overview').split('?')[0];
  const A = S.me.role === 'admin';
  const pages = { overview: Overview, orders: Orders, entries: Entries, leaderboard: Leaderboard, products: Products, simulator: Simulator, team: Team, integrations: Integrations, platform: Platform, settings: Settings };
  if (['team', 'integrations', 'platform'].includes(page) && !A) return (location.hash = '#/overview');
  (pages[page] || Overview)();
  window.scrollTo(0, 0);
}

// ---------- filter bar ----------
function filterBar(opts = {}) {
  return `<div class="filters" id="fb">
    <div class="seg">${RANGES.map(([k, t]) => `<button data-r="${k}" class="${S.range === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <input type="date" id="ff" value="${S.from}"><span class="sub">→</span><input type="date" id="ft" value="${S.to}">
    <span class="sp"></span>
    ${opts.product === false ? '' : `<select data-f="product_id"><option value="">Tous les produits</option>${S.products.map(p => `<option value="${p.id}" ${S.f.product_id == p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`}
    <select data-f="platform"><option value="">Toutes les plateformes</option>${PLATFORMS.map(p => `<option ${S.f.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
  </div>`;
}
function bindFilters(reload) {
  $$('#fb [data-r]').forEach(b => b.onclick = () => { setRange(b.dataset.r); reload(); });
  $('#ff').onchange = e => { S.range = 'custom'; S.from = e.target.value; reload(); };
  $('#ft').onchange = e => { S.range = 'custom'; S.to = e.target.value; reload(); };
  $$('#fb [data-f]').forEach(s => s.onchange = () => { S.f[s.dataset.f] = s.value; reload(); });
}
const periodLabel = () => (RANGES.find(r => r[0] === S.range)?.[1] || 'Période') + ` · ${S.from} → ${S.to}`;
const empty = (icon, title, text, cta = '') => `<div class="empty"><div class="eic">${icon}</div><b>${title}</b>${text}${cta ? `<div style="margin-top:16px">${cta}</div>` : ''}</div>`;

// ---------- sparkline ----------
function spark(canvas, vals, color) {
  if (!canvas || !vals.length) return;
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr; const c = canvas.getContext('2d'); c.scale(dpr, dpr);
  const v = vals.length === 1 ? [vals[0], vals[0]] : vals;
  const mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1;
  const pts = v.map((y, i) => [i / (v.length - 1) * w, h - 3 - (y - mn) / rg * (h - 8)]);
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00');
  c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.lineTo(w, h); c.lineTo(0, h); c.fillStyle = g; c.fill();
  c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.strokeStyle = color; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
}
function countUp(el) {
  const end = +el.dataset.v, fmt = el.dataset.f; const t0 = performance.now();
  const f = { money: v => money(v), int: v => int(v) }[fmt] || (v => v);
  const tick = t => { const k = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - k, 3); el.textContent = f(end * e); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

// ---------- OVERVIEW ----------
async function Overview() {
  const A = S.me.role === 'admin', viewAs = A && S.f.user_id;
  const who = viewAs ? S.users.find(u => u.id == S.f.user_id) : S.me;
  shell('overview', `
    <div class="welcome"><div class="dots"></div><div class="k">${esc(S.me.appName)}</div>
      <h2>Bienvenue, ${esc(firstName(S.me.name))} 👋</h2><p>${A ? 'Le QG de votre équipe — chaque buyer, chaque produit, chaque commande.' : 'Votre performance en temps réel. Visez le podium 🏆'}</p>
      <div class="stats" id="wstats"></div></div>
    ${filterBar()}<div id="ov">${empty(I.chart, 'Chargement…', '')}</div>`);
  bindFilters(Overview);
  const [d, ins, lb] = await Promise.all([api('/dashboard' + qs()), api('/insights' + qs()), api('/leaderboard' + qs()).catch(() => ({ rows: [] }))]);
  const t = d.totals, p = d.prev || {};
  $('#wstats').innerHTML = `<div><b>${int(ins.totalOrders || t.leads)}</b>commandes</div><div><b>${int(t.delivered)}</b>livrées</div><div><b>${money(t.profit)}</b>profit net</div><div><b>${esc(periodLabel().split(' · ')[0])}</b>période</div>`;
  if (!t.entries && !ins.totalOrders) {
    $('#ov').innerHTML = `<div class="card" style="margin-bottom:18px">${empty(I.chart, 'Aucune donnée sur cette période', S.products.length ? 'Ajoutez votre première saisie ou connectez une boutique.' : (A ? 'Commencez par créer un produit et vos media buyers.' : 'Votre manager doit vous assigner un produit.'),
      S.products.length ? `<a class="btn pri" href="#/entries?new=1">${I.plus}Saisie du jour</a>` : (A ? `<a class="btn pri" href="#/products">${I.plus}Créer un produit</a>` : ''))}</div>${quickLinks()}`;
    return;
  }
  const dl = (k, inv) => {
    if (!p[k] || t[k] == null) return '';
    const ch = (t[k] - p[k]) / Math.abs(p[k]); const good = inv ? ch < 0 : ch > 0;
    return `<span class="delta ${good ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(0)}%</span>`;
  };
  const commissionPct = (viewAs ? who?.commission_pct : S.me.commission_pct) || 0;
  const teamCommission = A && !viewAs ? d.buyers.reduce((a, b) => a + Math.max(0, b.profit) * ((S.users.find(u => u.id === b.user_id)?.commission_pct || 0) / 100), 0) : null;
  const myCommission = Math.max(0, t.profit) * commissionPct / 100;
  const kpi = (l, v, s, k, inv, ic, tone, sp) => `<div class="kpi"><div class="l"><span>${l}</span><span class="ic ${tone}">${ic}</span></div>
    <div class="v num">${v}${k ? dl(k, inv) : ''}</div><div class="s">${s}</div>${sp ? `<canvas class="spark" data-sp="${sp}" data-c="${tone}"></canvas>` : ''}</div>`;
  const maxF = Math.max(t.leads, 1);
  const fstep = (l, v, sub) => `<div class="fstep"><span>${l}</span><div class="fbar"><i style="width:0" data-w="${Math.max(2, v / maxF * 100)}"></i></div><div class="fv num"><b>${int(v)}</b><span>${sub}</span></div></div>`;
  const dupAlert = ins.dupCount ? `<div class="alert warn">${I.alert}<span><b>${ins.dupCount} doublon(s) suspect(s)</b> sur cette période — même téléphone sur plusieurs commandes.</span><span class="sp"></span><button class="btn sm" id="seedup">Voir</button></div>`
    : ins.totalOrders ? `<div class="alert ok">${I.shield}<span>Aucun doublon suspect sur cette période</span></div>` : '';
  const pd = dl('profit');

  $('#ov').innerHTML = `${dupAlert}
  <div class="wallet ${t.profit < 0 ? 'neg' : ''}"><div class="ring"></div>
    <div class="top"><div><div class="lbl">${A && !viewAs ? "Portefeuille de l'équipe" : 'Mon portefeuille'}</div>
      <div class="big num" data-v="${t.profit}" data-f="money">${money(t.profit)}</div>
      <div class="sub2">Profit net · CA livré − coûts produit − frais − pub · marge ${pct(t.margin)}</div></div>
      ${pd ? `<div style="background:rgba(255,255,255,.3);border-radius:999px;padding:5px 11px;font-weight:800;font-size:12px;white-space:nowrap">${pd.replace(/<[^>]+>/g, '')} vs période préc.</div>` : ''}</div>
    <div class="tiles">
      <div class="tile"><span>${A && !viewAs ? 'Commissions à payer' : `Ma commission (${commissionPct}%)`}</span><b class="num">${money(A && !viewAs ? teamCommission : myCommission)}</b><i>${A && !viewAs ? 'total des buyers' : 'sur le profit net'}</i></div>
      <div class="tile"><span>Dépense pub</span><b class="num">${money(t.spend)}</b><i>${int(t.entries)} saisies</i></div>
      <div class="tile"><span>Chiffre d'affaires</span><b class="num">${money(t.revenue)}</b><i>panier moyen ${money(t.aov)}</i></div>
      <div class="tile"><span>ROAS · ROI</span><b class="num">${x2(t.roas)}</b><i>ROI ${pct(t.roi)}</i></div>
    </div></div>
  <div class="kpis">
    ${kpi('Leads', int(t.leads), `CPL ${money2(t.cpl)}`, 'leads', false, I.cart, 'gold', 'leads')}
    ${kpi('Taux de confirmation', pct(t.conf_rate), `${int(t.confirmed)} / ${int(t.leads)} confirmées`, 'conf_rate', false, I.check, 'violet', 'conf_rate')}
    ${kpi('Livrées', int(t.delivered), `${int(t.returned)} retours`, 'delivered', false, I.truck, 'good', 'delivered')}
    ${kpi('Taux de livraison', pct(t.deliv_rate), 'livrées / (livrées + retours)', 'deliv_rate', false, I.percent, 'info', 'deliv_rate')}
    ${kpi('CPD', money2(t.cpd), 'coût par livraison', 'cpd', true, I.target, 'warn', 'cpd')}
    ${kpi('Coût / confirmée', money2(t.cpo), `${int(t.confirmed)} confirmées`, 'cpo', true, I.coin, 'violet', 'cpo')}
    ${kpi('Profit / livraison', money2(t.profit_per_order), 'net après pub', 'profit_per_order', false, I.wallet, 'good', 'profit_per_order')}
    ${kpi('Dépense pub', money(t.spend), `ROAS ${x2(t.roas)}`, null, null, I.bolt, 'bad', 'spend')}
  </div>
  <div class="row r2">
    <div class="card"><div class="ch"><h3>${I.chart}Commandes, livrées & profit</h3><span class="r">${esc(periodLabel())}</span></div><div class="cb"><div class="chartbox"><canvas id="cDaily"></canvas></div></div></div>
    <div class="card"><div class="ch"><h3>${I.target}Entonnoir</h3><span class="r">depuis les leads</span></div><div class="cb">
      <div class="funnel">${fstep('Leads', t.leads, money2(t.cpl) + ' CPL')}${fstep('Confirmées', t.confirmed, pct(t.conf_rate))}${fstep('Expédiées', t.shipped, pct(t.ship_rate))}${fstep('Livrées', t.delivered, pct(t.deliv_of_conf) + ' des conf.')}${fstep('Retours', t.returned, pct(t.return_rate))}</div>
      <div style="margin-top:20px;border-top:1px solid var(--line);padding-top:16px"><div class="sub" style="margin-bottom:10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;font-size:10.5px">Répartition des coûts</div>${costBreak(t)}</div>
    </div></div>
  </div>
  <div class="row r11">
    ${lb.rows?.length ? `<div class="card"><div class="ch"><h3>${I.crown}Top Sellers</h3><a class="r" href="#/leaderboard">Classement complet →</a></div><div class="cb" style="padding-top:26px">${podium(lb.rows)}<div style="margin-top:10px">${lb.rows.slice(3, 6).map(lbRow).join('')}</div></div></div>` : ''}
    <div class="card"><div class="ch"><h3>${I.box}Top produits</h3><a class="r" href="#/products">Taux par produit →</a></div><div class="tw">${topProducts(d.products)}</div></div>
  </div>
  ${A && !viewAs && d.buyers.length ? `<div class="card" style="margin-bottom:18px"><div class="ch"><h3>${I.users}Performance media buyers</h3><span class="r">classés par profit net</span></div><div class="tw">${perfTable([...d.buyers].sort((a, b) => b.profit - a.profit), 'buyer')}</div></div>` : ''}
  <div class="row r3">
    <div class="card"><div class="ch"><h3>${I.bolt}Par plateforme</h3></div><div class="tw">${perfTable(d.platforms, 'platform', true)}</div></div>
    <div class="card"><div class="ch"><h3>${I.globe}Par pays</h3></div><div class="tw">${perfTable(d.countries, 'country', true)}</div></div>
    <div class="card"><div class="ch"><h3>${I.map}Répartition géographique</h3><span class="r">villes</span></div><div class="cb">${geo(ins.cities)}</div></div>
  </div>
  ${quickLinks()}`;

  $$('[data-v]', $('#ov')).forEach(countUp);
  requestAnimationFrame(() => $$('.fbar i[data-w]').forEach(i => i.style.width = i.dataset.w + '%'));
  const colors = { gold: cssVar('--gold'), violet: cssVar('--violet'), good: cssVar('--good'), info: cssVar('--info'), warn: cssVar('--warn'), bad: cssVar('--bad') };
  $$('canvas.spark').forEach(c => spark(c, d.daily.map(x => +x[c.dataset.sp] || 0), colors[c.dataset.c] || colors.gold));
  drawDaily(d.daily);
  if ($('#seedup')) $('#seedup').onclick = () => dupModal(ins.duplicates);
}
function quickLinks() {
  const A = S.me.role === 'admin';
  const q = [['orders', I.cart, A ? 'Commandes' : 'Mes commandes'], ['entries', I.list, 'Saisie du jour'], ['leaderboard', I.crown, 'Top Sellers'], ['products', I.percent, 'Taux par produit'], ['simulator', I.calc, 'Simulateur'], A ? ['integrations', I.plug, 'Intégrations'] : ['settings', I.user, 'Mon compte']];
  return `<div class="quick">${q.map(([k, ic, t]) => `<a href="#/${k}">${ic}<span>${t}${I.arrow.replace('<svg', '<svg width="16" style="color:var(--muted)"')}</span></a>`).join('')}</div>`;
}
function costBreak(t) {
  const items = [['Publicité', t.spend, '#f6c453'], ['Produit (COGS)', t.cogs, '#8b6cff'], ['Livraison + emballage', t.ship_fees, '#4cc3ff'], ['Call center', t.cc_fees, '#2fd08a'], ['Retours', t.return_fees, '#ff5a76']];
  const tot = items.reduce((a, b) => a + (b[1] || 0), 0) || 1;
  return `<div class="stack">${items.map(i => `<i style="width:${(i[1] || 0) / tot * 100}%;background:${i[2]}"></i>`).join('')}</div>
    ${items.map(i => `<div class="legend"><span><i style="background:${i[2]}"></i>${i[0]}</span><span class="num">${money(i[1])} <span class="sub">${pct((i[1] || 0) / tot)}</span></span></div>`).join('')}`;
}
function podium(rows) {
  const top = [rows[1], rows[0], rows[2]];
  const metric = r => r.profit != null ? `<div class="m ${cls(r.profit)}">${money(r.profit)}</div><div class="x">${int(r.delivered)} livrées · ${pct(r.deliv_rate)}</div>` : `<div class="m">${int(r.delivered)}</div><div class="x">livrées · ${pct(r.deliv_rate)}</div>`;
  return `<div class="podium">${top.map(r => !r ? '<div></div>' : `<div class="pod p${r.rank}" style="${r.me ? 'outline:2px solid var(--gold);outline-offset:2px' : ''}">
      ${r.rank === 1 ? `<span class="crown">${I.crown}</span>` : `<span class="place">#${r.rank}</span>`}
      <div class="av">${initials(r.uname)}</div><b>${esc(r.uname)}${r.me ? ' (vous)' : ''}</b>${metric(r)}</div>`).join('')}</div>`;
}
const lbRow = r => `<div class="lb-row ${r.me ? 'me' : ''}"><span class="n">${r.rank}</span><span class="av sm v">${initials(r.uname)}</span><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.uname)}${r.me ? ' <span class="pill brand">vous</span>' : ''}</b>
  <span class="sub">${int(r.delivered)} livrées</span>${rate(r.deliv_rate, .6, .45)}${r.profit != null ? `<b class="num ${cls(r.profit)}" style="min-width:76px;text-align:right">${money(r.profit)}</b>` : ''}</div>`;
function topProducts(rows) {
  if (!rows.length) return empty(I.box, 'Aucun produit', '');
  const mx = Math.max(...rows.map(r => r.leads), 1);
  return `<table><thead><tr><th>Produit</th><th class="r">Leads</th><th class="r">Livrées</th><th class="r">Taux livr.</th><th class="r">Profit</th></tr></thead><tbody>
    ${rows.slice(0, 6).map(r => `<tr><td><b>${esc(r.pname)}</b><div class="sub">${esc(r.sku)}${r.country ? ' · ' + esc(r.country) : ''}</div></td>
      <td class="r num">${int(r.leads)}<span class="meter"><i style="width:${r.leads / mx * 100}%"></i></span></td><td class="r num">${int(r.delivered)}</td>
      <td class="r">${rate(r.deliv_rate, .6, .45)}</td><td class="r num"><b class="${cls(r.profit)}">${money(r.profit)}</b></td></tr>`).join('')}</tbody></table>`;
}
function geo(cities) {
  const list = (cities || []).filter(c => c.city !== '—');
  if (!list.length) return `<div class="sub" style="padding:24px 0;text-align:center">Les villes apparaissent avec les commandes des boutiques connectées.</div>`;
  const mx = Math.max(...list.map(c => c.orders), 1);
  return list.slice(0, 8).map(c => `<div style="padding:7px 0"><div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:6px"><span>${esc(c.city)}</span><span class="num">${int(c.orders)} <span class="sub">· ${int(c.delivered)} livrées</span></span></div>
    <div class="fbar" style="height:8px"><i style="width:${c.orders / mx * 100}%"></i></div></div>`).join('');
}
function dupModal(list) {
  modal('Doublons suspects', `<div class="hint">Commandes passées avec le même numéro de téléphone sur la période — à vérifier avant confirmation.</div>
    <div class="tw"><table><thead><tr><th>Téléphone</th><th>Client</th><th class="r">Commandes</th><th>Numéros</th></tr></thead><tbody>
    ${list.map(d => `<tr><td class="num">${esc(d.phone)}</td><td>${esc(d.customer || '—')}</td><td class="r"><span class="pill warn">${d.n}</span></td><td class="sub" style="white-space:normal">${esc(d.numbers)}</td></tr>`).join('')}</tbody></table></div>`, null);
}
function perfTable(rows, kind, compact) {
  if (!rows.length) return empty(I.chart, 'Aucune donnée', '');
  const label = r => kind === 'buyer' ? `<div style="display:flex;align-items:center;gap:9px"><span class="av sm v">${initials(r.uname)}</span><b>${esc(r.uname)}</b></div>`
    : kind === 'product' ? `<b>${esc(r.pname)}</b><div class="sub">${esc(r.sku)}</div>` : `<b>${esc(r[kind] || '—')}</b>`;
  const head = compact ? ['', 'Dépense', 'Livrées', 'CPD', 'Profit'] : ['', 'Dépense', 'Leads', 'CPL', 'Conf.', 'Conf %', 'Livrées', 'Livr. %', 'CPD', 'CA', 'ROAS', 'Profit', 'ROI'];
  const cells = r => compact
    ? [money(r.spend), int(r.delivered), money2(r.cpd), `<b class="${cls(r.profit)}">${money(r.profit)}</b>`]
    : [money(r.spend), int(r.leads), money2(r.cpl), int(r.confirmed), rate(r.conf_rate, .5, .35), int(r.delivered), rate(r.deliv_rate, .6, .45), money2(r.cpd), money(r.revenue), x2(r.roas), `<b class="${cls(r.profit)}">${money(r.profit)}</b>`, `<span class="${cls(r.roi)}">${pct(r.roi)}</span>`];
  return `<table><thead><tr>${head.map((h, i) => `<th class="${i ? 'r' : ''}">${h}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r, i) => `<tr><td>${kind === 'buyer' ? `<div style="display:flex;align-items:center"><span class="rank ${i < 3 ? 'g' : ''}">${i + 1}</span>${label(r)}</div>` : label(r)}</td>${cells(r).map(c => `<td class="r num">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const rate = (v, good, bad) => v == null ? '—' : `<span class="pill ${v >= good ? 'good' : v < bad ? 'bad' : 'warn'}"><span class="dot"></span>${pct(v)}</span>`;
function chartDefaults() {
  if (!window.Chart) return false;
  Chart.defaults.color = cssVar('--muted'); Chart.defaults.font.family = '"Plus Jakarta Sans", Inter, sans-serif'; Chart.defaults.font.weight = 600;
  Chart.defaults.borderColor = cssVar('--chart-grid'); return true;
}
const TOOLTIP = { backgroundColor: '#141e35', borderColor: 'rgba(148,163,184,.25)', borderWidth: 1, padding: 12, titleColor: '#eef2fa', bodyColor: '#c9d2e3', cornerRadius: 10 };
function drawDaily(daily) {
  const el = $('#cDaily'); if (!el || !chartDefaults()) return;
  const g = el.getContext('2d').createLinearGradient(0, 0, 0, 290); g.addColorStop(0, 'rgba(246,196,83,.35)'); g.addColorStop(1, 'rgba(246,196,83,0)');
  S.charts.daily = new Chart(el, {
    data: {
      labels: daily.map(d => d.date.slice(8) + '/' + d.date.slice(5, 7)),
      datasets: [
        { type: 'bar', label: 'Leads', data: daily.map(d => d.leads), backgroundColor: 'rgba(139,108,255,.38)', borderRadius: 6, yAxisID: 'y1', order: 3 },
        { type: 'bar', label: 'Livrées', data: daily.map(d => d.delivered), backgroundColor: 'rgba(47,208,138,.75)', borderRadius: 6, yAxisID: 'y1', order: 2 },
        { type: 'line', label: 'Profit', data: daily.map(d => d.profit), borderColor: '#f6c453', backgroundColor: g, fill: true, tension: .35, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5, yAxisID: 'y', order: 1 },
      ]
    },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 16 } }, tooltip: { ...TOOLTIP, callbacks: { label: c => ` ${c.dataset.label} : ${c.dataset.label === 'Profit' ? money(c.raw) : int(c.raw)}` } } },
      scales: { x: { grid: { display: false } }, y: { position: 'left', ticks: { callback: v => money(v) } }, y1: { position: 'right', grid: { display: false }, ticks: { precision: 0 } } }
    }
  });
}

// ---------- LEADERBOARD ----------
async function Leaderboard() {
  const A = S.me.role === 'admin';
  shell('leaderboard', `<div class="head"><div><div class="crumbs">Performance</div><h1>Top Sellers 🏆</h1><p>${A ? 'Classement de vos media buyers par profit net.' : 'Votre rang dans l’équipe. Les montants des autres restent privés.'}</p></div></div>
    ${filterBar({ product: false })}<div id="lb"></div>`);
  bindFilters(Leaderboard);
  const r = await api('/leaderboard' + qs({ user_id: '' }));
  if (r.hidden || !r.rows.length) { $('#lb').innerHTML = `<div class="card">${empty(I.crown, 'Pas encore de classement', 'Le podium apparaît dès les premières données de la période.')}</div>`; return; }
  const rows = r.rows; const U = Object.fromEntries(S.users.map(u => [u.id, u]));
  $('#lb').innerHTML = `
  <div class="row r11">
    <div class="card"><div class="ch"><h3>${I.crown}Podium</h3><span class="r">${esc(periodLabel())}</span></div><div class="cb" style="padding-top:30px">${podium(rows)}</div></div>
    <div class="card"><div class="ch"><h3>${I.chart}${A ? 'Profit net par buyer' : 'Livrées par buyer'}</h3></div><div class="cb"><div class="chartbox" style="height:260px"><canvas id="cLb"></canvas></div></div></div>
  </div>
  <div class="card"><div class="ch"><h3>${I.list}Classement complet</h3></div><div class="tw"><table><thead><tr><th>#</th><th>Buyer</th><th class="r">Leads</th><th class="r">Conf %</th><th class="r">Livrées</th><th class="r">Livr. %</th>${A ? '<th class="r">Dépense</th><th class="r">CPD</th><th class="r">ROAS</th><th class="r">Profit</th><th class="r">Commission</th>' : '<th class="r">Mon profit</th>'}</tr></thead><tbody>
    ${rows.map(x => { const c = U[x.user_id]?.commission_pct || 0; return `<tr style="${x.me ? 'background:var(--gold-soft)' : ''}"><td><span class="rank ${x.rank <= 3 ? 'g' : ''}">${x.rank}</span></td>
      <td><div style="display:flex;align-items:center;gap:9px"><span class="av sm ${x.rank === 1 ? '' : 'v'}">${initials(x.uname)}</span><b>${esc(x.uname)}</b>${x.me ? '<span class="pill brand">vous</span>' : ''}</div></td>
      <td class="r num">${int(x.leads)}</td><td class="r">${rate(x.conf_rate, .5, .35)}</td><td class="r num">${int(x.delivered)}</td><td class="r">${rate(x.deliv_rate, .6, .45)}</td>
      ${A ? `<td class="r num">${money(x.spend)}</td><td class="r num">${money2(x.cpd)}</td><td class="r num">${x2(x.roas)}</td><td class="r num"><b class="${cls(x.profit)}">${money(x.profit)}</b></td><td class="r num">${c ? money(Math.max(0, x.profit) * c / 100) + ` <span class="sub">${c}%</span>` : '—'}</td>`
        : `<td class="r num">${x.profit != null ? `<b class="${cls(x.profit)}">${money(x.profit)}</b>` : '<span class="sub">privé</span>'}</td>`}</tr>`; }).join('')}
  </tbody></table></div></div>`;
  if (!chartDefaults()) return;
  S.charts.lb = new Chart($('#cLb'), { type: 'bar', data: { labels: rows.map(x => firstName(x.uname)), datasets: [{ data: rows.map(x => A ? x.profit : x.delivered), backgroundColor: rows.map((x, i) => i === 0 ? '#f6c453' : x.me ? '#e9952f' : 'rgba(139,108,255,.6)'), borderRadius: 8 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { ...TOOLTIP, callbacks: { label: c => A ? money(c.raw) : int(c.raw) + ' livrées' } } }, scales: { x: { ticks: { callback: v => A ? money(v) : v } }, y: { grid: { display: false } } } } });
}

// ---------- PRODUCTS ----------
async function Products() {
  const A = S.me.role === 'admin';
  S.products = await api('/products');
  shell('products', `<div class="head"><div><div class="crumbs">Catalogue</div><h1>${A ? 'Produits & marges' : 'Mes produits'}</h1><p>Économie unitaire, buyers assignés et CPD maximum rentable.</p></div>
    ${A ? `<button class="btn pri" id="np">${I.plus}Nouveau produit</button>` : ''}</div>
    <div id="pperf"></div>
    <div class="card"><div class="ch"><h3>${I.box}Catalogue</h3><span class="r">${S.products.length} produit(s)</span></div><div class="tw">${!S.products.length ? empty(I.box, 'Aucun produit', A ? 'Créez votre premier produit pour commencer.' : 'Aucun produit ne vous est encore assigné.') : `<table><thead><tr>
      <th>Produit</th><th>Pays</th><th>Source</th><th class="r">Prix de vente</th><th class="r">Coût produit</th><th class="r">Frais / livraison</th><th class="r">CPD max rentable</th>${A ? '<th>Buyers</th><th></th>' : ''}</tr></thead><tbody>
      ${S.products.map(p => `<tr style="${p.active ? '' : 'opacity:.45'}"><td><b>${esc(p.name)}</b><div class="sub">${esc(p.sku)}</div></td><td>${esc(p.country) || '—'}</td>
        <td>${p.counts_source === 'store' ? '<span class="pill info"><span class="dot"></span>Boutique</span>' : '<span class="pill">Manuel</span>'}</td>
        <td class="r num">${nf(p.sell_price)} ${esc(p.currency)}<div class="sub">${money2(p.sell_price * p.usd_rate)}</div></td>
        <td class="r num">${money2(p.product_cost)}</td><td class="r num">${money2(p.call_center_fee + p.packaging_fee + p.shipping_fee)}</td>
        <td class="r"><span class="pill ${p.break_even_cpd > 0 ? 'brand' : 'bad'}">${money2(p.break_even_cpd)}</span></td>
        ${A ? `<td>${p.buyers.length ? p.buyers.map(b => `<span class="pill violet" style="margin:1px">${esc(b.name)}</span>`).join('') : '<span class="sub">Non assigné</span>'}</td>
        <td class="r"><button class="iconbtn" data-e="${p.id}">${I.edit.replace('<svg', '<svg width="16"')}</button></td>` : ''}</tr>`).join('')}
    </tbody></table>`}</div></div>
    <p class="sub" style="margin-top:12px">CPD max rentable = prix de vente − coût produit − call center − emballage − livraison. Au-delà, chaque livraison vous fait perdre de l’argent.</p>`);
  if (A) { $('#np').onclick = () => productModal(); $$('[data-e]').forEach(b => b.onclick = () => productModal(S.products.find(p => p.id == b.dataset.e))); }
  if (S.products.length) {
    const d = await api('/dashboard' + qs({ product_id: '' }));
    if (d.products.length && $('#pperf')) $('#pperf').innerHTML = `<div class="card" style="margin-bottom:18px"><div class="ch"><h3>${I.percent}Taux de livraison par produit</h3><span class="r">${esc(periodLabel())}</span></div><div class="tw">${perfTable(d.products, 'product')}</div></div>`;
  }
}
function productModal(p = {}) {
  const buyers = S.users.filter(u => u.role === 'buyer');
  const sel = new Set((p.buyers || []).map(b => b.id));
  const fld = (k, l, t = 'number', hint = '') => `<label class="f">${l}${hint ? ` <small>${hint}</small>` : ''}<input name="${k}" type="${t}" step="any" value="${esc(p[k] ?? (t === 'number' ? (k === 'usd_rate' ? 1 : 0) : ''))}"></label>`;
  modal(p.id ? 'Modifier le produit' : 'Nouveau produit', `
    <div class="grid-form">${fld('name', 'Nom', 'text')}${fld('sku', 'SKU', 'text')}${fld('country', 'Pays', 'text')}${fld('currency', 'Devise', 'text', 'MAD, IQD…')}</div>
    <div class="grid-form">${fld('sell_price', 'Prix de vente', 'number', 'devise locale')}${fld('usd_rate', '1 devise = ? USD')}${fld('product_cost', 'Coût produit', 'number', 'USD / unité')}</div>
    <div class="grid-form">${fld('call_center_fee', 'Call center', 'number', 'USD / confirmée')}${fld('packaging_fee', 'Emballage', 'number', 'USD / expédiée')}${fld('shipping_fee', 'Livraison', 'number', 'USD / expédiée')}${fld('return_fee', 'Frais retour', 'number', 'USD / retour')}</div>
    <div><div class="sub" style="margin-bottom:8px;font-weight:700">Media buyers assignés</div>
      <div style="display:flex;flex-wrap:wrap;gap:14px">${buyers.length ? buyers.map(b => `<label class="chk"><input type="checkbox" name="b" value="${b.id}" ${sel.has(b.id) ? 'checked' : ''}>${esc(b.name)}</label>`).join('') : '<span class="sub">Créez d’abord vos media buyers.</span>'}</div></div>
    <label class="f">Leads & statuts proviennent de<select name="counts_source"><option value="manual" ${p.counts_source !== 'store' ? 'selected' : ''}>Saisie manuelle / CSV (le buyer les saisit)</option><option value="store" ${p.counts_source === 'store' ? 'selected' : ''}>Boutique connectée (automatique — le buyer saisit seulement la dépense)</option></select></label>
    <label class="chk"><input type="checkbox" name="active" ${p.active === 0 ? '' : 'checked'}> Actif</label>`,
    async f => {
      const b = Object.fromEntries(new FormData(f)); b.active = !!f.active.checked; b.buyer_ids = $$('[name=b]:checked', f).map(x => +x.value);
      await api('/products' + (p.id ? '/' + p.id : ''), { method: p.id ? 'PUT' : 'POST', body: b });
      toast('Produit enregistré'); await loadRefs(); Products();
    },
    p.id ? async () => { if (!confirm('Supprimer ce produit ET toutes ses données ?')) return false; await api('/products/' + p.id, { method: 'DELETE' }); toast('Supprimé'); await loadRefs(); Products(); } : null);
}

// ---------- ENTRIES ----------
async function Entries() {
  const A = S.me.role === 'admin';
  shell('entries', `<div class="head"><div><div class="crumbs">Principal</div><h1>${A ? 'Données journalières' : 'Mes dépenses & données'}</h1><p>Une ligne par jour × produit × plateforme. Réenregistrer la même combinaison la met à jour.</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="imp">${I.upload}Importer CSV</button><button class="btn" id="exp">${I.download}Exporter</button><button class="btn pri" id="ne">${I.plus}Saisie du jour</button></div></div>
    ${filterBar()}<div class="card"><div class="tw" id="el">${empty(I.list, 'Chargement…', '')}</div></div>`);
  bindFilters(Entries);
  $('#ne').onclick = () => entryModal(); $('#imp').onclick = importModal;
  const rows = await api('/stats' + qs());
  $('#exp').onclick = () => exportCsv(rows);
  if (location.hash.includes('new=1')) { history.replaceState(null, '', '#/entries'); entryModal(); }
  $('#el').innerHTML = !rows.length ? empty(I.list, 'Aucune saisie sur cette période', 'Ajoutez votre dépense pub du jour.', `<button class="btn pri" id="ne2">${I.plus}Saisie du jour</button>`) : `<table><thead><tr>
    <th>Date</th>${A ? '<th>Buyer</th>' : ''}<th>Produit</th><th>Plateforme</th><th class="r">Dépense</th><th class="r">Leads</th><th class="r">CPL</th><th class="r">Conf.</th><th class="r">Exp.</th><th class="r">Livrées</th><th class="r">Retours</th><th class="r">CPD</th><th class="r">Profit</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="num">${r.date}</td>${A ? `<td>${esc(r.uname)}</td>` : ''}<td><b>${esc(r.pname)}</b></td><td><span class="pill">${esc(r.platform)}</span></td>
      <td class="r num">${money2(r.spend)}</td><td class="r num">${int(r.leads)}</td><td class="r num">${money2(r.cpl)}</td><td class="r num">${int(r.confirmed)}</td><td class="r num">${int(r.shipped)}</td>
      <td class="r num">${int(r.delivered)}</td><td class="r num">${int(r.returned)}</td><td class="r num">${money2(r.cpd)}</td><td class="r num"><b class="${cls(r.profit)}">${money(r.profit)}</b></td>
      <td class="r"><button class="iconbtn" data-e="${r.id}">${I.edit.replace('<svg', '<svg width="16"')}</button><button class="iconbtn" data-d="${r.id}">${I.trash.replace('<svg', '<svg width="16"')}</button></td></tr>`).join('')}
  </tbody></table>`;
  if ($('#ne2')) $('#ne2').onclick = () => entryModal();
  $$('[data-e]').forEach(b => b.onclick = () => entryModal(rows.find(r => r.id == b.dataset.e)));
  $$('[data-d]').forEach(b => b.onclick = async () => { if (!confirm('Supprimer cette saisie ?')) return; await api('/stats/' + b.dataset.d, { method: 'DELETE' }); toast('Supprimée'); Entries(); });
}
function entryModal(r = {}) {
  const A = S.me.role === 'admin';
  const prods = S.products.filter(p => p.active || p.id === r.product_id);
  if (!prods.length) return toast(A ? 'Créez d’abord un produit' : 'Aucun produit ne vous est assigné', true);
  const AUTO = ['leads', 'confirmed', 'cancelled', 'shipped', 'delivered', 'returned', 'upsells'];
  const n = (k, l, hint = '') => `<label class="f">${l}${hint ? ` <small>${hint}</small>` : ''}<input name="${k}" type="number" min="0" step="any" value="${r[k] ?? ''}" placeholder="0" ${AUTO.includes(k) ? 'data-auto' : ''}></label>`;
  modal(r.id ? 'Modifier la saisie' : 'Saisie du jour', `
    <div class="grid-form">
      <label class="f">Date<input name="date" type="date" value="${r.date || ymd(new Date())}" required></label>
      ${A ? `<label class="f">Media buyer<select name="user_id">${S.users.map(u => `<option value="${u.id}" ${(r.user_id || S.f.user_id || S.me.id) == u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>` : ''}
      <label class="f">Produit<select name="product_id">${prods.map(p => `<option value="${p.id}" ${r.product_id == p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="f">Plateforme<select name="platform">${PLATFORMS.map(p => `<option ${r.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    </div>
    <div class="grid-form">${n('spend', 'Dépense pub', 'USD')}${n('leads', 'Leads')}${n('confirmed', 'Confirmées')}${n('cancelled', 'Annulées')}${n('wrong', 'Faux numéros')}${n('duplicate', 'Doublons')}</div>
    <div class="grid-form">${n('shipped', 'Expédiées')}${n('delivered', 'Livrées')}${n('returned', 'Retours')}${n('upsells', 'Upsells')}${n('revenue_override', 'CA manuel', 'devise locale, optionnel')}</div>
    <label class="f">Notes<textarea name="notes" rows="2" placeholder="Créa testée, audience, remarques…">${esc(r.notes || '')}</textarea></label>
    <div class="hint gold" id="autohint" style="display:none">Ce produit est relié à une boutique : leads et statuts arrivent automatiquement. Saisissez seulement votre <b>dépense pub</b>.</div>
    <div class="hint" id="live"></div>`,
    async f => { await api('/stats', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); toast('Enregistré'); route(); });
  const f = $('#mform');
  const live = () => {
    const p = S.products.find(x => x.id == f.product_id.value) || {};
    const auto = p.counts_source === 'store';
    $$('[data-auto]', f).forEach(i => i.disabled = auto); $('#autohint').style.display = auto ? '' : 'none';
    const v = Object.fromEntries(new FormData(f)); const g = k => +v[k] || 0;
    const rev = ((v.revenue_override ?? '') !== '' ? g('revenue_override') : g('delivered') * p.sell_price) * (p.usd_rate || 1);
    const cost = g('delivered') * p.product_cost + g('confirmed') * p.call_center_fee + (g('delivered') + g('returned')) * (p.packaging_fee + p.shipping_fee) + g('returned') * p.return_fee;
    const profit = rev - cost - g('spend');
    $('#live').innerHTML = auto ? `CPD max rentable pour ce produit : <b>${money2(p.break_even_cpd)}</b>` : `CPL <b>${money2(g('leads') ? g('spend') / g('leads') : null)}</b> · Conf. <b>${pct(g('leads') ? g('confirmed') / g('leads') : null)}</b> · CPD <b>${money2(g('delivered') ? g('spend') / g('delivered') : null)}</b> (max ${money2(p.break_even_cpd)}) · CA <b>${money(rev)}</b> · Profit <b class="${cls(profit)}">${money(profit)}</b>`;
  };
  f.addEventListener('input', live); live();
}
function importModal() {
  modal('Importer un CSV', `
    <div class="hint">Colonnes (ligne d’en-tête obligatoire) : <b>date, sku, platform, spend, leads, confirmed, cancelled, wrong, duplicate, shipped, delivered, returned, upsells, notes</b>${S.me.role === 'admin' ? ', <b>username</b>' : ''}.<br>Format de date AAAA-MM-JJ. Les lignes existantes (jour × produit × plateforme) sont mises à jour.</div>
    <button type="button" class="btn sm" id="tpl" style="align-self:flex-start">${I.download}Télécharger le modèle</button>
    <input type="file" name="file" accept=".csv,text/csv" required>`,
    async f => {
      const rows = parseCsv(await f.file.files[0].text());
      const r = await api('/stats/import', { method: 'POST', body: { rows } });
      toast(`${r.ok} ligne(s) importée(s)${r.errors.length ? `, ${r.errors.length} erreur(s)` : ''}`, !!r.errors.length);
      if (r.errors.length) alert(r.errors.join('\n'));
      Entries();
    });
  $('#tpl').onclick = () => download('modele.csv', 'date,sku,platform,spend,leads,confirmed,cancelled,wrong,duplicate,shipped,delivered,returned,upsells,notes' + (S.me.role === 'admin' ? ',username' : '') + `\n${ymd(new Date())},${S.products[0]?.sku || 'SKU-1'},Meta,50,40,26,6,4,1,24,20,4,2,` + (S.me.role === 'admin' ? `,${S.users.find(u => u.role === 'buyer')?.username || ''}` : ''));
}
function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  const split = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if ((ch === ',' || ch === ';') && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
  const h = split(lines[0]).map(s => s.toLowerCase());
  return lines.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [h[i], v])));
}
function exportCsv(rows) {
  const cols = ['date', 'uname', 'sku', 'pname', 'platform', 'spend', 'leads', 'confirmed', 'cancelled', 'wrong', 'duplicate', 'shipped', 'delivered', 'returned', 'upsells', 'revenue', 'profit', 'cpl', 'cpd', 'roas', 'notes'];
  const q = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : (typeof v === 'number' ? +v.toFixed(4) : v);
  download(`sellerhub_${S.from}_${S.to}.csv`, cols.join(',') + '\n' + rows.map(r => cols.map(c => q(r[c])).join(',')).join('\n'));
}
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); }

// ---------- SIMULATOR ----------
function Simulator() {
  shell('simulator', `<div class="head"><div><div class="crumbs">Performance</div><h1>Simulateur de profit</h1><p>Testez les chiffres d’un produit avant de scaler.</p></div></div>
  <div class="row r2"><div class="card"><div class="ch"><h3>${I.calc}Hypothèses</h3></div><div class="cb"><form id="sim" class="grid-form">
    <label class="f">Produit<select name="pid"><option value="">Personnalisé</option>${S.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
    ${[['price', 'Prix de vente (USD)', 30], ['cost', 'Coût produit', 6], ['fees', 'Frais / livraison', 6], ['cpl', 'CPL', 1.5], ['conf', 'Confirmation %', 60], ['deliv', 'Livraison % (des conf.)', 65], ['leads', 'Leads / jour', 100]]
      .map(([k, l, v]) => `<label class="f">${l}<input name="${k}" type="number" step="any" value="${v}"></label>`).join('')}
  </form></div></div><div id="simr"></div></div>`);
  const f = $('#sim');
  f.pid.onchange = () => { const p = S.products.find(x => x.id == f.pid.value); if (!p) return; f.price.value = +(p.sell_price * p.usd_rate).toFixed(2); f.cost.value = p.product_cost; f.fees.value = +(p.call_center_fee + p.packaging_fee + p.shipping_fee).toFixed(2); calc(); };
  const calc = () => {
    const v = Object.fromEntries([...new FormData(f)].map(([k, x]) => [k, +x || 0]));
    const del = v.leads * v.conf / 100 * v.deliv / 100, spend = v.leads * v.cpl, cpd = del ? spend / del : 0;
    const unit = v.price - v.cost - v.fees, profit = del * unit - spend, beCpl = unit * (v.conf / 100) * (v.deliv / 100);
    $('#simr').innerHTML = `<div class="wallet ${profit < 0 ? 'neg' : ''}" style="margin:0;height:100%"><div class="ring"></div><div class="lbl">Profit / jour</div><div class="big num">${money(profit)}</div><div class="sub2">${money(profit * 30)} / mois</div>
      <div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">${[['Dépense / jour', money(spend)], ['Livrées / jour', del.toFixed(1).replace('.', ',')], ['CPD', money2(cpd)], ['CPD max', money2(unit)], ['CPL max', money2(beCpl)], ['ROAS', x2(spend ? del * v.price / spend : null)]]
        .map(([l, x]) => `<div class="tile"><span>${l}</span><b class="num">${x}</b></div>`).join('')}</div></div>`;
  };
  f.oninput = calc; calc();
}

// ---------- TEAM ----------
async function Team() {
  S.users = await api('/users');
  shell('team', `<div class="head"><div><div class="crumbs">Administration</div><h1>Media buyers</h1><p>Créez les accès, fixez les commissions et contrôlez qui se connecte.</p></div><button class="btn pri" id="nu">${I.plus}Nouveau media buyer</button></div>
  <div class="card"><div class="tw"><table><thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th class="r">Produits</th><th class="r">Commission</th><th>Statut</th><th>Créé le</th><th></th></tr></thead><tbody>
  ${S.users.map(u => `<tr><td><div style="display:flex;align-items:center;gap:10px"><span class="av sm ${u.role === 'admin' ? '' : 'v'}">${initials(u.name)}</span><b>${esc(u.name)}</b></div></td>
    <td class="num">${esc(u.username)}</td><td><span class="pill ${u.role === 'admin' ? 'brand' : 'violet'}">${u.role === 'admin' ? 'Admin' : 'Media buyer'}</span></td>
    <td class="r num">${u.products}</td><td class="r num">${u.commission_pct ? u.commission_pct + ' %' : '—'}</td>
    <td><span class="pill ${u.active ? 'good' : 'bad'}"><span class="dot"></span>${u.active ? 'Actif' : 'Bloqué'}</span></td><td class="sub">${u.created_at.slice(0, 10)}</td>
    <td class="r">${u.role === 'buyer' ? `<button class="btn sm" data-view="${u.id}">${I.eye.replace('<svg', '<svg width="14"')}Voir</button> ` : ''}<button class="iconbtn" data-e="${u.id}">${I.edit.replace('<svg', '<svg width="16"')}</button></td></tr>`).join('')}
  </tbody></table></div></div>`);
  $('#nu').onclick = () => userModal();
  $$('[data-e]').forEach(b => b.onclick = () => userModal(S.users.find(u => u.id == b.dataset.e)));
  $$('[data-view]').forEach(b => b.onclick = () => { S.f.user_id = b.dataset.view; location.hash = '#/overview'; });
}
function userModal(u = {}) {
  const gen = () => Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(Math.random() * 90 + 10);
  modal(u.id ? 'Modifier ' + esc(u.name) : 'Nouveau media buyer', `
    <div class="grid-form">
      <label class="f">Nom complet<input name="name" value="${esc(u.name || '')}" required></label>
      <label class="f">Identifiant<input name="username" value="${esc(u.username || '')}" ${u.id ? 'disabled' : 'required'} autocomplete="off" placeholder="ex : yassine"></label>
      <label class="f">${u.id ? 'Nouveau mot de passe' : 'Mot de passe'} <small>${u.id ? 'laisser vide pour garder' : '6 caractères min.'}</small><div style="display:flex;gap:6px"><input name="password" id="pw" ${u.id ? '' : 'required'} autocomplete="new-password"><button type="button" class="btn sm" id="gen">Générer</button></div></label>
      <label class="f">Commission <small>% du profit net</small><input name="commission_pct" type="number" step="any" value="${u.commission_pct || 0}"></label>
      <label class="f">Rôle<select name="role"><option value="buyer" ${u.role !== 'admin' ? 'selected' : ''}>Media buyer</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin (voit tout)</option></select></label>
    </div>
    ${u.id ? `<label class="chk"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Actif (décocher pour bloquer la connexion)</label>` : ''}
    <div class="hint gold">Après l’enregistrement, les accès (lien + identifiant + mot de passe) sont copiés : envoyez-les à votre buyer. Il ne voit que ses produits et ses chiffres.</div>`,
    async f => {
      const b = Object.fromEntries(new FormData(f));
      if (u.id) { b.active = !!f.active.checked; await api('/users/' + u.id, { method: 'PUT', body: b }); } else await api('/users', { method: 'POST', body: b });
      if (b.password) { try { await navigator.clipboard.writeText(`${S.me.appName} : ${location.origin}\nIdentifiant : ${u.username || b.username.toLowerCase()}\nMot de passe : ${b.password}`); toast('Enregistré — accès copiés'); } catch { toast('Enregistré'); } } else toast('Enregistré');
      await loadRefs(); Team();
    },
    u.id && u.id !== S.me.id ? async () => { if (!confirm(`Supprimer ${u.name} et TOUTES ses données ? (Astuce : bloquer garde l’historique.)`)) return false; await api('/users/' + u.id, { method: 'DELETE' }); toast('Supprimé'); await loadRefs(); Team(); } : null);
  $('#gen').onclick = () => { $('#pw').value = gen(); };
}

// ---------- PLATFORM SETTINGS (admin) ----------
function Platform() {
  shell('platform', `<div class="head"><div><div class="crumbs">Administration</div><h1>Paramètres plateforme</h1><p>Communication à l’équipe et visibilité du classement.</p></div></div>
  <div class="card" style="max-width:720px"><div class="cb"><form id="psf" style="display:flex;flex-direction:column;gap:16px">
    <label class="f">Annonce affichée à toute l’équipe <small>laisser vide pour masquer</small><input name="announcement" maxlength="300" value="${esc(S.settings.announcement)}" placeholder="ex : Objectif du mois : 2 000 livrées 🚀"></label>
    <label class="chk"><input type="checkbox" name="leaderboard_public" ${S.settings.leaderboard_public ? 'checked' : ''}> Les media buyers voient le classement Top Sellers (rang, livrées, taux — jamais l’argent des autres)</label>
    <button class="btn pri" style="align-self:flex-start">Enregistrer</button></form></div></div>`);
  $('#psf').onsubmit = async e => { e.preventDefault(); const f = e.target; S.settings = await api('/settings', { method: 'PUT', body: { announcement: f.announcement.value, leaderboard_public: f.leaderboard_public.checked } }); toast('Paramètres enregistrés'); route(); };
}

// ---------- ACCOUNT ----------
function Settings() {
  shell('settings', `<div class="head"><div><div class="crumbs">Compte</div><h1>Mon compte</h1><p>Connecté en tant que <b>${esc(S.me.username)}</b></p></div></div>
  <div class="card" style="max-width:480px"><div class="ch"><h3>${I.lock}Changer le mot de passe</h3></div><div class="cb"><form id="pf" style="display:flex;flex-direction:column;gap:14px">
    <label class="f">Mot de passe actuel<input name="current" type="password" required></label>
    <label class="f">Nouveau mot de passe<input name="next" type="password" minlength="6" required></label>
    <button class="btn pri" style="align-self:flex-start">Mettre à jour</button></form></div></div>`);
  $('#pf').onsubmit = async e => { e.preventDefault(); try { await api('/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Mot de passe mis à jour'); e.target.reset(); } catch (er) { toast(er.message, true); } };
}

// ---------- modal ----------
function modal(title, body, onSave, onDelete) {
  $('#modal-root').innerHTML = `<div class="ov"><form class="modal" id="mform"><div class="mh"><h3>${title}</h3><button type="button" class="iconbtn" data-x>✕</button></div>
    <div class="mb">${body}</div><div class="mf">${onDelete ? '<button type="button" class="btn danger" id="mdel" style="margin-right:auto">Supprimer</button>' : ''}
    ${onSave ? '<button type="button" class="btn" data-x>Annuler</button><button class="btn pri">Enregistrer</button>' : '<button type="button" class="btn pri" data-x>Fermer</button>'}</div></form></div>`;
  const close = () => $('#modal-root').innerHTML = '';
  $$('[data-x]').forEach(b => b.onclick = close);
  $('.ov').onmousedown = e => e.target.classList.contains('ov') && close();
  $('#mform').onsubmit = async e => {
    e.preventDefault(); if (!onSave) return close();
    const b = e.target.querySelector('.btn.pri'); if (b.disabled) return; const t = b.textContent; b.disabled = true; b.textContent = 'Enregistrement…';
    try { await onSave(e.target); close(); } catch (er) { toast(er.message, true); b.disabled = false; b.textContent = t; }
  };
  if (onDelete) $('#mdel').onclick = async () => { try { if (await onDelete() !== false) close(); } catch (er) { toast(er.message, true); } };
}

boot();
