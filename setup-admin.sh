#!/usr/bin/env bash
# SetaLink admin dashboard installer. Idempotent. Wires up:
#   - apache2-utils (htpasswd)
#   - /etc/setalink/admin/{htpasswd,csrf.secret}
#   - /etc/sudoers.d/setalink-admin     (validated with visudo -c)
#   - /etc/nginx/snippets/setalink-admin.conf
#   - one new `include` line in the chosen nginx vhost
#   - validates with `nginx -t`, then reloads
#
# Designed to run AFTER install.sh + at least the SetaLink + nginx-stream setup.
# Does NOT touch xray, the stream multiplexer, or any existing https vhost
# besides adding the include line.
#
# Env overrides (skip prompts):
#   SETALINK_ADMIN_USER=alice
#   SETALINK_ADMIN_PASS='hunter2'
#   SETALINK_ADMIN_VHOST=shahnameh           # filename in /etc/nginx/sites-available/
#   SETALINK_ADMIN_PATH=/_setalink-admin/    # public URL prefix
#   SETALINK_NONINTERACTIVE=1                # require *_USER and *_PASS

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib.sh"

require_root "$@"

ADMIN_DIR_REPO="$SCRIPT_DIR/admin"
ADMIN_DIR_ETC="/etc/setalink/admin"
HTPASSWD_FILE="$ADMIN_DIR_ETC/htpasswd"
CSRF_SECRET_FILE="$ADMIN_DIR_ETC/csrf.secret"
SUDOERS_FILE="/etc/sudoers.d/setalink-admin"
NGINX_SNIPPET="/etc/nginx/snippets/setalink-admin.conf"

VHOST="${SETALINK_ADMIN_VHOST:-shahnameh}"
ADMIN_PATH="${SETALINK_ADMIN_PATH:-/_setalink-admin/}"
# Validate the path: must start and end with '/', no spaces, no funny chars
if ! [[ "$ADMIN_PATH" =~ ^/[a-zA-Z0-9._/-]+/$ ]]; then
    die "invalid SETALINK_ADMIN_PATH '$ADMIN_PATH' (must look like /name/)"
fi
VHOST_FILE="/etc/nginx/sites-available/$VHOST"
[ -r "$VHOST_FILE" ] || die "vhost file not found: $VHOST_FILE
       (existing vhosts: $(ls /etc/nginx/sites-available 2>/dev/null | tr '\n' ' '))"

# ---------------------------------------------------------------------------
# 1. Pre-flight checks
# ---------------------------------------------------------------------------
log "preflight"
[ -x "$ADMIN_DIR_REPO/setalink-cli" ] || die "$ADMIN_DIR_REPO/setalink-cli missing or not executable"
[ -f "$ADMIN_DIR_REPO/index.php"    ] || die "$ADMIN_DIR_REPO/index.php missing"
[ -f "$ADMIN_DIR_REPO/qr.php"       ] || die "$ADMIN_DIR_REPO/qr.php missing"
[ -f "$ADMIN_DIR_REPO/style.css"    ] || die "$ADMIN_DIR_REPO/style.css missing"
require_cmd nginx
require_cmd visudo
systemctl is-active --quiet nginx || die "nginx is not running"
systemctl is-active --quiet php8.3-fpm || die "php8.3-fpm is not running"
[ -S /run/php/php8.3-fpm.sock ] || die "expected /run/php/php8.3-fpm.sock not found"

# ---------------------------------------------------------------------------
# 2. apache2-utils (provides htpasswd)
# ---------------------------------------------------------------------------
if ! command -v htpasswd >/dev/null 2>&1; then
    log "installing apache2-utils for htpasswd"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends apache2-utils >/dev/null
fi

# ---------------------------------------------------------------------------
# 3. www-data must exist (it should — php-fpm runs as it)
# ---------------------------------------------------------------------------
id www-data >/dev/null 2>&1 || die "www-data user not found"

