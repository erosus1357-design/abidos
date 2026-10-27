/* Sellerhub — Commandes + Intégrations boutiques (chargé avant app.js ; utilise ses helpers à l'exécution) */
const STATUS_LIST = ['new', 'confirmed', 'cancelled', 'shipped', 'delivered', 'returned'];
const STATUS_FR = { new: 'Nouvelle', confirmed: 'Confirmée', cancelled: 'Annulée', shipped: 'Expédiée', delivered: 'Livrée', returned: 'Retour' };
const STATUS_PILL = { new: '', confirmed: 'violet', cancelled: 'bad', shipped: 'info', delivered: 'good', returned: 'warn' };
const KIND = {
  shopify: { name: 'Shopify', color: '#5e8e3e', logo: 'S', sub: 'API ou webhooks' },
  youcan: { name: 'YouCan', color: '#7c3aed', logo: 'Y', sub: 'Webhook' },
  lightfunnels: { name: 'LightFunnels', color: '#2563eb', logo: 'L', sub: 'Webhook' },
  dropify: { name: 'Dropify', color: '#ea580c', logo: 'D', sub: 'Webhook / Sheets' },
  sheets: { name: 'Google Sheets', color: '#16a34a', logo: 'G', sub: 'Toute boutique → Sheets' },
  custom: { name: 'Autre plateforme', color: '#475569', logo: '⚡', sub: 'Zapier, Make, n8n…' },
};
const kindBadge = (k, size = 34) => `<span style="width:${size}px;height:${size}px;border-radius:${size * .3}px;background:${KIND[k]?.color || '#475569'};color:#fff;display:inline-grid;place-items:center;font-weight:800;font-size:${size * .42}px;flex:none;box-shadow:0 4px 12px ${KIND[k]?.color || '#475569'}55">${KIND[k]?.logo || '?'}</span>`;
const hookUrl = i => `${location.origin}/hook/${i.token}`;
const ago = t => { if (!t) return 'jamais'; const s = (Date.now() - new Date(t.replace(' ', 'T') + 'Z')) / 1000; return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : s < 86400 ? `il y a ${Math.floor(s / 3600)} h` : `il y a ${Math.floor(s / 86400)} j`; };

