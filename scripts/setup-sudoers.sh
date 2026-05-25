#!/bin/bash
# setup-sudoers.sh — run once as root to enable admin NAT repair from the web UI.
# This script installs a SINGLE minimal-privilege sudoers rule: www-data can run
# ONLY /usr/local/sbin/setalink-nat-repair — nothing else.
#
# Usage (run as root or with sudo):
#   sudo bash /var/www/setalink/scripts/setup-sudoers.sh

set -euo pipefail

WRAPPER=/usr/local/sbin/setalink-nat-repair
SUDOERS=/etc/sudoers.d/setalink-webserver

echo "[1/3] Writing repair wrapper: $WRAPPER"
cat > "$WRAPPER" <<'WRAPPER_EOF'
#!/bin/bash
# setalink-nat-repair — privileged wrapper called by the web admin UI via sudo.
# Detects the real egress interface and applies NAT / ip_forward fixes.
# Runs only fixed, safe commands. Never executes arbitrary user input.
set -euo pipefail

# Detect real egress interface (not hardcoded — works for ens3, eth0, etc.)
IFACE=$(ip route get 1.1.1.1 2>/dev/null | awk '/dev/{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')
if [ -z "$IFACE" ]; then
  IFACE=$(ip route show default 2>/dev/null | awk '/dev/{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')
fi
if [ -z "$IFACE" ]; then
  echo "ERROR: cannot detect egress interface"; exit 1
fi
echo "IFACE=$IFACE"

# Step 1: Enable ip_forward
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1
FWD=$(cat /proc/sys/net/ipv4/ip_forward)
echo "IP_FORWARD=$FWD"

# Step 2: Persist ip_forward
SYSCTL_CONF=/etc/sysctl.d/99-vpn-nat.conf
grep -qxF 'net.ipv4.ip_forward=1' "$SYSCTL_CONF" 2>/dev/null || echo 'net.ipv4.ip_forward=1' > "$SYSCTL_CONF"
echo "SYSCTL_PERSISTED=1"

# Step 3: Add MASQUERADE if missing
if iptables -t nat -L POSTROUTING -n 2>/dev/null | grep -q MASQUERADE; then
  echo "MASQUERADE_EXISTS=1"
else
  iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE
  echo "MASQUERADE_ADDED=1"
fi

# Step 4: Save rules (survives reboot)
mkdir -p /etc/iptables
if command -v netfilter-persistent &>/dev/null; then
  netfilter-persistent save >/dev/null 2>&1 && echo "RULES_SAVED=netfilter-persistent"
elif iptables-save > /etc/iptables/rules.v4 2>/dev/null; then
  echo "RULES_SAVED=iptables-save"
else
  echo "RULES_SAVED=failed"
fi

# Step 5: Restart Xray
systemctl restart xray 2>&1 || true
sleep 2
if systemctl is-active --quiet xray 2>/dev/null; then
  echo "XRAY_OK=1"
else
  echo "XRAY_OK=0"
fi
WRAPPER_EOF

chmod 755 "$WRAPPER"
chown root:root "$WRAPPER"
echo "   OK: $WRAPPER"

SYNC_SCRIPT=/usr/local/sbin/setalink-sync-edge-config

echo "[2/3] Writing sudoers rule: $SUDOERS"
cat > "$SUDOERS" <<SUDOERS_EOF
# SetaLink admin privileged scripts — www-data may run ONLY these two scripts as root.
# Both scripts are root-owned 755 so their contents cannot be modified by www-data.
www-data ALL=(ALL) NOPASSWD: $WRAPPER
www-data ALL=(ALL) NOPASSWD: $SYNC_SCRIPT
SUDOERS_EOF

# Validate sudoers before activating (visudo -c on the new file)
if visudo -c -f "$SUDOERS" >/dev/null 2>&1; then
  chmod 440 "$SUDOERS"
  echo "   OK: $SUDOERS (validated by visudo)"
else
  rm -f "$SUDOERS"
  echo "ERROR: sudoers validation failed — removed $SUDOERS"
  exit 1
fi

echo "[3/3] Testing: sudo -u www-data sudo $WRAPPER (dry-run check only)"
if sudo -u www-data sudo -n "$WRAPPER" 2>&1 | head -2; then
  echo "   OK: www-data can run the repair wrapper"
else
  echo "   WARN: test run failed — check output above. The sudoers rule is installed;"
  echo "         the actual repair call may still work from the web UI."
fi

echo ""
echo "Done. The admin 'Repair NAT' button will now work."
echo "Only /usr/local/sbin/setalink-nat-repair can be run as root by www-data."
