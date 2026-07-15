# RealGram — Agent Handoff

**Read this file in full before doing anything.** It is the living state
document for this work. Update it at the end of every meaningful step —
that's not optional, it's how the next agent (possibly you, possibly someone
else, possibly from a different account with no access to any conversation)
knows what actually happened.

---

## Current state (last updated 2026-07-11, by the dev-box agent session)

- **Branch:** `feature/realgram-foundation`, created from `origin/main` at
  commit `ae78ab0` ("blog: Persian SEO blog with 3 filtershekan articles").
  **Now on GitHub** — the push blocker below is resolved (kept for history).
- **Work done:** documentation only. `docs/realgram/*` (this folder) and
  root `PROJECT_STATUS.md` created. **No RealGram code exists.**
- **Where the work physically happened:** an isolated git worktree at
  `/root/realgram-work/setalink` on the VPS this session ran on — **not**
  the live production checkout at `/var/www/setalink`, which was never
  touched. If you're a future agent on a different machine, this worktree
  path is irrelevant to you; what matters is the branch and its commits.
- **⚠ Roadmap overlap — read before scheduling Phases 1–2:** the
  `IMPLEMENTATION_PLAN.md` roadmap's Phase 1 (Ecosystem Plan §B + §C2) and
  Phase 2 (§A redemption ledger **plus** the A2 account-linking +
  server-verified `redeem-real` endpoint) were implemented 2026-07-11 on
  branch `feat/ecosystem-phase1` (commits `eceab4b` + `ac5cea5`) by a
  different agent session, in parallel with this handoff. Not yet deployed
  server-side and not merged to main, but the code exists, is E2E-smoke-
  tested, and follows the internal-settlement custody recommendation
  (verification is settings-gated and fails closed to `pending`/manual
  admin review). Phase 3 (RealGram Path A) therefore no longer waits on
  Phases 1–2 being *built* — only on their deployment.

## ⚠ Push blocker — RESOLVED 2026-07-11 (history below)

**Resolution:** the repo owner added a write-scoped deploy key
(`vps-setalink-realgram`) for the SetaLink repo on the VPS the handoff
session ran from, and the branch is now on `origin` (verified from a second
machine: `git fetch origin feature/realgram-foundation` succeeds, tip
`009ed7f`). The dev box (`~/SetaLink`, separate machine) has its own
working push access. Original finding kept verbatim below for the record.

No working git credential for **push** access to
`https://github.com/XS227/SetaLink.git` was found on the VPS this session
ran from:

- HTTPS remote has no credential helper and no cached credentials
  (`git push` fails with "could not read Username").
- The box's default SSH key (`~/.ssh/id_ed25519`) authenticates to GitHub,
  but as a **deploy key scoped to a different repository**
  (`XS227/REALShahnameh`), confirmed via `ssh -T git@github.com`'s greeting
  — it does not have access to `XS227/SetaLink`.
- No SetaLink-specific SSH key or token was found. (This session's search
  stopped short of dumping environment variables or doing broader
  credential enumeration, since that's a decision for a human, not
  something an agent should do unprompted.)

**Until this is resolved, treat `feature/realgram-foundation` as existing
only in whatever local clone/worktree created it.** Before continuing work:

1. Check `git log origin/feature/realgram-foundation -1` — if that fails
   (unknown ref), it is **not** on GitHub yet.
2. If it's not there, one of these needs to happen before more agents can
   collaborate on this: (a) the repo owner adds a deploy key or PAT with
   write access to the environment running future agent sessions, or
   (b) the repo owner pulls this branch from wherever it was created and
   pushes it themselves, or (c) the branch's commits are re-applied from a
   patch/bundle by whoever does have access.
3. **Do not silently work around this by pushing to a different remote, a
   fork, or force-pushing over `main`.** If push access genuinely can't be
   arranged, stop and ask.

## Quick start for next agent

