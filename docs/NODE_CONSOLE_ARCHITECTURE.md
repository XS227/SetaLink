# ReaLink Node Console — Phase 1

## 1. What this is

A generic, node-type-agnostic remote command system for operating VPN
gateway nodes (Starlink, and later Desktop/Raspberry Pi/Community Nodes)
without ever exposing SSH, RDP, or PowerShell to an operator's browser.
Commands ride the *existing* heartbeat channel each node already polls
every ~30-60s (`public/starlink-heartbeat.php` on the server,
`heartbeat.ps1`/`heartbeat.sh` on the node) — this adds a `commands` array
to that same response and a new endpoint,
`public/starlink-command-result.php`, for the node to report back.

Authorized by Khabat 2026-07-17: "Set i gang med Phase 1," with two
explicit requirements that shaped the design from the start (not bolted on
after):

1. **Generic from day one.** `NC_COMMAND_REGISTRY` is keyed by
   `command_key`, and each entry lists which `node_types` it applies to.
   Desktop/Raspberry Pi/Community Node support later means adding a
   node-type-specific executor that speaks the same wire protocol — the
   schema and API shape do not change.
2. **Every command becomes self-learning telemetry.** Every execution —
   admin-enqueued or a watchdog self-heal — writes a structured row to
   `node_command_events` (execution time, success/failure, recovery
   action, health before/after, automatic vs. manual). `ni_rebuild_genome()`
   in `lib/node_intel.php` folds this into the node's `core.reliability`
   stability score, so a node that needs frequent repair scores lower even
   if its raw connect-telemetry success rate looks fine. This is the
   Node Console's contribution to the Genome/Trust/Adaptive-Routing/
   Evolution stack in `docs/NODE_INTELLIGENCE_ARCHITECTURE.md`.

## 2. Why piggyback the heartbeat channel instead of a new inbound port

- **No new attack surface.** The node already makes an outbound HTTPS
  POST every cycle and trusts the response; commands are just one more
  field in a response it already parses. Nothing new listens for inbound
  connections on the node.
- **Works everywhere the heartbeat already works** — behind CGNAT, behind
  a home router, on a phone hotspot. An inbound SSH/RDP port would need
  port-forwarding or a reverse tunnel on every node type; this needs
  neither.
- **One trust boundary to reason about**, not two. The per-node bearer
  token (`starlink-node-<id>:<secret>`, verified by
  `st_verify_heartbeat_token()`) that already gates telemetry ingestion is
  the same credential that gates command polling and result reporting.

## 3. Two independent enforcement points — never a raw shell

`command_key` must be a `NC_COMMAND_REGISTRY` entry, checked in two places
that don't trust each other:

1. **Server-side** (`nc_command_allowed()`): rejects any `command_key` not
   in the registry, or not applicable to the target node's `node_type`,
   before ever signing a token for it.
