# Sellerhub — Le QG des top sellers

Platform dyal tracking l'performance dyal media buyers (COD): products, leads, confirmed, delivered, CPL, CPD, ROAS, profit, commission.

- **Admin** (nta): kaychouf kolchi — ga3 l'buyers, ga3 l'products, ranking, kaycree logins.
- **Media buyer**: kaychouf ghir les products li 3tito lih + l'arqam dyalo + commission dyalo.

## Installation gratuite (Render + Turso)

**1. Database — Turso (gratuit)**
1. Dkhel l **turso.tech** b GitHub → *Create database* (ex: `sellerhub`, région la plus proche: Frankfurt / Paris).
2. Copi **Database URL** (`libsql://…turso.io`) o cree **Token** (*Create token*, read & write).

**2. Application — Render (gratuit)**
1. Dkhel l **render.com** b GitHub → *New → Web Service* → khtar repo `abidos`.
2. Runtime: **Docker** (Dockerfile kayn f repo). Plan: **Free**.
3. **Environment variables:**
   - `TURSO_DATABASE_URL` = URL dyal Turso
   - `TURSO_AUTH_TOKEN` = token dyal Turso
   - `ADMIN_USERNAME` = username dyalek (ex: `msa`)
   - `ADMIN_PASSWORD` = password qwi
   - `TIMEZONE` = `Africa/Casablanca`
   - `APP_NAME` = `Sellerhub` (optionnel)
4. *Create Web Service* → mnin ysali l'build, link howa `https://….onrender.com`.

> F l'plan Free, Render kayna3es ba3d 15 min bla visites: l'ouverture lowla kat3tel ~30 s. Database f Turso, donc walou ma kaytmsa7.
> Admin kaytcree ghir l'merra lowla (ila database khawya). Mn b3d bdel password men **Mon compte**.

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
node server.js      # http://localhost:3000  (admin / admin123 par défaut, SQLite local f data/app.db)
```

Backup: Turso dashboard → database → *Backups / Export*.
