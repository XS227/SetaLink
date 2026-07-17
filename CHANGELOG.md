# Changelog

## v0.9.62 (build 89) — 2026-07-17

Prepared for controlled Iran tester rollout. Feature-flagged where the
underlying capability is new/unproven (Adaptive Routing stays OFF by
default per Rule 7 — see `docs/CLAUDE_REALINK_RULES.md`); everything else
here is live and stable.

- **Starlink node support** — nodes flow through the existing
  `GET /v1/servers` catalog automatically; no client-side special-casing
  needed. New: a clear "🛰 Starlink" badge on the home screen while
  actually connected through one (was previously only visible in the
  server picker list, never on the main connected screen).
  See `docs/NODE_INTELLIGENCE_ARCHITECTURE.md`.
- **Adaptive Routing groundwork** — Node Genome (per-node capability
  profiles), Telemetry Trust Engine, and the Evolution Layer (routing
  weights that learn from real connect/disconnect outcomes, not
  hand-tuned constants) are built and smoke-tested server-side. Feature
  flag `adaptive_routing_enabled` stays OFF — this ships the
  infrastructure, not a live behavior change for this build.
- **Network Intelligence improvements** — Node Console (Phase 1): a
  generic, node-type-agnostic remote command system for gateway nodes
  (WireGuard status, network status, log tail, restart) with signed
  short-lived tokens, no SSH/RDP exposed. Every command execution and
  every watchdog self-heal now feeds the Genome's stability scoring.
  See `docs/NODE_CONSOLE_ARCHITECTURE.md`.
- **Instagram diagnostics** — a real tester reported Instagram
  occasionally failing to open. An audit of every routing path found no
  bypass rule catching it (Instagram was never, and is not now, in any
  Smart Mode / split-tunnel bypass list). Rather than guess at a fix,
  this build adds per-leg (TCP vs. QUIC) failure telemetry — DNS/TLS/
  timeout/connection categorized automatically, plus which network path
  the traffic actually took — so the next real usage collects the
  evidence needed to find the actual cause. **No routing behavior
  changed.**
- **Improved Split Tunnel stability** — no bypass-rule changes this
  build (existing Iranian banking/Digikala/Snapp coverage already
  comprehensive); this line covers the Instagram investigation above
  confirming no regression exists, plus the underlying telemetry/Genome
  work that Adaptive Routing (when enabled) will use to make split-tunnel
  and server-selection decisions smarter over time.
- **Node telemetry improvements** — Tap-to-Learn contributions are now
  weighted by measurement quality (a device with a track record of
  plausible, trustworthy reports earns more per tap than a new or
  previously-flagged one) instead of a flat reward. Fixed a data-quality
  bug where long verdict strings (`QUIC_BLACKHOLE_LIKELY`) were being
  silently truncated in storage.
- **Storage cleanup improvements** — automatic cleanup for diagnostic-log
  uploads and old APK builds, with a 20-30% free-disk floor that
  escalates cleanup automatically if approached. See
  `docs/STORAGE_MANAGEMENT.md`.
- **Profile / referral improvements** — carried forward from prior
  builds (REAL wallet card, TrustAI account linking, referral reward
  modes) — already stable, included as-is.
- **Internal infrastructure improvements** — Linux gateway (Raspberry Pi)
  brought to parity with the hardened Windows gateway scripts and
  promoted to the primary Starlink gateway path; a real CSRF gap in the
  admin API (three state-changing actions reachable only via an
  unprotected GET request) found and fixed; version-drift bug fixed
  (`package.json` and `build.gradle` had drifted to different version
  numbers).

### Known non-changes
- Clan support: deliberately not included — doesn't exist in the
  codebase yet, deferred to its own dedicated build.
- Windows Starlink gateway: an isolated, unresolved Windows ICS bug
  (`EnableSharing` 0x80040201) keeps that specific gateway on
  controlled-internal-testing-only status; not a blocker for this
  release since the Linux gateway is now the primary path.