2. **Node-side** (the `switch`/`case` allowlist in `heartbeat.ps1`'s
   `Invoke-NodeCommand` / `heartbeat.sh`'s inline `case` statement): the
   executor never takes a string from the server and `exec`s or
   `Invoke-Expression`s it. Every command is a hardcoded branch that runs a
   specific, fixed local action. A `command_key` the node doesn't
   recognize (e.g. the server registry gained a new entry the node's
   executor hasn't been updated for yet) hits the `default`/`*` branch and
   reports failure — it is never treated as something to execute.

If either side were compromised alone, the other still blocks arbitrary
execution. This is the same "don't trust a single layer" reasoning as the
signed-token design below.

## 4. Command lifecycle

```
Pending → Running → Completed | Failed | Timed Out
```

1. **Admin enqueues** (`admin/api.php` action `node-command-enqueue`,
   CSRF-protected, same single-tier admin session as every other admin
   action): validates the command against the registry and the node's
   `node_type`, checks the confirmation flag for `confirm => 'single'`
   entries, then calls `nc_enqueue_command()`. This mints a `command_id`
   (`bin2hex(random_bytes(12))`), an HMAC-signed token
   (`hash_hmac('sha256', "{id}|{node_id}|{key}|{expires_at}", secret)`),
   and a 5-minute expiry (`NC_COMMAND_TTL_SECS`). Row status: `pending`.
2. **Node polls** on its next heartbeat: `nc_pending_commands_for_node()`
   returns up to 5 pending, unexpired commands and transitions them to
   `running` (at-least-once delivery — acceptable because every Phase 1
   command is safe to run twice; see §6).
3. **Node executes** locally via its allowlist executor, then **reports
   back** to `starlink-command-result.php` with `{command_id, token,
   success, output, duration_ms}`. The server re-verifies the signature
   (`nc_verify_token()`, expiry-checked independently of the HMAC compare)
   *and* does a redundant `hash_equals()` against the stored signature —
   a node cannot report a result for a command it wasn't actually issued,
   which would otherwise let a compromised/spoofed node inject fake
   success into the audit log or the Genome.
4. Row transitions to `completed` or `failed`; a background probabilistic
   sweep (`nc_expire_stale_commands()`, 1-in-20 per heartbeat, same
   cheap-trigger pattern as `ni_maybe_rebuild_genome()`) marks anything
   still `pending`/`running` past its expiry as `timed_out` (node went
   offline mid-command).
5. Every terminal outcome — including watchdog self-heals, which skip
   steps 1-3 entirely (see §6) — writes one row to `node_command_events`
   via `nc_record_command_event()`.

## 5. Command registry — Phase 1

| `command_key`        | Confirm | Notes |
|-----------------------|---------|-------|
| `wg_status`           | none    | `wg show` (or `wg.exe show`) output |
| `network_status`      | none    | interface/route dump |
| `last_100_logs`       | none    | tail of the node's own watchdog log |
| `refresh_telemetry`   | none    | no-op ack — the heartbeat carrying the command response IS the refresh |
| `restart_wireguard`   | single  | restarts the tunnel service |

Deliberately excluded from Phase 1: reboot, shutdown, factory-reset, OTA
update, arbitrary script execution — anything that would need
`confirm => 'double'`. The registry and the admin API already enforce that
distinction (`$entry['confirm'] === 'double'` requires a
`confirmed_twice` flag) so adding a dangerous command later is additive,
not a redesign.

## 6. Watchdog Integration — self-heal reporting

A watchdog repairing something on its own (ICS re-bind, service restart,
tunnel restart on Windows; NAT/forwarding re-assert, tunnel restart on
Linux) is **not** a server-enqueued command — nothing was `pending`. It
reports directly via `starlink-command-result.php` with
`{self_heal: true, recovery_action, success, duration_ms, health_before,
health_after}`, needing only the same per-node bearer auth as heartbeat
itself (no `command_id`/token — there's nothing to verify against, since
the server never asked for this). Server-side: `nc_report_self_heal()` →
`nc_record_command_event(..., automatic: true)`, landing in the exact same
`node_command_events` table an admin-enqueued command does, distinguished
only by the `automatic` column. This is what makes self-heals visible to
both the admin Node Card's history view and the Genome's stability-score
folding — a node that self-heals constantly scores lower, exactly like one
that fails admin-issued commands.

At-least-once delivery matters here too: if a report POST fails
(node loses connectivity right after a repair), the repair already
happened locally and is retried transparently next cycle if still needed
— nothing is lost except one row of telemetry, not the repair itself.

## 7. Trust model differences

Two distinct trust levels feed the same table:

- **Admin-enqueued commands**: signed, short-lived, single-use token,
  independently re-verified server-side on report. An attacker who can
  read `node_commands` (e.g. DB access) still can't forge a valid report
  without the HMAC secret (`nc_command_secret()`, in
  `/etc/setalink/admin/node-command.secret`, deliberately a **different**
  key from `admin/api.php`'s CSRF secret and from the heartbeat token
  itself — leaking one credential class doesn't compromise the others).
- **Watchdog self-heals**: no token, only per-node bearer auth. A node
  that already holds a valid heartbeat token can claim to have self-healed
  anything. This is an intentionally lighter bar than admin commands —
  self-heal claims are node-level observations, not privileged operations,
  and a node lying about its own health only pollutes its *own* Genome
  entry (bounded blast radius: `ni_rebuild_genome()`'s repair-penalty is
  capped at -30, and only ever affects `core.reliability` for that one
  `node_id`).

## 8. What's genuinely NOT built yet

Explicitly deferred by Khabat's Phase 1 scope ("everything else... can
remain explicitly planned for later phases") — not oversights:

- **RBAC / Owner vs. Admin separation.** The trust boundary today is the
  single admin session (`admin/api.php`'s `$auth_user`), identical to
  every other admin action in this codebase — there is no distinct
  "who's allowed to enqueue commands" role.
- **OTA updates.** No mechanism for pushing new gateway-script versions
  through this channel.
- **Volunteer / Community Nodes.** The registry's `node_types` list
  already anticipates this (`starlink`, `desktop`, `pi`), but nothing
  addresses the different trust boundary a volunteer-operated node
  implies (an admin enqueuing a command on a node they don't physically
  control is a different risk profile than on Khabat's own Surface/Pi).
- **Script Library / arbitrary scripts.** Explicitly ruled out — the
  allowlist-only model (§3) is the whole point; a "run this script" command
  would reintroduce the exact remote-code-execution surface this design
  avoids.
- **Live terminal / interactive shell.** Not a queued-command model at
  all; a genuinely different (and much larger) trust and transport design.
- **Linux node-side executor beyond `heartbeat.sh`/`watchdog.sh`'s
  built-in command dispatch.** The Phase 1 registry's 5 commands are
  implemented on both Windows and Linux (see
  `docs/STARLINK_WINDOWS_HANDOFF.md` §22) — a dedicated OpenWrt-side
  dispatcher is not (python3, used for safe JSON handling in the Linux
  dispatcher, isn't guaranteed present on OpenWrt; see that heartbeat.sh's
  comments).
- **Dangerous commands** (reboot/shutdown/factory-reset). Registry has
  none; the `confirm => 'double'` plumbing exists and is enforced, but
  nothing populates it yet.

## Verification

`php -l` clean on every changed/new file
(`lib/node_console.php`, `public/starlink-heartbeat.php`,
`public/starlink-command-result.php`, `admin/api.php`, `lib/node_intel.php`).
Full round-trip smoke-tested against an in-memory SQLite DB: enqueue →
poll (pending→running transition) → report result (signature verified) →
event recorded → `ni_rebuild_genome()` correctly applies the repair
penalty to `core.reliability` (verified: 3 command events, 2 automatic + 1
failure, produced a stability score of 93 instead of 100 — matches the
`min(30, auto_repairs*2 + failures*3)` formula exactly). `bash -n` clean on
`watchdog.sh`/`heartbeat.sh`; the Windows scripts were validated for
balanced braces/parens and pure-ASCII content (no `pwsh` available in this
environment to run the real parser — flagged, not silently assumed correct).
