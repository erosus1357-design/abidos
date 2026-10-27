# Sellerhub — Le QG des top sellers

Platform dyal tracking l'performance dyal media buyers (COD): products, leads, confirmed, delivered, CPL, CPD, ROAS, profit, commission.

- **Admin** (nta): kaychouf kolchi — ga3 l'buyers, ga3 l'products, ranking, kaycree logins.
- **Media buyer**: kaychouf ghir les products li 3tito lih + l'arqam dyalo + commission dyalo.

## Installation (Railway — l'as-hel)

1. Dir compte f **github.com** o **railway.app** (b GitHub).
2. F GitHub: *New repository* → `sellerhub` (Private) → *uploading an existing file* → jerr ga3 les fichiers.
3. F Railway: *New Project* → *Deploy from GitHub repo* → khtar `sellerhub`.
4. F service → **Variables**, zid:
   - `ADMIN_USERNAME` = username dyalek (ex: `msa`)
   - `ADMIN_PASSWORD` = password qwi
   - `APP_NAME` = smiya li bghiti tban (par défaut: `Sellerhub`)
   - `TIMEZONE` = `Africa/Casablanca` (bach dates dyal orders ykono s7a7)
5. F service → **Settings → Volumes** → *Add volume*, mount path: `/data` (bach database matmchich).
6. **Settings → Networking → Generate Domain** → hada howa l'link dyal platform.
7. Dkhel b username/password dyal admin → **Media buyers** → *New media buyer*.
   L'login kaytcopia automatiquement — sifto l buyer.

> Admin kaytcree ghir l'merra lowla (ila database khawya). Mn b3d bdel password men **Settings**.

## Store integrations (Shopify, YouCan, LightFunnels, Dropify, Google Sheets, ay platform)

Admin → **Store integrations** → khtar store → kat3tik **webhook URL** + steps dyal setup.

- **Shopify:** API sync (Admin API token, kol 10 min) ola webhooks (signature kat-verifia).
- **YouCan / LightFunnels / Dropify:** webhook URL f settings dyal store.
- **Google Sheets:** script Apps Script kaysift les lignes kol 5 min (ay store kaykhrej l Sheets).
- **Any platform:** POST JSON (Zapier, Make, n8n…).

Kol order kaywli **lead** automatiquement. **Products mapping**: rbet product dyal store b product dyalek
(SKU ola smiya kayt-matchaw automatiquement). Product mappé kaydouz l mode *automatic counts*: buyer kaydkhel ghir spend.

**Attribution l buyer:** zid f link dyal l'ad: `utm_source=facebook&utm_content=USERNAME`
(tiktok / google / snapchat). Bla username → buyer li assigné l product.

**Statuses:** kaytbeddlo mn store (cancelled, fulfilled…), mn page Orders, ola b CSV (`number,status`) —
mzyan bach t-importi export dyal Lead to Next / call center (livré, retour, confirmé… kaytfehmo).

## Workflow

1. **Products** → zid product: sell price (local), taux USD, product cost, fees (call center / packaging / shipping / return) → assigni l buyer(s).
2. Buyer kaydkhel kol nhar **Daily data**: spend + leads + confirmed + shipped + delivered + returned (men Lead to Next) — par product × platform.
   Ola import CSV (template f page).
3. **Overview** kayhseb kolchi automatiquement.

## Metrics

| Metric | Formule |
|---|---|
| CPL | spend / leads |
| Cost / confirmed | spend / confirmed |
| CPD | spend / delivered |
| Confirmation rate | confirmed / leads |
| Delivery rate | delivered / (delivered + returned) |
| Revenue | delivered × sell price × taux USD |
| Net profit | revenue − COGS − call center − shipping/packaging − returns − spend |
| ROAS / ROI | revenue / spend · profit / spend |
| Break-even CPD | sell price − product cost − fees |
| Commission | net profit × % dyal buyer |

## Local (test)

```
npm install
node server.js      # http://localhost:3000  (admin / admin123 par défaut)
```

Backup: database kamla f fichier wa7ed `/data/app.db`.
