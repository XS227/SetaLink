# Multi-node API v1 — schema, client compatibility, migration plan

> ⚠️ **CORRECTION (2026-06-14):** an earlier version of this doc claimed the
> multi-node API could ship **with no APK** by pointing `api.setalink.net` at the
> box. **That was wrong** — we do **not** own `setalink.net` (its NS is Namecheap's,
> not our `proisp.no`), so `api.setalink.net` never resolved and the shipped app's
> `/v1` calls always failed → fell back to bootstrap. **`api.setalink.net` is
> dead/unowned and must not be used.** Delivering multi-node therefore **requires a
> new APK** that points `API_BASE` at a domain we own — **`https://api.setalink.no/v1`**.
> See `docs/V0.9.34_PLAN.md` for the go-forward plan. The schema/server below is
> still valid; only the **host** changes (`.net` → `api.setalink.no`).

**Date:** 2026-06-14 · **Status:** server implemented (`public/v1.php`), **not enabled**; requires v0.9.34 client. Denmark/primary stays default; Helsinki is test-allowlist-gated. **No public rollout.**

Implemented as `public/v1.php` (standalone — `api.php` bootstrap surface untouched). Admin endpoints added to `admin/api.php`.

---

## 1. API schema

Base (what the installed app already calls): `https://api.setalink.net/v1`
Auth: `Authorization: Bearer <token>` where the app sends `device-<device_id>` (registered) or `anon-token-<ts>` (anonymous). Identity is derived from the token; these calls carry no `device_id` param.

### `GET /v1/servers` → `ServerRecord[]`
Node catalog (no secrets). Primary/default node always present; **test nodes only for allowlisted devices**.
- `200` array · `401` if no bearer token (app treats as logout — only when credential is entirely absent).

### `GET /v1/servers/{id}/config` → `ServerCredentials`
Per-node connect params. Records the device→node selection for admin visibility.
- `200` creds · `403` device not allowlisted for a test node · `404` unknown id.

---

## 2. Example responses (real output from the implementation)

**`GET /v1/servers` — normal/anon device (Denmark only):**
```json
[{"id":"primary","country":"Germany","city":"Hetzner · Cloudflare :443","flag":"🇩🇪","ping":0,"load":0,"protocol":"Reality","transport":"reality","tags":["Recommended"],"premium":false}]
```

**`GET /v1/servers` — allowlisted test device (Denmark + Helsinki):**
```json
[{"id":"primary","country":"Germany","city":"Hetzner · Cloudflare :443","flag":"🇩🇪","ping":0,"load":0,"protocol":"Reality","transport":"reality","tags":["Recommended"],"premium":false},
 {"id":"fi-hel","country":"Finland","city":"Helsinki","flag":"🇫🇮","ping":0,"load":0,"protocol":"Reality","transport":"reality","tags":["Test"],"premium":false}]
```

**`GET /v1/servers/primary/config`** (reads live `bootstrap_*` settings — same node users already get):
```json
{"uuid":"<prod-uuid>","address":"178.104.77.231","port":443,"publicKey":"<prod-pubkey>","shortId":"<prod-sid>","sni":"www.cloudflare.com","flow":"","fingerprint":"chrome","edgeAddress":"edge.setalink.no","edgePort":443,"wsPath":"/ws","xhttpPath":"/xhttp/","httpupPath":"/httpup","altProfiles":[]}
```

**`GET /v1/servers/fi-hel/config`** (allowlisted device only):
```json
{"uuid":"92a861cd-6029-4882-9de5-35d9291e0828","address":"65.109.183.7","port":443,"publicKey":"eGL5TwzXjS4_kQrqAGBrY2K6MqjRXmz70xYhcgXUXwU","shortId":"b3a824bd","sni":"www.cloudflare.com","flow":"xtls-rprx-vision","fingerprint":"chrome","edgeAddress":"fi.setalink.no","edgePort":443,"wsPath":"/ws","xhttpPath":"/xhttp/","httpupPath":"/httpup","altProfiles":[]}
```
`fi-hel/config` for a non-allowlisted device → `403 {"message":"device not authorized for this node"}`.

> Note: `primary` reflects the **live bootstrap target** (currently `178.104.77.231`, labeled Germany/Cloudflare) — i.e. the node users actually connect to today — not the Copenhagen control box. Relabel via the admin `bootstrap_*` settings if desired; the API stays in sync automatically.

---

## 3. Client parsing path (already in the shipped binary)