# ---------------------------------------------------------------------------
# 4. Repo file permissions — paranoia. www-data must NOT be able to modify
#    setalink-cli (sudo'd) or the PHP files. They live in a repo, so a
#    git pull might re-apply correct perms, but we lock them down here too.
# ---------------------------------------------------------------------------
log "locking repo admin permissions"
chown root:root "$ADMIN_DIR_REPO" "$ADMIN_DIR_REPO"/* 2>/dev/null || true
chmod 0755 "$ADMIN_DIR_REPO"
chmod 0755 "$ADMIN_DIR_REPO/setalink-cli"
chmod 0644 "$ADMIN_DIR_REPO"/*.php "$ADMIN_DIR_REPO"/*.css "$ADMIN_DIR_REPO"/*.md 2>/dev/null || true

# ---------------------------------------------------------------------------
# 5. /etc/setalink/admin — htpasswd + csrf secret
# ---------------------------------------------------------------------------
log "setting up $ADMIN_DIR_ETC"
mkdir -p "$ADMIN_DIR_ETC"
chown root:www-data "$ADMIN_DIR_ETC"
chmod 0750 "$ADMIN_DIR_ETC"

# Admin credentials
NEED_HTPASSWD=1
if [ -f "$HTPASSWD_FILE" ]; then
    if [ "${SETALINK_NONINTERACTIVE:-0}" = "1" ] && [ -z "${SETALINK_ADMIN_USER:-}" ]; then
        log "preserving existing $HTPASSWD_FILE"
        NEED_HTPASSWD=0
    elif [ "${SETALINK_NONINTERACTIVE:-0}" != "1" ]; then
        echo "  $HTPASSWD_FILE already exists with $(wc -l < "$HTPASSWD_FILE") admin(s)."
        read -r -p "  add/update an admin? [y/N] " ans
        [[ "$ans" =~ ^[yY]$ ]] || NEED_HTPASSWD=0
    fi
fi

if [ "$NEED_HTPASSWD" = "1" ]; then
    ADMIN_USER="${SETALINK_ADMIN_USER:-}"
    ADMIN_PASS="${SETALINK_ADMIN_PASS:-}"
    if [ "${SETALINK_NONINTERACTIVE:-0}" = "1" ]; then
        [ -n "$ADMIN_USER" ] && [ -n "$ADMIN_PASS" ] || \
            die "non-interactive mode: must set SETALINK_ADMIN_USER and SETALINK_ADMIN_PASS"
    else
        if [ -z "$ADMIN_USER" ]; then
            read -r -p "  admin username: " ADMIN_USER
        fi
        if [ -z "$ADMIN_PASS" ]; then
            read -r -s -p "  admin password: " ADMIN_PASS; echo
            read -r -s -p "  admin password (confirm): " ADMIN_PASS2; echo
            [ "$ADMIN_PASS" = "$ADMIN_PASS2" ] || die "passwords didn't match"
        fi
    fi
    [ -n "$ADMIN_USER" ] || die "admin username required"
    [ -n "$ADMIN_PASS" ] || die "admin password required"
    [[ "$ADMIN_USER" =~ ^[A-Za-z0-9._-]{1,32}$ ]] || die "invalid admin username"

    if [ -f "$HTPASSWD_FILE" ]; then
        # -B: bcrypt; -b: take password from arg; no -c (don't truncate)
        htpasswd -B -b "$HTPASSWD_FILE" "$ADMIN_USER" "$ADMIN_PASS" >/dev/null
    else
        htpasswd -B -b -c "$HTPASSWD_FILE" "$ADMIN_USER" "$ADMIN_PASS" >/dev/null
    fi
    chown root:www-data "$HTPASSWD_FILE"
    chmod 0640 "$HTPASSWD_FILE"
    ok "htpasswd entry for '$ADMIN_USER' written"
fi

# CSRF secret (rotated only on demand; persists across reinstalls)
if [ ! -f "$CSRF_SECRET_FILE" ]; then
    log "generating CSRF secret"
    umask 077
    openssl rand -hex 32 > "$CSRF_SECRET_FILE"
    umask 022
fi
chown root:www-data "$CSRF_SECRET_FILE"
chmod 0640 "$CSRF_SECRET_FILE"

# ---------------------------------------------------------------------------
# 6. sudoers — validated with visudo -c before swap
# ---------------------------------------------------------------------------
log "writing $SUDOERS_FILE"
TMP_SUDO="$(mktemp /tmp/setalink-sudo.XXXXXX)"
cat > "$TMP_SUDO" <<EOF
# Managed by /var/www/setalink/setup-admin.sh — do not edit by hand.
# www-data may run ONLY this single binary as root, with no password.
# The binary itself re-validates all arguments; see admin/setalink-cli.
www-data ALL=(root) NOPASSWD: /var/www/setalink/admin/setalink-cli
Defaults!/var/www/setalink/admin/setalink-cli !requiretty
EOF
chmod 0440 "$TMP_SUDO"
chown root:root "$TMP_SUDO"
if ! visudo -cf "$TMP_SUDO" >/dev/null 2>&1; then
    rm -f "$TMP_SUDO"
    die "sudoers file failed visudo validation; aborting"
fi
install -m 0440 -o root -g root "$TMP_SUDO" "$SUDOERS_FILE"
rm -f "$TMP_SUDO"
ok "sudoers entry installed and validated"

# ---------------------------------------------------------------------------
# 7. nginx snippet (the location block) + include in the vhost
# ---------------------------------------------------------------------------
log "writing $NGINX_SNIPPET"
mkdir -p "$(dirname "$NGINX_SNIPPET")"
TMP_NGINX="$(mktemp /tmp/setalink-nginx.XXXXXX.conf)"
cat > "$TMP_NGINX" <<EOF
# SetaLink admin dashboard — served at $ADMIN_PATH on this vhost.
# Generated by /var/www/setalink/setup-admin.sh. Edit setup-admin.sh +
# re-run if you need to change the path or auth file.

location $ADMIN_PATH {
    alias /var/www/setalink/admin/;
    index index.php;

    auth_basic           "SetaLink admin";
    auth_basic_user_file $HTPASSWD_FILE;

    # Block direct access to .md / wrapper / hidden files just in case.
    location ~* \\.(md|sh|secret)$  { deny all; return 404; }
    location ~  /setalink-cli$      { deny all; return 404; }
    location ~  /\\.                { deny all; return 404; }

    # Static + index dispatch
    location ~ ^${ADMIN_PATH%/}/?$ {
        rewrite ^ ${ADMIN_PATH}index.php last;
    }

    # PHP execution — strict regex so only .php under the alias is exec'd
    location ~ ^${ADMIN_PATH}([^/]+\\.php)$ {
        # Safety: re-apply alias inside the regex location
        alias /var/www/setalink/admin/\$1;
        fastcgi_pass            unix:/run/php/php8.3-fpm.sock;
        fastcgi_index           index.php;
        fastcgi_param           SCRIPT_FILENAME  \$request_filename;
        fastcgi_param           SCRIPT_NAME      \$fastcgi_script_name;
        fastcgi_param           QUERY_STRING     \$query_string;
        fastcgi_param           REQUEST_METHOD   \$request_method;
        fastcgi_param           CONTENT_TYPE     \$content_type;
        fastcgi_param           CONTENT_LENGTH   \$content_length;
        fastcgi_param           REQUEST_URI      \$request_uri;
        fastcgi_param           DOCUMENT_ROOT    /var/www/setalink/admin;
        fastcgi_param           DOCUMENT_URI     \$document_uri;
        fastcgi_param           SERVER_PROTOCOL  \$server_protocol;
        fastcgi_param           HTTPS            on;
        fastcgi_param           REMOTE_ADDR      \$remote_addr;
        fastcgi_param           REMOTE_USER      \$remote_user;
        fastcgi_param           PHP_AUTH_USER    \$remote_user;
        fastcgi_param           HTTP_HOST        \$http_host;
        fastcgi_read_timeout    30s;
    }
}
EOF
install -m 0644 -o root -g root "$TMP_NGINX" "$NGINX_SNIPPET"
rm -f "$TMP_NGINX"

# Add include to vhost (idempotent)
INCLUDE_LINE="    include $NGINX_SNIPPET;"
INCLUDE_MARKER="# SetaLink admin: include managed by setup-admin.sh"
if grep -qF "$NGINX_SNIPPET" "$VHOST_FILE"; then
    log "include already present in $VHOST_FILE"
else
    log "adding include to $VHOST_FILE"
    # Insert before the closing '}' of the FIRST server block that contains
    # `listen 127.0.0.1:8444` (the HTTPS-internal vhost — not the :80
    # redirect block). Falls back to last '}' in the file if not found, so
    # the include still lands somewhere valid; nginx -t below catches breakage.
    TMP_VHOST="$(mktemp /tmp/setalink-vhost.XXXXXX)"
    awk -v inc="$INCLUDE_LINE" -v marker="    $INCLUDE_MARKER" '
        { lines[NR]=$0 }
        END {
            # find last "}" line
            last=0; for (i=NR; i>=1; i--) if (lines[i] ~ /^[[:space:]]*\}[[:space:]]*$/) { last=i; break }
            # find the FIRST "}" that closes a server block that contains
            # `listen 127.0.0.1:8444`, walking forward
            target=0
            for (i=1; i<=NR; i++) {
                if (lines[i] ~ /listen[[:space:]]+127\.0\.0\.1:8444/) {
                    for (j=i; j<=NR; j++) {
                        if (lines[j] ~ /^[[:space:]]*\}[[:space:]]*$/) { target=j; break }
                    }
                    if (target) break
                }
            }
            if (!target) target=last  # fallback
            for (i=1; i<=NR; i++) {
                if (i == target) { print marker; print inc }
                print lines[i]
            }
        }
    ' "$VHOST_FILE" > "$TMP_VHOST"
    install -m 0644 -o root -g root "$TMP_VHOST" "$VHOST_FILE"
    rm -f "$TMP_VHOST"
fi

# ---------------------------------------------------------------------------
# 8. Validate + reload
# ---------------------------------------------------------------------------
log "nginx -t"
if ! nginx -t 2>&1 | tee /tmp/setalink-admin-nginx-t.log; then
    err "nginx -t FAILED — refusing to reload."
    err "snippet: $NGINX_SNIPPET"
    err "vhost:   $VHOST_FILE"
    die "fix the config or restore the backup before retrying"
fi
log "nginx reload"
systemctl reload nginx

# ---------------------------------------------------------------------------
# 9. Smoke test the sudo path
# ---------------------------------------------------------------------------
log "smoke testing setalink-cli via sudo as www-data"
if ! sudo -u www-data sudo -n /var/www/setalink/admin/setalink-cli status >/dev/null; then
    err "www-data cannot run setalink-cli via sudo — check $SUDOERS_FILE"
    die "smoke test failed"
fi

# ---------------------------------------------------------------------------
# 10. Done
# ---------------------------------------------------------------------------
ok "admin dashboard installed"

# Try to derive the public URL for display
DOMAIN="$(awk '/server_name/ && !/_/{for(i=2;i<=NF;i++){gsub(";","",$i); if($i!="" && $i!="_") {print $i; exit}}}' "$VHOST_FILE" || true)"
DOMAIN="${DOMAIN:-<your-vhost-domain>}"
cat <<EOF

  URL          : https://$DOMAIN${ADMIN_PATH}
  vhost file   : $VHOST_FILE
  snippet      : $NGINX_SNIPPET
  htpasswd     : $HTPASSWD_FILE
  csrf secret  : $CSRF_SECRET_FILE
  sudoers      : $SUDOERS_FILE
  cli wrapper  : /var/www/setalink/admin/setalink-cli (root:root 0755)

next steps:
  - Open the URL above and sign in with the admin credentials you set.
  - Add another admin: sudo htpasswd $HTPASSWD_FILE <name>
  - See $SCRIPT_DIR/admin/README.md for uninstall + rotation.

EOF
