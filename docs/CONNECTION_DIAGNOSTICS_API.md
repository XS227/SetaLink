# Connection Diagnostics — API reference

Companion to `docs/CONNECTION_DIAGNOSTICS.md` (architecture/rationale). This
doc is the field-level reference: every endpoint, every request/response
field, every stored column. Mirrors the style of `docs/MULTINODE_API_v1.md`.

**Status:** implemented, not deployed (see `CONNECTION_DIAGNOSTICS.md` §4 for
gaps). All endpoints live in `public/v1.php`.

---

## 1. `POST /v1/telemetry/connect` (extended)

Already existed (anonymous connect-outcome upload). This PR adds new optional
fields; nothing removed, nothing renamed, so old client builds keep working
unchanged against the new server.

**Auth:** none required — explicitly public (`$publicRoutes` in `v1.php`), so
a fresh connect can report before any device-identity round-trip completes.
**Body:** form-encoded or JSON, either works (`v1_body()` reads both).

### New fields in this PR

| Field | Type | Sent by | Notes |
|---|---|---|---|
| `trigger` | `'connect'\|'disconnect'\|'tap'\|'diagnostics'` | client | `'diagnostics'` rows are stored as `event='diagnostics_probe'` server-side regardless of the `event` value sent (see §5) |
| `network_generation` | `'5g'\|'4g'\|'3g'\|'2g'\|'unknown'` | client | best-effort, see gaps doc §4.2 |
| `mtu` | int | client | 1400 (normal) or 1280 (emergency mode) |
| `packet_loss_pct` | float 0–100 | client, `diagnostics` rows only | see approximation method, gaps doc §5 |
| `tcp_connect_ms` | int | **not yet sent** (schema+plumbing ready) | see gaps doc §4.1 |
| `handshake_ms` | int | **not yet sent** (schema+plumbing ready) | see gaps doc §4.1 |
| `throughput_down_kbps` | int | client, `diagnostics` rows only, Wi-Fi only | real timed transfer, not an estimate |
| `throughput_up_kbps` | int | client, `diagnostics` rows only, Wi-Fi only | real timed transfer, not an estimate |
| `device_model` | string | client | already existed as a column; wasn't reaching this endpoint before |