1. `services/api/client.ts:8` — `API_BASE = 'https://api.setalink.net/v1'`; `request()` adds `Authorization: Bearer <token>` + `X-Client`, 10 s timeout, 401→logout.
2. `services/api/servers.api.ts:6` — `ServersAPI.list(token) → GET /servers`; `getConfig(id,token) → GET /servers/{id}/config`.
3. `stores/serverStore.ts:131` — `fetchServers()` sets `servers = data` when the array is non-empty; **any error/empty keeps the saved list** (so absence/Denmark-only changes nothing for existing users). Called on launch in `navigation/AppNavigator.tsx:152` whenever `token` is set.
4. Connect: selecting a node → `services/serverConfigService.ts:80` `getServerCredentials(id,token)` → `ServersAPI.getConfig` → accepted iff `uuid && publicKey`, fed to `xrayConfigBuilder`.
5. Types it must match (it does): `Server`/`ServerRecord` (`{id,country,city,flag,ping,load,protocol,...}`) and `ServerCredentials` (`{uuid,address,port,publicKey,shortId,sni,flow,fingerprint,edge*,altProfiles?}`).

---

## 4. No APK update required — confirmation

The installed app **already** targets `api.setalink.net/v1/servers` + `/servers/{id}/config` and parses these exact shapes. We are implementing the server it already expects. The only missing piece is making `api.setalink.net` resolve and serve `v1.php`. **Zero client/binary changes.** (The hardcoded emergency fallbacks in `emergencyProfiles.ts`/`serverStore.ts` are unrelated — they are last-resort only, not this delivery path.)

---

## 5. Migration / enablement plan (each step reversible)

> All of this is **server-side**; no APK. The control plane (DB `data/analytics.db`, `v1.php`) lives on the Copenhagen box `5.249.252.221` (same box as `setalink.no`), so `api.setalink.net` must point there. The VPN nodes (`178.104.77.231` prod, `65.109.183.7` Helsinki) are **not** touched.

1. **DNS:** `api.setalink.net A 5.249.252.221` (you create the record, like `fi.setalink.no`).
2. **nginx vhost** on the Copenhagen box (additive — does not alter `setalink.no`):
   ```nginx
   server { listen 80; server_name api.setalink.net;
            location ^~ /.well-known/acme-challenge/ { root /var/www/html; }
            location / { return 301 https://$host$request_uri; } }
   server { listen 443 ssl; http2 on; server_name api.setalink.net;
            ssl_certificate     /etc/letsencrypt/live/api.setalink.net/fullchain.pem;
            ssl_certificate_key /etc/letsencrypt/live/api.setalink.net/privkey.pem;
            root /var/www/setalink/public;
            location /v1/ { try_files $uri /v1.php$is_args$args;
                            fastcgi_split_path_info ^(/v1\.php)(/.*)$; }
            location = /v1.php { include snippets/fastcgi-php.conf;
                                 fastcgi_pass unix:/run/php/php8.3-fpm.sock;
                                 fastcgi_param HTTP_AUTHORIZATION $http_authorization; } }  # must pass the bearer header
   ```
   (Exact form to be finalized at deploy; key requirement: `/v1/servers...` → `v1.php` with `PATH_INFO` and the `Authorization` header forwarded.)
3. **TLS:** `certbot certonly --webroot -w /var/www/html -d api.setalink.net`.
4. **Controlled testing (no public rollout):** add a tester's device to the allowlist (below). Only that device sees/uses Helsinki; everyone else keeps Denmark.
5. **Public rollout (LATER, needs explicit approval):** remove the test gate / surface Helsinki to all (and/or drop the `Test` tag). **Not done.**

**Rollback:** disable the `api.setalink.net` vhost (or point DNS away) → app's `ServersAPI` fails → store falls back to the saved list = today's behavior. Or `DELETE FROM node_allowlist` to revoke all test access. Nothing about the existing bootstrap/users changes.

---

## 6. Admin visibility & test allowlist

- **Which node a device uses:** `GET admin/api.php?action=node-usage` → `{usage:[{device_id,node_id,hits,first_seen,last_seen,user_id,country}], allowlist:[...]}` (every `/config` fetch is logged in `node_usage`).
- **Grant test access:** `POST admin/api.php {action:"node-allowlist-add", device_id:"<id>", node_id:"fi-hel", _csrf:...}` · revoke: `node-allowlist-remove`.

## 7. Test profile (manual Helsinki selection)

Once §5.1–5.4 are live: allowlist the tester's device id (the value after `device-` in its bearer token; visible in the admin devices list). That device's app — **no update** — will then show Helsinki (🇫🇮 Test) in the server list, fetch `fi-hel/config` on tap, and connect via Helsinki. Everyone else continues to see Denmark only and stays on it by default. A sample allowlist entry `dev-helsinki-tester-001 → fi-hel` was seeded for verification.
