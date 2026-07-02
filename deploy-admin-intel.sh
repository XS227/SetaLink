#!/usr/bin/env bash
# Deploy feat/admin-intel-v2 to the live setalink.no server.
# Self-discovering: locates the live PHP files by content markers, backs them
# up, lints the new versions BEFORE overwriting, then verifies the endpoint.
# Usage (on the setalink.no server):
#   curl -fsSL https://raw.githubusercontent.com/XS227/SetaLink/feat/admin-intel-v2/deploy-admin-intel.sh | bash
set -euo pipefail

BRANCH="feat/admin-intel-v2"
RAW="https://raw.githubusercontent.com/XS227/SetaLink/${BRANCH}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mFEIL: %s\033[0m\n' "$*" >&2; exit 1; }

command -v php >/dev/null || die "php mangler i PATH"
command -v curl >/dev/null || die "curl mangler"

# ── 1) Finn live-filene via unike innholdsmarkører ───────────────────────────
say "Leter etter live-filer under /var/www /srv /home …"
find_one() { # $1=marker  $2=filnavnfilter
  grep -rl --include="$2" -m1 "$1" /var/www /srv /home 2>/dev/null | head -1
}
PUB_API=$(find_one "setalink-mobile-diag-v1" "api.php" | head -1)
[ -n "${PUB_API}" ] || die "fant ikke live public/api.php (marker: mobile-token)"
# admin/api.php og public/api.php har begge tokenet — skill dem på node-intel-casen
if grep -q "open_analytics_db" "$PUB_API"; then
  ADMIN_API="$PUB_API"
  PUB_API=$(grep -rl --include="api.php" "setalink-mobile-diag-v1" /var/www /srv /home 2>/dev/null | grep -v "^$ADMIN_API$" | head -1)
else
  ADMIN_API=$(grep -rl --include="api.php" "open_analytics_db" /var/www /srv /home 2>/dev/null | head -1)
fi
ADMIN_INDEX=$(find_one "intelCountryTbl" "index.php")
NODE_INTEL=$(find_one "function ni_init_tables" "*.php")
[ -n "$PUB_API" ]     || die "fant ikke public/api.php"
[ -n "$ADMIN_API" ]   || die "fant ikke admin/api.php"
[ -n "$ADMIN_INDEX" ] || die "fant ikke admin/index.php"
[ -n "$NODE_INTEL" ]  || die "fant ikke lib/node_intel.php"
echo "  public/api.php    -> $PUB_API"
echo "  admin/api.php     -> $ADMIN_API"
echo "  admin/index.php   -> $ADMIN_INDEX"
echo "  lib/node_intel.php-> $NODE_INTEL"

# ── 2) Last ned nye versjoner og lint FØR overskriving ───────────────────────
say "Laster ned fra $BRANCH og kjører php -l …"
declare -A MAP=(
  ["public/api.php"]="$PUB_API"
  ["admin/api.php"]="$ADMIN_API"
  ["admin/index.php"]="$ADMIN_INDEX"
  ["lib/node_intel.php"]="$NODE_INTEL"
)
for src in "${!MAP[@]}"; do
  out="$TMP/$(echo "$src" | tr '/' '_')"
  curl -fsSL "$RAW/$src" -o "$out" || die "nedlasting feilet: $src"
  php -l "$out" >/dev/null || die "syntaksfeil i ny $src — AVBRYTER (ingenting er endret)"
done

# ── 3) Backup + install ──────────────────────────────────────────────────────
BK="/root/backup-admin-intel-$STAMP"
mkdir -p "$BK" 2>/dev/null || BK="$HOME/backup-admin-intel-$STAMP" && mkdir -p "$BK"
say "Backup til $BK …"
for src in "${!MAP[@]}"; do
  dst="${MAP[$src]}"
  cp -p "$dst" "$BK/$(echo "$src" | tr '/' '_')"
  out="$TMP/$(echo "$src" | tr '/' '_')"
  # Behold eier/rettigheter fra eksisterende fil
  cat "$out" > "$dst"
  echo "  oppdatert: $dst"
done

# ── 4) Verifiser live-endepunktet ────────────────────────────────────────────
say "Verifiserer bootstrap …"
RESP=$(curl -fsk --max-time 10 "http://127.0.0.1/api.php?mobile=1&action=bootstrap&_token=setalink-mobile-diag-v1&debug_country=IR" || true)
echo "$RESP" | head -c 400; echo
echo "$RESP" | grep -q '"ok":true' || die "bootstrap svarer ikke ok:true — rull tilbake med: cp $BK/* (se stier over)"
say "FERDIG. Rollback ved behov: kopier filene fra $BK tilbake."
echo "Sjekk 'routing'-feltet over: 'learned:IR' krever telemetri (min 5 forsøk/node) — 'static' er normalt fra start."