// ---------- COMMANDES ----------
async function Orders() {
  const A = S.me.role === 'admin';
  S.of = S.of || { status: '', q: '' };
  shell('orders', `<div class="head"><div><div class="crumbs">Principal</div><h1>${A ? 'Commandes' : 'Mes commandes'}</h1><p>Commandes reçues des boutiques connectées, attribuées aux buyers via UTM / produit.</p></div>
    ${A ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="simp">${I.upload}Mettre à jour les statuts</button><a class="btn" href="#/integrations">${I.plug}Connecter une boutique</a></div>` : ''}</div>
    ${filterBar()}
    <div class="filters" style="padding:8px 10px"><div class="seg" id="stseg"></div><span class="sp"></span><input id="oq" placeholder="Rechercher n°, client, téléphone, campagne…" value="${esc(S.of.q)}" style="max-width:300px;padding:7px 12px"></div>
    <div class="card"><div class="tw" id="ol">${empty(I.cart, 'Chargement…', '')}</div></div>`);
  bindFilters(Orders);
  if (A) $('#simp').onclick = statusImportModal;
  let t; $('#oq').oninput = e => { clearTimeout(t); t = setTimeout(() => { S.of.q = e.target.value; loadOrders(); }, 300); };
  loadOrders();
}
async function loadOrders() {
  const A = S.me.role === 'admin';
  const d = await api('/orders' + qs({ status: S.of.status, q: S.of.q }));
  if (!$('#stseg')) return;
  const cnt = Object.fromEntries(d.counts.map(c => [c.status, c.n])); const total = d.counts.reduce((a, c) => a + c.n, 0);
  $('#stseg').innerHTML = [['', 'Toutes', total], ...STATUS_LIST.map(s => [s, STATUS_FR[s], cnt[s] || 0])].map(([k, l, n]) => `<button data-s="${k}" class="${S.of.status === k ? 'on' : ''}">${l} <span style="opacity:.6">${n}</span></button>`).join('');
  $$('#stseg [data-s]').forEach(b => b.onclick = () => { S.of.status = b.dataset.s; loadOrders(); });
  const rows = d.rows;
  $('#ol').innerHTML = !rows.length ? empty(I.cart, 'Aucune commande sur cette période', A ? 'Connectez une boutique pour recevoir les commandes automatiquement.' : 'Vos commandes apparaîtront ici.', A ? `<a class="btn pri" href="#/integrations">${I.plug}Connecter une boutique</a>` : '') : `<table><thead><tr>
    <th>Date</th><th>Commande</th><th>Boutique</th><th>Produit</th>${A ? '<th>Buyer</th>' : ''}<th>Source</th><th>Campagne</th><th>Client</th><th class="r">Total</th><th>Statut</th></tr></thead><tbody>
    ${rows.map(o => `<tr><td class="num">${o.date}<div class="sub">${o.created_at ? esc(String(o.created_at).slice(11, 16)) : ''}</div></td>
      <td class="num"><b>#${esc(o.number || o.ext_id)}</b>${o.quantity > 1 ? ` <span class="pill brand">×${o.quantity}</span>` : ''}</td>
      <td><div style="display:flex;align-items:center;gap:8px">${kindBadge(o.kind, 22)}<span class="sub">${esc(o.store || '—')}</span></div></td>
      <td>${o.pname ? `<b>${esc(o.pname)}</b>` : `<span class="pill warn" title="À relier dans Intégrations">Non relié</span><div class="sub">${esc(o.item_title || o.ext_key)}</div>`}</td>
      ${A ? `<td>${o.uname ? esc(o.uname) : '<span class="pill bad">Sans buyer</span>'}</td>` : ''}
      <td><span class="pill">${esc(o.platform)}</span></td><td class="sub">${esc(o.utm_campaign || '—')}</td>
      <td>${esc(o.customer || '—')}<div class="sub">${esc([o.city, o.phone].filter(Boolean).join(' · '))}</div></td>
      <td class="r num">${o.total ? nf(o.total) + ' ' + esc(o.currency) : '—'}</td>
      <td>${A ? `<select data-o="${o.id}" style="width:auto;padding:5px 28px 5px 9px;font-size:12px;font-weight:700">${STATUS_LIST.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${STATUS_FR[s]}</option>`).join('')}</select>` : `<span class="pill ${STATUS_PILL[o.status]}"><span class="dot"></span>${STATUS_FR[o.status] || o.status}</span>`}</td></tr>`).join('')}
  </tbody></table>`;
  $$('[data-o]').forEach(s => s.onchange = async () => { await api('/orders/' + s.dataset.o, { method: 'PUT', body: { status: s.value } }); toast('Statut mis à jour'); loadOrders(); });
}
function statusImportModal() {
  modal('Mettre à jour les statuts', `
    <div class="hint">Importez un CSV à deux colonnes : <b>number</b> (n° de commande, référence ou téléphone) et <b>status</b>.<br>
    Statuts acceptés : confirmé, annulé, expédié, livré, retour (ou new, confirmed, cancelled, shipped, delivered, returned).<br>
    Idéal avec l’export de commandes de votre call center / plateforme COD pour mettre à jour confirmations et livraisons en une fois.</div>
    <input type="file" name="file" accept=".csv,text/csv" required>`,
    async f => {
      const rows = parseCsv(await f.file.files[0].text());
      const r = await api('/orders/status-import', { method: 'POST', body: { rows } });
      toast(`${r.ok} commande(s) mise(s) à jour${r.missing.length ? `, ${r.missing.length} introuvable(s)` : ''}`, !!r.missing.length);
      if (r.missing.length) alert('Introuvables :\n' + r.missing.join('\n'));
      loadOrders();
    });
}

// ---------- INTÉGRATIONS ----------
async function Integrations() {
  const list = await api('/integrations');
  shell('integrations', `<div class="head"><div><div class="crumbs">Administration</div><h1>Intégrations boutiques</h1><p>Connectez vos boutiques : chaque commande arrive ici et compte comme lead pour le bon buyer.</p></div></div>
    <div class="card" style="margin-bottom:18px"><div class="ch"><h3>${I.plug}Connecter une boutique</h3><span class="r">une connexion par boutique</span></div><div class="cb">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
        ${Object.entries(KIND).map(([k, v]) => `<button class="btn" data-k="${k}" style="justify-content:flex-start;padding:14px;gap:12px;border-radius:14px">${kindBadge(k, 34)}<span style="text-align:left"><b style="font-size:14px">${v.name}</b><div class="sub">${v.sub}</div></span></button>`).join('')}
      </div></div></div>
    ${list.length ? `<div class="card"><div class="ch"><h3>${I.check}Connectées</h3><span class="r">${list.length} boutique(s)</span></div><div class="tw"><table><thead><tr><th>Boutique</th><th>Buyer par défaut</th><th class="r">Commandes</th><th>Produits</th><th>Dernière commande</th><th>Statut</th><th></th></tr></thead><tbody>
      ${list.map(i => `<tr><td><div style="display:flex;align-items:center;gap:12px">${kindBadge(i.kind, 32)}<div><b>${esc(i.name)}</b><div class="sub">${KIND[i.kind]?.name}${i.has_api ? ' · sync API' : ' · webhook'}</div></div></div></td>
        <td>${esc(i.buyer_name || '—')}</td><td class="r num">${int(i.orders)}</td>
        <td>${i.unmapped ? `<span class="pill warn">${i.unmapped} à relier</span>` : '<span class="pill good"><span class="dot"></span>Tous reliés</span>'}</td>
        <td class="sub">${ago(i.last_event_at || i.last_sync_at)}</td>
        <td>${!i.active ? '<span class="pill">En pause</span>' : i.last_error ? `<span class="pill bad" title="${esc(i.last_error)}"><span class="dot"></span>Erreur</span>` : (i.last_event_at || i.last_sync_at) ? '<span class="pill good"><span class="dot"></span>Reçoit</span>' : '<span class="pill warn"><span class="dot"></span>En attente</span>'}</td>
        <td class="r"><button class="btn sm" data-open="${i.id}">Gérer</button></td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
    <div class="card" style="margin-top:18px"><div class="ch"><h3>${I.target}Attribution des commandes aux media buyers</h3></div><div class="cb" style="line-height:1.8;font-size:13px">
      <b>1. UTM dans le lien de la pub (recommandé) :</b> ajoutez <code>utm_source=facebook&amp;utm_content=IDENTIFIANT</code> au lien de chaque buyer (tiktok / google / snapchat comme source). La commande va au bon buyer et à la bonne plateforme.<br>
      <b>2. Assignation produit :</b> sans identifiant dans les UTM, la commande va au buyer assigné au produit.<br>
      <b>3. Correction manuelle :</b> l’admin peut changer le statut de n’importe quelle commande depuis la page Commandes.
    </div></div>`);
  $$('[data-k]').forEach(b => b.onclick = () => integrationForm({ kind: b.dataset.k }));
  $$('[data-open]').forEach(b => b.onclick = () => integrationDetail(list.find(i => i.id == b.dataset.open)));
}

function integrationForm(i) {
  const buyers = S.users.filter(u => u.role === 'buyer' && u.active);
  const isNew = !i.id;
  modal(`${isNew ? 'Connecter' : 'Modifier'} ${KIND[i.kind].name}`, `
    <div class="grid-form">
      <label class="f">Nom de la boutique<input name="name" value="${esc(i.name || '')}" placeholder="ex : Boutique Maroc" required></label>
      <label class="f">Buyer par défaut <small>si les UTM ne disent rien</small><select name="default_user_id"><option value="">— aucun —</option>${buyers.map(u => `<option value="${u.id}" ${i.default_user_id == u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
      <label class="f">Plateforme par défaut<select name="default_platform">${PLATFORMS.map(p => `<option ${(i.default_platform || 'Meta') === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    </div>
    ${i.kind === 'shopify' ? `<div class="hint gold"><b>Synchronisation API automatique (recommandée pour Shopify)</b> — laissez vide pour utiliser uniquement les webhooks.</div>
    <div class="grid-form"><label class="f">Domaine Shopify<input name="api_domain" value="${esc(i.api_domain || '')}" placeholder="maboutique.myshopify.com"></label>
    <label class="f">Token Admin API<input name="api_token" value="${esc(i.api_token || '')}" placeholder="shpat_…" autocomplete="off"></label></div>` : ''}
    <label class="f">Clé de signature webhook <small>optionnelle — collez-la si la boutique en affiche une</small><input name="secret" value="${esc(i.secret || '')}" autocomplete="off"></label>
    ${isNew ? '' : `<label class="chk"><input type="checkbox" name="active" ${i.active ? 'checked' : ''}> Active</label>`}`,
    async f => {
      const b = Object.fromEntries(new FormData(f)); b.kind = i.kind;
      if (!isNew) { b.active = !!f.active.checked; await api('/integrations/' + i.id, { method: 'PUT', body: b }); toast('Enregistré'); Integrations(); return; }
      const r = await api('/integrations', { method: 'POST', body: b });
      toast('Boutique connectée — suivez les étapes');
      const list = await api('/integrations'); await Integrations(); integrationDetail(list.find(x => x.id == r.id));
    },
    isNew ? null : async () => {
      if (!confirm('Supprimer cette connexion ? Les commandes déjà reçues sont conservées.')) return false;
      await api('/integrations/' + i.id, { method: 'DELETE' }); toast('Déconnectée'); Integrations();
    });
}

function setupSteps(i) {
  const url = hookUrl(i);
  const box = `<div style="display:flex;gap:6px;margin:6px 0 14px"><input readonly value="${esc(url)}" id="hu" style="font-family:ui-monospace,monospace;font-size:12px"><button type="button" class="btn sm" id="cpy">${I.copy.replace('<svg', '<svg width="14"')}Copier</button></div>`;
  const ol = steps => `<ol style="margin:0;padding-left:20px;line-height:1.85;font-size:13px">${steps.map(s => `<li>${s}</li>`).join('')}</ol>`;
  const S2 = {
    shopify: `<b>Option A — Synchronisation API (sans webhook)</b>${ol([
      'Admin Shopify → <b>Paramètres → Applications et canaux de vente → Développer des applications</b> → <b>Créer une application</b>.',
      '<b>Configurer les accès Admin API</b> → cochez <code>read_orders</code> (et <code>read_products</code>) → Enregistrer → <b>Installer l’application</b>.',
      'Copiez le <b>token d’accès Admin API</b> (shpat_…) → cliquez <b>Modifier</b> ici et collez-le avec votre domaine <code>xxx.myshopify.com</code>.',
      'Les commandes se synchronisent toutes les 10 minutes, ou cliquez <b>Synchroniser</b>.'])}
      <div style="margin-top:14px"><b>Option B — Webhooks (instantané)</b></div>${ol([
      'Admin Shopify → <b>Paramètres → Notifications → Webhooks</b> → <b>Créer un webhook</b>.',
      'Événement <b>Création de commande</b>, format <b>JSON</b>, collez l’URL ci-dessus. Répétez pour <b>Mise à jour</b>, <b>Annulation</b> et <b>Traitement de commande</b>.',
      'Copiez la clé de signature affichée sous la liste des webhooks → collez-la dans <b>Modifier → Clé de signature</b>.'])}`,
    youcan: ol([
      'Ouvrez le tableau de bord de votre boutique YouCan et allez dans la section <b>Webhooks</b> (Paramètres / Intégrations, ou via une app webhooks du YouCan App Store).',
      'Ajoutez un webhook avec l’URL ci-dessus pour les événements de commande : <b>création</b>, <b>mise à jour</b> et <b>annulation</b>.',
      'Si YouCan vous donne une clé secrète, collez-la dans <b>Modifier → Clé de signature</b>.',
      'Passez une commande test sur votre boutique → elle apparaît dans <b>Activité</b> en quelques secondes.']),
    lightfunnels: ol([
      'Tableau de bord LightFunnels → <b>Settings → Webhooks</b> → <b>Add webhook</b>.',
      'Collez l’URL ci-dessus et sélectionnez <b>order created</b> + <b>order confirmed</b>, ainsi que <b>cancelled</b> et <b>fulfilled</b> pour les statuts.',
      'Optionnel : collez la clé secrète dans <b>Modifier → Clé de signature</b>.',
      'Passez une commande test sur votre funnel pour vérifier.']),
    dropify: ol([
      'Dans Dropify, ouvrez <b>Intégrations</b> (ou Paramètres → Webhooks) et ajoutez un webhook / « envoyer les commandes vers une URL » avec l’URL ci-dessus.',
      'Si votre offre Dropify n’a pas de webhook : connectez Dropify à <b>Google Sheets</b>, puis reliez ce Sheet ici avec la méthode <b>Google Sheets</b>.',
      'Passez une commande test pour vérifier la connexion.']),
    sheets: `${ol([
      'Ouvrez le Google Sheet où votre boutique écrit les commandes (une ligne par commande, en-têtes en ligne 1 — ex. <code>order_id, date, product, sku, quantity, total, phone, city, status, utm_source, utm_content</code>).',
      '<b>Extensions → Apps Script</b> → supprimez le code → collez le script ci-dessous → <b>Enregistrer</b>.',
      'Cliquez <b>Exécuter</b> une fois sur <code>sendOrders</code> et acceptez les autorisations.',
      'Menu de gauche <b>Déclencheurs</b> (horloge) → <b>Ajouter</b> → <code>sendOrders</code>, déclencheur horaire, <b>toutes les 5 minutes</b>.',
      'Les changements de statut dans le Sheet (confirmé, livré, retour…) sont pris en compte au passage suivant.'])}
      <textarea readonly id="gs" rows="12" style="font-family:ui-monospace,monospace;font-size:11.5px;margin-top:10px">function sendOrders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var head = data.shift().map(function (h) { return String(h).trim().toLowerCase().replace(/\\s+/g, '_'); });
  var rows = data.slice(-500).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {}; head.forEach(function (h, i) { o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]; }); return o;
  });
  for (var i = 0; i < rows.length; i += 100) {
    UrlFetchApp.fetch('${url}', { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ orders: rows.slice(i, i + 100) }), muteHttpExceptions: true });
  }
}</textarea><button type="button" class="btn sm" id="cpys" style="margin-top:8px">${I.copy.replace('<svg', '<svg width="14"')}Copier le script</button>`,
    custom: `${ol([
      'Envoyez un <b>POST</b> avec un corps JSON vers l’URL ci-dessus pour chaque commande nouvelle ou mise à jour — depuis Zapier, Make, n8n ou votre propre boutique.',
      'Renvoyer le même <code>order_id</code> met la commande à jour (ex. nouveau statut).'])}
      <textarea readonly rows="10" style="font-family:ui-monospace,monospace;font-size:11.5px;margin-top:10px">{
  "order_id": "10045",
  "created_at": "2026-10-27T12:30:00Z",
  "sku": "NM-01",
  "product": "Neck Massager",
  "quantity": 1,
  "total": 299, "currency": "MAD",
  "customer": "Ahmed", "phone": "0600000000", "city": "Rabat",
  "status": "new",
  "utm_source": "facebook", "utm_content": "yassine"
}</textarea>`,
  };
  return `<div class="sub" style="margin-bottom:2px;font-weight:700">Votre URL webhook (gardez-la privée)</div>${box}${S2[i.kind]}`;
}

async function integrationDetail(i, tab = 'setup') {
  if (!i) return;
  modal(`<span style="display:flex;align-items:center;gap:10px">${kindBadge(i.kind, 28)}${esc(i.name)}</span>`, `
    <div class="tabs" style="margin:-8px 0 4px">${[['setup', 'Installation'], ['map', 'Produits'], ['log', 'Activité']].map(([k, l]) => `<button type="button" data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="itab">${empty(I.plug, 'Chargement…', '')}</div>`, async () => { }, null);
  const mf = $('.mf');
  mf.innerHTML = `<button type="button" class="btn" id="iedit">${I.edit.replace('<svg', '<svg width="14"')}Modifier</button><button type="button" class="btn" id="itest">${I.bolt.replace('<svg', '<svg width="14"')}Commande test</button>
    ${i.has_api ? `<button type="button" class="btn" id="isync">Synchroniser</button>` : ''}<span style="flex:1"></span><button type="button" class="btn pri" id="idone">Terminé</button>`;
  $('#idone').onclick = () => { $('#modal-root').innerHTML = ''; Integrations(); };
  $('#iedit').onclick = () => integrationForm(i);
  $('#itest').onclick = async () => { try { const r = await api(`/integrations/${i.id}/test`, { method: 'POST' }); toast(r.mapped ? 'Commande test reçue ✓' : 'Commande test reçue — reliez le produit'); show('log'); } catch (e) { toast(e.message, true); } };
  if (i.has_api) $('#isync').onclick = async () => { $('#isync').textContent = 'Synchronisation…'; try { const r = await api(`/integrations/${i.id}/sync`, { method: 'POST' }); toast(`${r.synced} commande(s) synchronisée(s)`); show('map'); } catch (e) { toast(e.message, true); } $('#isync').textContent = 'Synchroniser'; };
  $$('[data-t]').forEach(b => b.onclick = () => show(b.dataset.t));

  async function show(t) {
    $$('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    const el = $('#itab'); if (!el) return;
    if (t === 'setup') {
      el.innerHTML = setupSteps(i);
      $('#cpy').onclick = () => { navigator.clipboard.writeText(hookUrl(i)); toast('URL copiée'); };
      if ($('#cpys')) $('#cpys').onclick = () => { navigator.clipboard.writeText($('#gs').value); toast('Script copié'); };
    }
    if (t === 'map') {
      const sp = await api(`/integrations/${i.id}/products`);
      el.innerHTML = !sp.length ? empty(I.box, 'Aucun produit de boutique', 'Ils apparaissent ici avec la première commande (ou envoyez une commande test).') : `
        <div class="hint">Reliez chaque produit de la boutique à l’un de vos produits. Un produit relié passe en <b>comptage automatique</b> et ses commandes passées sont réattribuées.</div>
        <div class="tw"><table style="margin-top:8px"><thead><tr><th>Produit boutique</th><th class="r">Commandes</th><th>Votre produit</th></tr></thead><tbody>
        ${sp.map(p => `<tr><td><b>${esc(p.title || p.ext_key)}</b><div class="sub">${esc(p.ext_key)}</div></td><td class="r num">${p.orders}</td>
          <td><select data-sp="${p.id}" style="${p.product_id ? '' : 'border-color:var(--warn)'}"><option value="">— non relié —</option>${S.products.map(x => `<option value="${x.id}" ${p.product_id == x.id ? 'selected' : ''}>${esc(x.name)} (${esc(x.sku)})</option>`).join('')}</select></td></tr>`).join('')}
        </tbody></table></div>`;
      $$('[data-sp]', el).forEach(s => s.onchange = async () => { const r = await api('/store-products/' + s.dataset.sp, { method: 'PUT', body: { product_id: s.value } }); toast(`Relié — ${r.orders} commande(s) mise(s) à jour`); await loadRefs(); show('map'); });
    }
    if (t === 'log') {
      const lg = await api(`/integrations/${i.id}/log`);
      el.innerHTML = !lg.length ? empty(I.bolt, 'Rien reçu pour l’instant', 'Passez une commande test sur votre boutique ou cliquez « Commande test ».') :
        `<div style="display:flex;flex-direction:column;gap:8px">${lg.map(l => `<details style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--panel2)">
          <summary style="cursor:pointer;display:flex;gap:10px;align-items:center;font-size:13px;font-weight:600"><span class="pill ${l.ok ? 'good' : 'bad'}">${l.ok ? 'OK' : 'Erreur'}</span><span>${esc(l.message)}</span><span style="flex:1"></span><span class="sub">${esc(l.topic || '')} · ${ago(l.received_at)}</span></summary>
          ${l.body ? `<pre style="white-space:pre-wrap;word-break:break-all;font-size:11px;background:var(--bg2);padding:10px;border-radius:8px;max-height:240px;overflow:auto;margin:10px 0 0">${esc((() => { try { return JSON.stringify(JSON.parse(l.body), null, 2); } catch { return l.body; } })())}</pre>` : ''}</details>`).join('')}</div>`;
    }
  }
  show(tab);
}
