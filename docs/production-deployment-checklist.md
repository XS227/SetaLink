# Production Deployment Checklist

Run this before deploying any backend change to the live server (setalink.no).

## Pre-deploy

- [ ] Changes tested locally or on the Helsinki test node (65.109.183.7) if applicable
- [ ] `public/api.php` syntax check: `php -l public/api.php`
- [ ] `admin/api.php` syntax check: `php -l admin/api.php`
- [ ] `admin/index.php` syntax check: `php -l admin/index.php`
- [ ] Any new lib/*.php files syntax-checked: `php -l lib/*.php`
- [ ] DB migrations are additive only (no DROP, no column renames) — lazy ALTER TABLE pattern used
- [ ] No secrets committed (`grep -r "password\|secret\|key" --include="*.php"` — manual review)

## Deploy

```bash
# From local machine or CI:
rsync -av --exclude='.git' --exclude='data/' --exclude='logs/' \
  /var/www/setalink/ root@setalink.no:/var/www/setalink/

# Or via git pull on server:
ssh root@setalink.no "cd /var/www/setalink && git pull && php -l public/api.php && php -l admin/api.php"
```

- [ ] Files deployed
- [ ] Nginx config unchanged (or nginx -t && systemctl reload nginx if changed)
- [ ] PHP-FPM restarted if needed: `systemctl restart php8.x-fpm`

## Post-deploy smoke test

### API
- [ ] `curl -s 'https://setalink.no/api.php?mobile=1&action=remote-config&_token=setalink-mobile-diag-v1' | python3 -m json.tool` → `"ok": true`
- [ ] `curl -s 'https://setalink.no/api.php?mobile=1&action=bootstrap&_token=setalink-mobile-diag-v1' | python3 -m json.tool` → `"ok": true`
- [ ] Admin panel loads: `https://setalink.no/admin/` → no PHP errors

### Mobile client
- [ ] Open app → registration completes (device appears in admin Devices)
- [ ] VPN connect → Reality tunnel connects → admin shows session with `probe_result=ok`
- [ ] Admin online indicator updates

## Rollback

```bash
# Git rollback:
ssh root@setalink.no "cd /var/www/setalink && git revert HEAD && git push"
# Or:
ssh root@setalink.no "cd /var/www/setalink && git checkout HEAD~1 -- public/api.php admin/api.php"
```

- [ ] Know which commit was live before deploy (note it here: `_______`)
- [ ] SQLite migrations are forward-only — added columns can't easily be removed; acceptable

## Disk health

- [ ] Check disk usage: `df -h /var/www/setalink/`
- [ ] SQLite DB size: `ls -lh /var/www/setalink/data/analytics.db`
- [ ] Log rotation: xray access log at `/var/log/xray/access.log` — ensure logrotate is running
- [ ] Current disk usage target: <85% (was at 84% as of 2026-06-11)

## VPN node health

- [ ] xray process running: `systemctl status xray` (or `3x-ui` panel)
- [ ] Port 443 accepting connections: `nc -zv 178.104.77.231 443`
- [ ] Reality handshake test: `xray run -test -c /etc/xray/config.json`

## After a major release (new features / schema changes)

- [ ] Send admin broadcast message to all devices: "New update available" (if OTA push)
- [ ] Monitor admin Analytics page for session drop or registration spike anomalies
- [ ] Watch for `last_failure_category` spikes in admin Devices page for 1 h post-deploy
