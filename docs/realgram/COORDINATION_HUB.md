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

## 2026-07-12 — Role split + next jobs (from Khabat)

Khabat set the go-forward division of labour so we stop stepping on each
other and each own a coherent surface:

> "du jibber hovedsaklig med realink→realgram også konverteringen layer by
> layer.. og han [Agent B] kan hjelpe å koble til shahnameh, trustai osv."

- **Agent A (ReaLink app owner):** drives the **ReaLink → RealGram
  conversion, layer by layer** — everything inside `mobile-app/`. This is
  the social/messenger transformation of the VPN app: identity layer
  (custom @handle + avatar), the messaging/inbox UI redesign (Gen-Z, not a
  Telegram/Insta/WhatsApp clone), network-quality surface, contact import,
  and the on-app presentation of ecosystem features (game, wallet, earnings).
  A consumes B's server contracts; A does not build server-side identity/SSO.
- **Agent B (ecosystem backend + Shahnameh owner):** builds the **connective
  tissue** — SSO issuer (B-8), signing the Shahnameh web game in from
  ReaLink, and wiring **TrustAI** + other 3real properties into the same
  identity/reward rails. B owns `/v1/*` ecosystem endpoints, the coord hub,
  and the Shahnameh backend. B exposes contracts; A calls them.

**Handshake rule:** any new cross-boundary contract (endpoint shape, JWT
claims, deep-link params) is written in `DECISIONS.md`/§contract first, then
implemented — same as SSO §6 and `link-real-proof` already were.

### Next jobs — agreed queue

Agent A (this repo, `mobile-app/`), conversion layers in order:
- **A-11 Identity layer** — custom `@handle`/nickname + changeable avatar
  (emoji-avatar first, no photo-upload backend needed yet). Foundation for
  "add friend by handle" and for addressing messages. *A owns app; needs a
  tiny B contract: handle uniqueness/lookup endpoint — spec in DECISIONS
  before build.* → **starting now.**
- **A-12 Messaging/Inbox UI redesign** — the Gen-Z messenger surface on top
  of the existing DM/inbox stores + TopBar. Depends on A-11 for identity.
- **A-13 Telegram contact import** — later phase (needs TDLib from A-5 spike
  + one Android build); parked until A-11/A-12 land.

Agent B (ecosystem/Shahnameh):
- **B-8 SSO issuer** (open) — RS256 `POST /v1/sso-token` + JWKS, and make the
  Shahnameh game verify `?sso=<jwt>` and sign in. Unblocks fully-authed
  in-app game. **This is B's top priority — A-10 is live and fail-safe
  waiting on it.**
- **B-9 (new) TrustAI hookup** — once SSO issues tokens, wire TrustAI to
  accept the same JWT so ReaLink's ambassador/earnings ("TrustAI %") and
  TrustAI proper share one identity. Spec the token→TrustAI-account mapping
  in DECISIONS first.
- **B-14 (new, supports A-11)** — handle registry: uniqueness reservation +
  `GET /v1/handle-lookup?handle=` returning device/user for friend-add.
  Small, but it's the one server dependency A-11 has. Contract first.

I'll seed A-11/A-13, B-9, B-14 on the live task board too. B: shout via the
board or a commit here if the split or the queue order doesn't work for you.

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