### Full field list (existing + new) as stored in `connect_telemetry`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `event` | TEXT | `connect_ok`\|`connect_fail`\|`internet_fail`\|`probe_fail`\|`quic_probe`\|`quic_probe_direct`\|`diagnostics_probe` |
| `node_id` | TEXT | e.g. `primary`, `fi-hel`, `starlink-no-01` |
| `profile_id`, `sni`, `protocol` | TEXT | connect-attempt identity |
| `platform` | TEXT | `android`\|`ios`\|`unknown` |
| `app_version`, `build_number` | TEXT/INT | |
| `network_type` | TEXT | `wifi`\|`mobile`\|`unknown` |
| `network_generation` | TEXT | **new** — `5g`\|`4g`\|`3g`\|`2g`\|`unknown`, or `NULL` if not sent |
| `isp_hash`, `carrier_hash` | TEXT | SHA-256(10 hex chars), never raw |
| `country` | TEXT | geo-derived server-side from request IP, 2-letter code |
| `failure_stage`, `error_category` | TEXT | |
| `latency_ms` | INT | connect-initiation → first tunnel byte |
| `time_to_connect_ms` | INT | same value as `latency_ms` today (see `_reportTelemetry`) |
| `rtt_ms` | INT | **no longer sent by the client** — the old value here was fabricated (30% of `latency_ms`); real RTT needs the native connect-path timing split (gaps §4.1) |
| `tcp_connect_ms` | INT | **new column, not yet populated** |
| `handshake_ms` | INT | **new column, not yet populated** |
| `jitter_ms` | INT | **new: real** — stddev of 5 probe RTTs |
| `packet_loss_pct` | REAL | **new: real (approximated)** — see §5 of the architecture doc |
| `throughput_down_kbps`, `throughput_up_kbps` | INT | **new: real** — timed transfer, Wi-Fi only |
| `mtu` | INT | **new: real** — 1400 or 1280 |
| `reconnect_count` | INT | existing column; not sent by the async diagnostics row (see architecture doc — it's per-run, not per-profile) |
| `device_model` | TEXT | e.g. `iPhone15,3` |
| `internet_ok`, `exit_ip_ok`, `dns_ok` | 0/1 | |
| `trigger_type` | TEXT | `connect`\|`disconnect`\|`tap`\|`diagnostics` — mirrors the request's `trigger` |
| `trust_weight` | REAL 0–1 | Telemetry Trust Engine score, unrelated to this PR |
| `created_at` | TEXT | server-set, UTC |

Full column list (including fields unrelated to this PR — QUIC probe,
tap-to-learn, NAT type, etc.) is the `CREATE TABLE` in `lib/node_intel.php`.

### Response

`{"ok": true}` always (by design — telemetry must never surface an error to
the user). `{"ok": true, "throttled": true}` if the per-IP rate limit
(40/min, unrelated to this PR) is hit — row silently dropped.

---

## 2. `GET /v1/speedtest/download?bytes=N` (new)

**Auth:** none (public route, same reasoning as `/telemetry/connect`).
**Query param:** `bytes` — requested response size. Server clamps to
`[64, 4194304]` (64 bytes – 4 MB). Two callers use very different sizes on
purpose:
- Jitter/packet-loss probe: `bytes=256` — tiny, so timing reflects
  round-trip overhead, not transfer time.
- Throughput test: `bytes=1048576` (1 MB) — large enough to time meaningfully.

**Response:** `Content-Type: application/octet-stream`, `Content-Length: N`,
body = N bytes of `random_bytes()` (not zeros/compressible — avoids a
transparent-gzip proxy skewing the timing). Streamed in 64 KB chunks
server-side, not buffered in memory at once (relevant on 1 GB-RAM-class
nodes).

**Rate limit:** 6 requests/minute/IP (`ni_speedtest_gate()`, separate bucket
from the telemetry limiter — real bytes cost more than a JSON row). Over the
limit → `429 {"ok": false, "throttled": true}`.

---

## 3. `POST /v1/speedtest/upload` (new)

**Auth:** none (same reasoning).
**Body:** raw bytes, any content — the endpoint reads and discards, doesn't
inspect or store the payload. Capped at 4 MB (`Content-Length` checked
up front, and the read loop also stops early as a belt-and-suspenders
check against a lying `Content-Length`).

**Response:** `{"ok": true, "bytes_received": N}`.
**Rate limit:** same 6/min/IP bucket as `/speedtest/download`.
**413** if `Content-Length` exceeds the cap before any bytes are read.

---

## 4. Admin: `GET admin/api.php?action=connection-diagnostics`

**Auth:** admin session (existing CSRF/session gate, unchanged).
**Query params:** `days` (1–90, default 7).

**Response:**
```json
{
  "days": 7,
  "by_node":               [ {dimension:"node_id", value:"starlink-no-01", total, ok, success_rate, avg_rtt_ms, n_rtt_ms, avg_tcp_connect_ms, n_tcp_connect_ms, avg_handshake_ms, n_handshake_ms, avg_time_to_connect_ms, n_time_to_connect_ms, avg_jitter_ms, n_jitter_ms, avg_packet_loss_pct, n_packet_loss_pct, avg_throughput_down_kbps, n_throughput_down_kbps, avg_throughput_up_kbps, n_throughput_up_kbps, avg_reconnect_count, mtu}, ... ],
  "by_platform":            [ {..., value:"ios"|"android"|"unknown", ...} ],
  "by_network_type":        [ {..., value:"wifi"|"mobile"|"unknown", ...} ],
  "by_network_generation":  [ {..., value:"5g"|"4g"|"3g"|"2g"|"unknown", ...} ]
}
```

Every `avg_*` field is paired with an `n_*` field — the real sample count
that average is built from. **The admin UI (and any future consumer of this
API) must treat `n=0` as "no data," never render the accompanying `avg_*` as
a real number.** This is the enforcement point for "no simulated/estimated
numbers shown as real" — see `lib/node_intel.php::ni_perf_breakdown()`,
which uses SQL `AVG()`/`COUNT()` (NULLs are excluded from `AVG`
automatically), so an `n=0` metric always pairs with `avg=null`, never `0`.

`total`/`ok`/`success_rate` count real connect attempts only
(`connect_ok`/`connect_fail`/`internet_fail`/`probe_fail`) —
`diagnostics_probe` rows contribute to the `avg_*`/`n_*` columns but are
deliberately excluded from these three so a node's attempt volume isn't
doubled by its own follow-up diagnostics row.

---

## 5. Server-side event mapping (important, easy to miss)

The client always sends `event: 'connect_ok'` as a required-field
placeholder on `diagnostics`-trigger rows (see `scheduleConnectionDiagnostics()`
in `autoConnector.ts`) — **the server overrides this** to `event:
'diagnostics_probe'` whenever `trigger === 'diagnostics'` (see the block in
`public/v1.php` right after `$rawTelemetryEvent = v1_body('event');`). This
keeps diagnostics rows out of every existing success-rate calculation
(`ni_node_scores`, `ni_learned_routing`, etc. all exclude
`quic_probe`/`quic_probe_direct`/`diagnostics_probe`) while still landing in
`connect_telemetry` for `ni_perf_breakdown()` to average. If you add a new
success-rate query against this table, exclude `diagnostics_probe` the same
way — it is not a connect attempt.