```bash
# 1. Clone (adjust remote if you're not on the box that already has it cloned)
git clone https://github.com/XS227/SetaLink.git
cd SetaLink

# 2. Check whether the RealGram branch made it to GitHub (see blocker above)
git fetch origin
git log origin/feature/realgram-foundation -1   # fails if not pushed yet

# 3a. If it exists on origin:
git checkout feature/realgram-foundation

# 3b. If it does NOT exist on origin, recreate it from this documentation's
#     source of truth — the docs/realgram/ folder content in whatever local
#     copy/patch you were handed — or ask the repo owner for the branch.

# 4. Read the docs, in this order:
cat PROJECT_STATUS.md
cat docs/realgram/AGENT_HANDOFF.md       # this file
cat docs/realgram/IMPLEMENTATION_PLAN.md

# 5. Mobile app — install and validate (does NOT touch production)
cd mobile-app
npm install
npm run type-check
npm run lint
npm test

# 6. Android build (requires Android SDK/NDK set up locally — not run on the
#    ops VPS per its own operating rules; run this on a real dev/CI machine)
npm run android
# or, for a release-style build:
cd android && ./gradlew assembleRelease   # then check size per BUILD_SIZE_BUDGET.md

# 7. iOS build (requires macOS + Xcode; CI secrets documented below)
npm run ios
# or use the existing ios-testflight.yml GitHub Actions workflow

# 8. Locate relevant modules
#    - Xray/VPN bridge:      mobile-app/src/services/vpnBridge.ts
#                             mobile-app/android/.../XrayModule.kt
#    - Xray config builder:  mobile-app/src/services/xrayConfigBuilder.ts
#    - Connection state:     mobile-app/src/services/connectionMachine.ts
#    - Design system:        mobile-app/DESIGN_SYSTEM.md
#    - Ecosystem/reward docs: docs/PREMIUM-REAL-PAYMENTS.md
#                              docs/REWARDED-ADS-RECOVERY.md
#                              mobile-app/docs/ECOSYSTEM_INTEGRATION_PLAN.md

# 9. Validate no production services were modified
#    This branch/worktree should contain ONLY additions under docs/realgram/
#    and the root PROJECT_STATUS.md, plus whatever RealGram-specific code a
#    later phase adds under a new path (e.g. a new mobile-app module or a
#    separate RealGram project — see ARCHITECTURE.md §3 for which).
git diff origin/main --stat   # review the file list — should match what
                               # AGENT_HANDOFF.md's "Work done" log says
```

## Secrets / environment variables required (names only — never commit values)

**iOS TestFlight CI** (`mobile-app/.github/workflows/ios-testflight.yml`,
documented in that file's own header comment):

| Secret | Purpose |
|---|---|
| `ASC_KEY_ID` | App Store Connect API Key ID |
| `ASC_ISSUER_ID` | App Store Connect Issuer ID |
| `ASC_PRIVATE_KEY` | Full contents of the `AuthKey_XXXX.p8` file |
| `APPLE_TEAM_ID` | 10-character Apple Team ID |
| `DISTRIBUTION_CERT_P12_BASE64` (optional, after first bootstrap run) | Base64 of the exported distribution cert |
| `DISTRIBUTION_CERT_PASSWORD` (optional) | Password for that P12 |

**CLI/admin product** (repo root, separate from the mobile app): server-side
config lives in `/etc/setalink/setalink.env` **on the VPN host itself**, not
in this repo — see root `README.md`'s "Storage layout" section for the full
list of keys it holds (host, ports, SNI, REALITY keypair, toggles). Never
copy that file's contents into this repo or into any doc.

**Mobile app runtime config:** no `.env` file or `process.env` usage was
found via static search of `mobile-app/` during this session. If RealGram
work introduces new runtime config (e.g. an AdsGram block ID, a RealGram
backend URL), document the **variable name and purpose** here — never the
value — following the same pattern as the table above.

**Backend systemd services** (Shahnameh — a separate repo/project, see
`docs/realgram/INTEGRATION_MAP.md` §1): `shahnameh-backend.service` and
`shahnameh-bot.service` load their config via `Environment=` directives and
an `EnvironmentFile=`, respectively, in their systemd unit files. **Do not
print or copy these unit files' contents into any doc or commit** — if a
future agent needs to know a specific variable name from them, name the
variable only, the way this document does above.

## Next agent — do this first

1. Confirm push status (see blocker above) and resolve it if you have the
   access to do so, or escalate to the user if you don't.
2. Read `IMPLEMENTATION_PLAN.md` in full.
3. **Do not start the technical spike or any implementation** — per
   `DECISIONS.md`'s 2026-07-10 entry, that requires explicit user approval
   which had not been given as of this handoff.
4. If the user has since approved proceeding (check for a newer entry in
   `DECISIONS.md` than the ones listed as of this handoff, or ask them
   directly if this doc is stale), start with Path B0 validation and the
   spike, in parallel, per `IMPLEMENTATION_PLAN.md`'s recommendation.

## Update protocol — do this at the end of every meaningful step

- Update `PROJECT_STATUS.md` (root) if the overall state summary changed.
- Update this file's "Current state" section.
- Record completed tasks, the exact next action, files changed, tests run
  (and their results), and any production impact (should always be "none"
  outside an explicitly-approved deployment step).
- Commit with a clear message.
- Push — and if push fails, **update the "Push blocker" section with what
  you tried and what's still needed**, don't leave it silently stale.

**Do not leave uncommitted important work.** Do not commit secrets,
credentials, tokens, keystores, certificates, provisioning profiles,
generated builds, or large binaries. Use Git LFS only if a large *source*
asset is genuinely required; prefer not to store large optional assets
(Shahnameh media, reaction packs) in this repository at all — see
`BUILD_SIZE_BUDGET.md` §4 on remote/on-demand delivery.
