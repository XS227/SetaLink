# Storage Management — Fase 1 (done) / Fase 2 (planned)

## Why this exists

The admin dashboard's health check (`admin/api.php`, "Disk space") has
reported a recurring disk-usage warning on the 1GB production VPS, with
nothing automatic doing anything about it. Investigating what actually
grows unboundedly (2026-07-17) found:

1. **`data/tunnel-logs/`** — every diagnostic-log upload from a device
   (`public/api.php`'s tunnel-log-upload action) writes up to 3 files
   (`.txt`, `.meta.json`, `.config.json`) with no retention at all.
2. **`public/releases/<channel>/*.apk`** — `scripts/release.sh` copies each
   new build in but never prunes old ones; APKs are tens of MB each.
3. Three SQLite tables (`routing_decisions`, `node_commands`,
   `node_command_events`) had no row-count cap, unlike `connect_telemetry`'s
   existing `ni_telemetry_rotate()` — fixed separately, see
   `docs/NODE_CONSOLE_ARCHITECTURE.md` and the `lib/node_intel.php` git
   history for that fix (same day, different commit).
4. `/var/log/nginx/*.log` and `/var/log/xray/*.log` — root-owned; the PHP
   process cannot rotate these itself (same reason `admin/api.php`'s xray
   log export already has to run via `sudo`).

## Fase 1 (2026-07-17) — automatic, done

**`lib/storage_manager.php`** — new. Same opportunistic pattern as every
other rotation function in this codebase
(`ni_telemetry_rotate()`/`ni_routing_decisions_rotate()`/`nc_rotate()`):
a cheap probabilistic trigger (1-in-40) on a request path that already
runs frequently, no cron dependency, no separate process to keep alive on
a 1GB box.

- `sm_cleanup_tunnel_logs($keepDays)` — deletes a session's `.txt`/
  `.meta.json`/`.config.json` triple together (grouped by stem), never
  partially, once ALL of a session's files are older than `$keepDays`.
- `sm_cleanup_old_apks($keepPerChannel)` — keeps the N most recent APKs
  per release channel. Resolves every `*latest*.apk` symlink first and
  never deletes whatever it points at, even if that file would otherwise
  be outside the keep window — a stale "latest" symlink pointing at a
  deleted file would break every OTA download. (Verified with a
  deliberately adversarial test: a "latest" symlink pointing at the
  *oldest* file in a 5-APK set survived cleanup correctly.)
- `sm_auto_cleanup()` — the orchestrator, wired into
  `public/api.php`'s tunnel-log upload action (the same endpoint that
  grows `data/tunnel-logs/`, so cleanup naturally scales with the thing
  producing the mess). Runs the normal retention windows (14 days / 5
  APKs per channel) first; if `sm_disk_free_pct()` is still below
  `SM_TARGET_FREE_PCT` (25%, the middle of the requested 20-30% band)
  afterward, escalates to aggressive windows (3 days / 2 APKs per
  channel) on the same call. This is what "maintain at least 20-30% free"
  means in code — react to the actual number, not a fixed schedule
  regardless of need.
- **`deploy/system/setalink-logrotate.conf`** (new) — covers the
  root-owned nginx/xray logs `lib/storage_manager.php` cannot touch.
  Standard `logrotate`, daily, 14-day retention, `compress` +
  `delaycompress` (today's rotated log stays readable uncompressed for one
  more cycle, everything older gets gzipped). One-time install, root
  required — see the file's own header for the exact command. **Not
  installed by this change** — a config file existing in git is not the
  same as it being active on production; this is a deploy-time step for
  whoever has root on the VPS.

**Verification**: `php -l` clean. `sm_cleanup_tunnel_logs()`/
`sm_cleanup_old_apks()` round-tripped against a real temp directory tree
(not mocked) — old session correctly removed as a complete triple, recent
session preserved, and the adversarial "latest symlink points at the
oldest file" case correctly protected that file while pruning the rest.
`sm_auto_cleanup()`'s escalation logic and `deploy/system/setalink-logrotate.conf`
itself were **not** exercised against a live filesystem (would need root /
a real nginx+xray install this dev environment doesn't have) — reviewed
carefully instead of run.

## Fase 2 (planned, not built this pass)

An admin "Storage Manager" panel:

- Disk usage per folder, largest files — `sm_disk_report()` already exists
  in `lib/storage_manager.php` as the data-layer foundation for this (walks
  `data/`, `public/releases`, `public/download`, `public/assets`, returns
  bytes + file count per folder) but is **not wired into any admin API
  action or UI panel yet**.
- Manual buttons: "Clean logs", "Clean cache", "Archive telemetry",
  "Expand storage" (if applicable — likely just a documentation pointer to
  the VPS provider's disk-resize flow, not something PHP can do).
- "Archive telemetry" is meaningfully different from `ni_telemetry_rotate()`'s
  hard delete — presumably compress-and-move-to-cold-storage instead of
  discard, which needs a design decision (where does archived data go on a
  1GB box? off-box only, realistically) not made here.

Deferred deliberately — Fase 1's automatic cleanup is what actually solves
the "permanent disk warning," the admin panel is a visibility/manual-control
layer on top of it, not a prerequisite.
