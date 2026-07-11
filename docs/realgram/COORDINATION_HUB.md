# Agent Coordination Hub

**Decided by Khabat, 2026-07-11:** "dere kan også få utveksle tilganger og
info dere sitter med gjennom db... nå skal dere to jobbe som 1." A live
alternative to the git-commit round trip this whole `docs/realgram/` folder
has been — both agents read/write task status and exchange credentials
through this API instead of only through `TASK_SPLIT.md`/`DECISIONS.md`.

This doc doesn't replace those files — keep using them for anything that
benefits from being reviewable/durable in git history (decisions, contracts,
design docs). Use the hub for anything that changes faster than a commit
round trip is worth, and for actual credential exchange (which never
belonged in git anyway, per this repo's existing "names only, never values"
rule).

## Where it lives

Hosted on Agent B's Shahnameh backend (`shahnameh-backend` repo, `170ba7a`),
same server as the `/v1/*` ecosystem API from B-1. Base path: `/coord`
(behind whatever this backend's public origin is — see
`AGENT_HANDOFF.md`/ask Khabat for the reachable URL, same as `real_api_url`).

## Auth

Every request needs `Authorization: Bearer {AGENT_COORD_API_KEY}`.
**Deliberately a different key from `REAL_ECOSYSTEM_API_KEY`** — this hub
can hold arbitrary cross-system credentials, wider blast radius than the
ecosystem contracts, kept compartmentalized. Value not written here — relay
it out of band (same channel Khabat already used for the deploy key and
`REAL_ECOSYSTEM_API_KEY`).

## Task board — `GET/POST /coord/tasks`

```
GET /coord/tasks?owner=A|B&status=todo|in_progress|blocked|done
→ { status: 1, tasks: [{ task_id, owner, title, status, notes,
                          blocked_on, updated_by, created_at, updated_at }] }

POST /coord/tasks
{ task_id, owner: "A"|"B", title, status?, notes?, blocked_on?, updated_by }
→ upserts by task_id
```

Seeded 2026-07-11 with the current A-1..A-6 / B-1..B-7 / OPS-1 state from
`TASK_SPLIT.md`. **Whichever of these two — the board or `TASK_SPLIT.md` —
drifts out of sync, trust the board** (it's live; the doc is a point-in-time
snapshot from when it was written) but keep updating both: the doc for
narrative/decisions, the board for current status.

## Credential vault — `GET/POST/DELETE /coord/secrets`

AES-256-GCM at rest (`AGENT_COORD_VAULT_KEY` — **also needs relaying to
Agent A's environment**, both sides need the same value to decrypt what the
other wrote). Named, described entries only — not a free-for-all blob store.

```
GET /coord/secrets                     -> names + description + set_by + updated_at, NEVER values
GET /coord/secrets/:name?actor=A|B     -> { value, description, set_by, updated_at }
POST /coord/secrets                    { name, value, description?, set_by }
DELETE /coord/secrets/:name?actor=A|B
```

`actor`/`set_by` required on every read/write — every access is logged
(`GET /coord/audit`, names/actions only, never values).

**Suggested first use:** once Khabat relays `AGENT_COORD_API_KEY` +
`AGENT_COORD_VAULT_KEY` to Agent A, put the still-pending B-2 values
(`real_link_secret`, `real_api_key`, `real_api_url`) in here instead of
waiting on a separate manual relay — Agent A can then read them directly
and finish B-2 without Khabat being the bottleneck for every value.

## What this is not

- Not a replacement for the git docs (decisions/contracts still belong
  there — this is state, not history).
- Not unauthenticated or public — same Bearer-auth posture as `/v1/*`.
- Not a place for arbitrary application data — task board and named
  credentials only. If something needs a real shared database, that's a
  bigger, separate decision (network exposure, schema, ownership) — raise
  it with Khabat rather than growing this hub into one ad hoc.
