# SetaLink admin dashboard

Tiny private admin UI for SetaLink. Lists users, shows server status,
and exposes add / disable / enable / delete actions through the existing
`add-user.sh`, `remove-user.sh`, and the new `disable-user.sh` /
`enable-user.sh` scripts.

## Architecture

```
   browser  ──https──►  nginx :443 (stream multiplexer)
                             │ SNI=shahnameh.setaei.com
                             ▼
                      nginx http vhost ─── location /_setalink-admin/
                             │            (auth_basic + fastcgi PHP)
                             ▼
                      php-fpm (www-data)
                             │ exec via sudo (NOPASSWD, single binary)
                             ▼
              /var/www/setalink/admin/setalink-cli  (root:root, 0755)
                             │
                             ▼
              add-user.sh / remove-user.sh / disable-user.sh / enable-user.sh
```

PHP cannot read `/etc/setalink/` directly (mode 0700 / root). Every
state-changing operation and every privileged file read goes through
`setalink-cli`, which is the only sudo-whitelisted binary for `www-data`.
`setalink-cli` re-validates every username argument against the same
`^[a-z0-9][a-z0-9._-]{0,31}$` regex `lib.sh` enforces, so PHP cannot
inject shell metacharacters even if it tried.

## Setup

```sh
sudo /var/www/setalink/setup-admin.sh
```

This will:
1. Install `apache2-utils` (for `htpasswd`) if missing.
2. Prompt for an admin username + password, write to
   `/etc/setalink/admin/htpasswd` (mode 0640 root:www-data).
3. Generate `/etc/setalink/admin/csrf.secret` (mode 0640 root:www-data).
4. Write `/etc/sudoers.d/setalink-admin` (validated with `visudo -c`).
5. Write `/etc/nginx/snippets/setalink-admin.conf` (the `location` block).
6. Add `include /etc/nginx/snippets/setalink-admin.conf;` to the
   shahnameh vhost (idempotent — only if not already present).
7. `nginx -t` then `systemctl reload nginx` (only if validation passes).

After setup, browse to `https://shahnameh.setaei.com/_setalink-admin/`,
sign in with the credentials you set.

Override the host vhost with the env var `SETALINK_ADMIN_VHOST`
(e.g. `SETALINK_ADMIN_VHOST=trustai sudo -E ./setup-admin.sh`) — must
match the filename in `/etc/nginx/sites-available/`.

## Adding more admins

```sh
sudo htpasswd /etc/setalink/admin/htpasswd <new-username>
```

## Removing admins

```sh
sudo htpasswd -D /etc/setalink/admin/htpasswd <username>
```

## Rotating the CSRF secret

Invalidates all open admin sessions:

```sh
sudo openssl rand -hex 32 > /etc/setalink/admin/csrf.secret.new
sudo install -m 0640 -o root -g www-data /etc/setalink/admin/csrf.secret.new /etc/setalink/admin/csrf.secret
sudo rm /etc/setalink/admin/csrf.secret.new
```

## Uninstall

```sh
sudo rm /etc/sudoers.d/setalink-admin
sudo rm /etc/nginx/snippets/setalink-admin.conf
# Remove the `include /etc/nginx/snippets/setalink-admin.conf;` line
# from /etc/nginx/sites-available/<vhost>, then:
sudo nginx -t && sudo systemctl reload nginx
sudo rm -rf /etc/setalink/admin
```

## Files

- `index.php` — dashboard + form-POST handlers (CSRF-protected)
- `qr.php`    — proxies QR PNG and link.txt (PHP can't read them directly)
- `setalink-cli` — root-owned wrapper, sole sudo target
- `style.css` — self-contained styling (no external CDN)

## Phase 3 actions

The dashboard adds these row-level actions (under *more…*):

| Action          | What it does                                                              | Restarts xray? |
| --------------- | ------------------------------------------------------------------------- | -------------- |
| **enable**      | sets `disabled=false`, regenerates xray config                            | yes            |
| **disable**     | sets `disabled=true`, regenerates xray config (filters from `clients[]`)  | yes            |
| **reset usage** | sets `used_bytes=0`                                                       | no             |
| **change pkg**  | sets `package_name` + `quota_bytes`. Does NOT auto-enable a disabled user | no             |
| **regen link**  | rebuilds `link.txt` + `qr.png` from current UUID/shortId                  | no             |
| **delete**      | removes the user record + per-user files; prompts for confirmation        | yes            |

Every state-changing action goes through `setalink-cli` over `sudo` (whitelisted in `/etc/sudoers.d/setalink-admin`), and re-validates the username against `^[a-z0-9][a-z0-9._-]{0,31}$` before touching anything.

The dashboard also displays per-user **package**, **used / quota**, **remaining**, **usage %**, and **last seen** (from `users.json::users[].last_seen_at`, bumped by `poll-traffic.sh` on every poll where the user had positive uplink+downlink delta).

## Quota enforcement (cron)

Installed at `/etc/cron.d/setalink-quotas`:

```
*/5 * * * * root /var/www/setalink/check-quotas.sh >>/var/log/setalink-quotas.log 2>&1
```

Disable by removing that file. The script polls xray's stats API, accumulates per-user `used_bytes` into `users.json`, then auto-disables anyone over quota (skipping `unlimited` users — `quota_bytes == 0`).
