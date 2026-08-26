# Node Intelligence Architecture — Genome, Trust, Adaptive Routing, Evolution

**Date:** 2026-07-16 · **Status:** implemented server-side, `php -l` clean on
all touched files, smoke-tested against an in-memory SQLite DB (schema,
trust weighting, genome aggregation, hierarchical ranking, decision
recording/outcome-attach all exercised — see "Verification" below).
**Adaptive Routing is OFF by default and has never been turned on.** Nothing
routes real user traffic differently because of this work yet — see Rule 7.

This extends the existing Tap-to-Learn telemetry engine (`lib/node_intel.php`,
built 2026-07-16 in commit `ec8de6d`) with four additional layers, per
Khabat's brief. It does not replace anything that engine already does
(`ni_agent_insights()`, `ni_recommendations()`, `ni_ai_diagnosis()` etc. are
untouched and still the dashboard's diagnostic view) — it adds a second,
complementary capability: turning telemetry into *routing decisions*, not
just *insights for a human to read*.

## 1. Why four layers, not one

A single global health score per node (what `ni_node_scores()` already gave
you) answers "is this node healthy overall." It cannot answer "is this node
the *right* node for an Iranian MCI user on WiFi right now" — a node can be
globally mediocre and still be the best available choice for one specific
context, or vice versa. Four layers, each solving one part of that:

1. **Node Genome** — a node's capability profile as a set of scores broken
   down by context (country, carrier, network type, time of day), not one
   number.
2. **Telemetry Trust Engine** — how much to trust the reports that feed the
   Genome. Without this, a handful of fabricated or replayed reports could
   distort a low-traffic node's Genome disproportionately.
3. **Adaptive Routing** — combines Genome + request context to rank
   candidate nodes, instead of returning them in arbitrary order with a
   single annotated score.
4. **Evolution Layer** — closes the loop: records what was predicted,
   compares it to what actually happened, and nudges routing weights
   accordingly, so the weights aren't hand-tuned forever.

## 2. Node Genome

`lib/node_intel.php`: `node_capability_profile` table, one row per
`(node_id, dimension, segment)` — e.g. `('starlink-no-01', 'carrier',
'mci')`. Built by `ni_rebuild_genome()`, which scans `connect_telemetry`
(last 14 days) and aggregates **trust-weighted**, not raw, counts — a row
with `trust_weight = 0` contributes nothing.

Dimensions implemented now: `core` (every row, node-wide), `country`
(server-derived from request IP via `v1_geo_country()` — zero client change
needed), `carrier` (from the existing `carrier_name` field, already
client-sent for Iran-debug purposes), `network` (`network_type`, already
client-sent), `daypart` (derived from `created_at`, four buckets).

**Not implemented yet — needs a client contract:** `app_category` (which
kind of traffic — streaming, messaging, gaming — the session represented).
Nothing in `connect_telemetry` carries this today. See §6.

`ni_node_genome($pdo, $nodeId)` assembles one node's full profile as nested
JSON, matching the shape Khabat specified:
```json
{
  "node_id": "starlink-no-01",
  "core":     { "reliability": { "success_rate": 98, "avg_latency_ms": 87, ... } },
  "carrier":  { "mci": {...}, "irancell": {...} },
  "country":  { "IR": {...}, "RU": {...} },
  "daypart":  { "morning": {...}, "evening": {...} },
  "network":  { "wifi": {...}, "mobile": {...} },
  "policy_bonus": 15
}
```
`policy_bonus` is read from `settings` (`ni_policy_bonus()`) and **never**
merged into the measured cells — see §5.

Rebuild is triggered probabilistically on telemetry writes
(`ni_maybe_rebuild_genome()`, ~1-in-30, same pattern as the existing
`ni_telemetry_rotate()`) — no cron dependency, no background process.

## 3. Telemetry Trust Engine

Every `connect_telemetry` row now carries a `trust_weight` (0.0–1.0),
computed at insert time by `ni_trust_weight_for_event()` and used
everywhere the Genome aggregates. Three checks, in order:

1. **Plausibility** (`ni_trust_plausible()`) — hard gate. Bounded, generous
   ranges per field (`NI_TRUST_BOUNDS`) catch physically-impossible values
   (negative jitter, 0ms latency, a battery level of 150%) without
   penalising real edge cases like high-latency satellite links.
2. **Replay** (`ni_trust_replay_seen()`) — hard gate. A wide set of fields
   hashed together with a 5-second time bucket; an exact repeat within that
   window scores 0. **Known limitation:** without a client-supplied nonce or
   monotonic sequence number, two *genuinely distinct* events from the same
   device that happen to be byte-identical within 5 seconds of each other
   will also be flagged. This was caught during smoke-testing (a synthetic
   rapid-fire test loop produced false positives) and is an accepted v1
   trade-off, not an oversight — the alternative is no replay detection at
   all. Recommended follow-up: a client-side monotonic event counter, so
   replay detection can require identity on that instead of inferring it
   from metric coincidence.
3. **Device trust score** (`ni_device_trust_score()`) — soft multiplier.
   Stored in `device_trust`, updated via a slow EMA (α=0.1) after every
   event so one bad report can't crater a long-trusted device and one good
   report can't launder a bad one. New devices start at 0.3, not 0 or 1.0.

`device_trust` is device-identified by necessity — same identifiability
class as `tap_intel_contributions`, and it never joins against the anonymous
`connect_telemetry` table on anything but the transient `device_id`
parameter passed into `ni_record()` (never stored on the row itself).

## 4. Adaptive Routing

`ni_rank_nodes($pdo, $candidateIds, $context)` — hierarchical fallback:
for each candidate, try the most specific Genome cell matching the request
context (carrier → country → network → core), falling back to a broader
tier whenever the matched cell has fewer than `NI_MIN_SEGMENT_SAMPLES` (5.0)
trust-weighted samples, down to the existing global `ni_node_scores()` as
the last resort. Composite score = weighted blend of success rate,
normalised latency, stability, and a reconnect-rate-based congestion proxy,
plus the node's `policy_bonus` added last. Returns nodes **sorted**
best-first, each entry carrying which fallback tier actually produced its
score (`context_level`) — always auditable, never a black box.

**`GET /v1/servers`** now optionally accepts `?carrier=` and
`?network_type=` query params; `country` is always derived server-side from
the request IP (reusing the exact lookup `/v1/telemetry/connect` already
does — extracted into `v1_geo_country()`).

### Feature flag — Rule 7

`docs/CLAUDE_REALINK_RULES.md` Rule 7: *"Any change that routes real user
traffic to a new node... requires explicit user approval before
deployment."* Ranking real traffic is exactly that. `adaptive_routing_enabled`
(settings table) defaults to **off**, checked by `ni_adaptive_routing_enabled()`.
Nothing in this codebase sets it to `'1'` — the only path is the new admin
action `routing-toggle` (`admin/api.php`), which Khabat calls explicitly.
While off, `/v1/servers` is byte-for-byte what it was before this work:
unsorted, annotated with `successScore` only, plain array response.

**When turned on, the response shape changes** for that endpoint: instead
of a plain array, it returns `{"servers": [...], "decisionId": "..."}`.
**This is a breaking change for the currently-shipped client** — turning the
flag on requires a coordinated mobile-app update (Agent A), not just a
server-side toggle. Do not enable this flag without confirming the shipped
app version can handle the new shape, independent of Rule 7 sign-off itself.

## 5. Policy bonus — kept separate on purpose

`ni_policy_bonus($pdo, $nodeId, $nodeType)` reads `settings` keys
`node_policy_bonus_<node_id>` (specific) or `node_policy_bonus_type_<type>`
(whole class, e.g. all Starlink nodes), admin-settable via
`routing-set-bonus`. This is **added to the composite score after** all
measured dimensions, and is a **separate top-level key** in the Genome JSON
(`policy_bonus`) — never blended into `core`/`carrier`/`country`/etc. This
was an explicit requirement (Khabat, 2026-07-16: *"keep policy bonuses
completely separate from measured quality, so product decisions... never
contaminate the actual health model"*) and is enforced structurally, not
just by convention — there is no code path that writes a bonus value into
`node_capability_profile`.

## 6. Evolution Layer

Every ranked `/v1/servers` response (only when the flag is on) is recorded
as a `routing_decisions` row: the full ranked candidate list, which node was
predicted best, and a `decision_id` handed back to the client. When a later
`/v1/telemetry/connect` POST carries that same `decision_id`, its outcome
(actual node used, event, latency, reconnects) is merged back into the
decision row by `ni_attach_decision_outcome()` — this is wired into
`ni_record()` already, no separate endpoint needed.

`ni_evolve_weights()` (probabilistic trigger, ~1-in-50 writes) looks at the
last 200 decisions with a recorded outcome from the past day, and nudges
`routing_weights` by a small bounded step (±3% per contributing decision,
hard-capped at ±10% per evolution cycle, weights clamped to `[0.1, 3.0]`).

**Scope limitation, stated plainly:** this is bounded arithmetic — an
EMA-style reinforcement of whichever dimensions a correct prediction leaned
on, and a dampening when a prediction didn't pan out. It is **not** gradient
descent, not a trained model, and not anything requiring an ML runtime —
this runs in PHP against SQLite on a 1GB box. That is a scope decision, not
an oversight: every adjustment is small, attributable to specific decisions,
and reversible by resetting `routing_weights`, rather than an opaque
converging model. If real machine learning is wanted later, this data
(`routing_decisions` with predicted/actual outcomes) is exactly the training
set it would need — nothing here forecloses that, it just isn't built now.

## 7. What's genuinely NOT built yet

- **`app_category` dimension** — needs a mobile-app contract (what values,
  who decides "video streaming" vs "messaging" client-side). Cross-boundary,
  Agent A's territory per `docs/realgram/COORDINATION_HUB.md`'s role split.
  The Genome and ranking code already tolerate its absence gracefully (it's
  just one more optional tier in the fallback chain once it exists) — adding
  it later needs no schema migration beyond what's already in place (the EAV
  `node_capability_profile` shape accepts any `dimension` string).
- **Congestion as a directly-measured signal** — currently a reconnect-rate
  proxy, not real concurrent-session load. A real signal would need each
  node type to report its own active-session count (Starlink nodes already
  heartbeat; VPS nodes would need the same).
- **Community/Desktop/RPi node types reporting Genome data** — the schema
  and ranking are node-type-agnostic already (`node_id` is just a string),
  but only Starlink and the two static VPS nodes exist as routable
  candidates today. Self-registration (Phase 2, commit `37bec62`) is the
  on-ramp for more node types to start appearing here.
- **Predictive (forward-looking) failure detection** — `ni_recommendations()`
  and `ni_agent_insights()` remain descriptive/backward-looking. Nothing here
  forecasts an outage before it happens.

## Verification

Ran a standalone smoke test (`php` against an in-memory SQLite DB, not
committed — synthetic, not a permanent test file) exercising: schema init,
~55 telemetry writes across two nodes/three devices including one
deliberately-implausible report, genome rebuild, hierarchical ranking
(confirmed correct fallback from `carrier` tier to `global` tier when a
node's context-specific trust-weighted sample count was too low), decision
recording, and outcome attachment via a synthetic `decision_id` round-trip.
Caught and fixed two real bugs before this doc was written: an invalid
`PDO::KEY_PAIR` constant (should be `PDO::FETCH_KEY_PAIR`), and the
replay-detection window described as a limitation in §3. All three touched
PHP files (`lib/node_intel.php`, `public/v1.php`, `admin/api.php`) are
`php -l` clean.

**Not verified:** behavior under real production traffic, real mobile-app
integration, or the `/v1/servers` response-shape change with an actual
client (since the flag has never been turned on). That verification can only
happen after Rule 7 sign-off and a coordinated app update.
