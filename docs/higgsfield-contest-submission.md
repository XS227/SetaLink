# Higgsfield $100K App Contest — submission

## App name

**RealGram AI Workspace**

## One-line pitch

One call. One workspace. One AI — RealGram turns a shared screen into a
meeting that writes its own notes, translates itself, and designs its own
launch visual.

## Problem

Product reviews and cross-timezone meetings generate three kinds of loss:
decisions nobody wrote down, language barriers between English/Norwegian/
Persian-speaking teammates, and a gap between "we agreed on a visual" and
someone actually producing one. Today that means a second app for notes, a
third for translation, and a fourth (days later) for the actual asset.

## Solution

RealGram AI Workspace puts all of it in the meeting itself — and rebuilds
what "the AI in a meeting" looks like along the way. The shared screen is
the center of the experience, a floating window taking up most of the
canvas, the way a real presentation would. Real AI isn't a chat sidebar
bolted onto that: it's a living presence in its own glass pane, with a
breathing orb avatar that visibly leaves its pane and points at the exact
thing it's talking about on the shared screen, with a glowing tether and
callout card — not a text log claiming to have "seen" something. Share your
screen, ask Real AI a question in plain language, watch it generate a
launch visual and point it out where it landed, and at the end export a
Meeting Intelligence Pack: summary, decisions, action items, translated
captions, and the generated asset, together.

## Why RealGram is different

RealGram already ships real video calling (`react-native-webrtc`), real
messaging, and a real brand system — this isn't a concept mockup wrapped
around a video-call widget. The prototype reuses RealGram's actual purple
logo mark (`brand/`) untouched, and treats gold as something to *spend*
rather than paint everywhere: it's reserved entirely for the AI's own
presence (the orb, its tether, its active state) so that when something
turns gold, it means "the AI is here," not "this is a premium button."
Everything else stays a quiet, layered near-black glass. And the generation
layer is built as a real abstraction, not a demo-only shortcut — see
"Technical architecture" below.

**The signature interaction**: when Real AI has something to say about
what's on screen, it doesn't post a message — it detaches from its pane,
travels to the exact point on the shared screen, and marks it with a
pulsing ring and a connected callout, before returning. This happens twice
in the guided demo: once calling out a rising adoption metric, once showing
off the freshly generated launch visual with a thumbnail pinned directly to
the stage. See `docs/higgsfield-demo-script.md`, Scenes 3 and 7.

## How Higgsfield is used

Image generation flows through a `GenerationAdapter` interface
(`generateImage`, `generateVideo`, `createCharacter`, `getGenerationStatus`,
`listCharacters` — matching the Higgsfield MCP tool surface named in the
brief) with two implementations:

- **Mock** (default, always available): deterministic, time-derived
  queued → processing → completed states and a clearly-labeled placeholder
  image — so the full demo works with zero setup and zero external calls.
- **Higgsfield REST** (`server/src/adapters/higgsfieldAdapter.ts`): the
  real `https://platform.higgsfield.ai/higgsfield-ai/soul/<mode>` contract,
  reverse-engineered against the live API (no official public docs exist)
  during a sibling project's visual-pipeline work, and re-verified here.
  Image generation and status polling are real; video generation and
  character/Soul-ID creation are not — they were never confirmed against a
  real endpoint, so they fail loudly with a clear message instead of
  guessing a request shape.

Swapping providers is one environment variable
(`GENERATION_ADAPTER=higgsfield` + credentials) — no route or UI code
changes. See "Remaining limitations" for the current account-auth state.

## Main user journey

Enter the meeting → share your screen (the stage) → wake Real AI, which
starts as a dormant orb until every participant consents → watch it point
out a live insight on the shared screen → ask it for a launch visual → see
it point at the finished result the moment it lands → get an AI-written
summary with decisions and action items, with captions available in
English, Norwegian, and Persian → export the whole thing as a Meeting
Intelligence Pack.

## Technical architecture

- **Frontend**: React 18 + TypeScript + Vite SPA (`apps/realgram-ai-workspace/src`).
  A single `useReducer`-backed workspace store (no external state library);
  `framer-motion` for the orb/annotation motion system; real browser screen
  sharing via `navigator.mediaDevices.getDisplayMedia()`. Layout: a
  collapsible left rail (meeting control, files, tasks), a full-bleed stage
  window (center), a floating assistant pane (right), and a floating
  participant dock (bottom) — see `src/App.tsx` and
  `src/components/{stage,assistant,dock,rail}`.
- **Backend**: a small, independent Express + TypeScript service
  (`apps/realgram-ai-workspace/server`) that hosts the `GenerationAdapter`
  abstraction and the scripted AI/demo endpoints. It never touches
  RealGram's production PHP+SQLite backend, device-ID auth, or any
  production route — see `docs/higgsfield-contest-audit.md` for the full
  isolation rationale.
- **Generation keys never reach the browser** — the SPA only ever calls its
  own `/api/generation/*` routes; the adapter (and any Higgsfield
  credentials) live server-side only.
- **Tests**: Vitest + Supertest on the server (10 tests: adapter contract,
  full queued→completed lifecycle, 501s on unimplemented Higgsfield paths);
  Vitest + Testing Library on the frontend (5 tests, including one that
  drives the entire 9-scene guided demo through real component code and
  real polling — including asserting the AI's on-screen annotation actually
  appears — not a scripted mock of the UI itself).

## Privacy and consent

Real AI starts **dormant** — a sleeping, uncolored orb — until a
participant clicks **"Wake Real AI."** The wake screen states outright:
*"AI analysis starts only after everyone consents."* Once active, the orb's
status ("Listening," "Watching your screen," "Thinking…") is visible at all
times, with one-click **Stop AI analysis** and **Delete session data**
controls in the pane header. The in-app copy is specific about where data
actually goes:
meeting "analysis" (transcript, translation, summary) is simulated locally
in this prototype — nothing is sent to a third-party LLM API; only
generation requests leave the server, and only to the configured
generation adapter. The exported Meeting Intelligence Pack is built and
downloaded entirely client-side.

## Demo instructions

See `docs/higgsfield-contest-setup.md` for install/run commands and
`docs/higgsfield-demo-script.md` for the full scene-by-scene walkthrough.
Short version:

```bash
cd apps/realgram-ai-workspace/server && npm install && npm run dev   # :4181
cd apps/realgram-ai-workspace && npm install && npm run dev          # :4180
```

Open `http://localhost:4180`, click **Play guided demo**.

## Suggested Higgsfield listing description

RealGram AI Workspace turns any RealGram video call into a working session:
share your screen, ask Real AI for a launch visual, and watch it generate
live — alongside real-time meeting notes, decisions, action items, and
multilingual captions (English, Norwegian, Persian). One export button
turns the whole meeting into a shareable Meeting Intelligence Pack.

## Suggested social post

Shared a screen. Asked Real AI for a launch visual. Got it — mid-call, with
the meeting notes, decisions, and translated captions already written.
That's RealGram AI Workspace. #HiggsfieldApp

## Remaining limitations

- **Higgsfield account auth is not complete in this environment.** The
  Higgsfield MCP server (`mcp__higgsfield__*`) is available as a tool but
  requires an interactive OAuth flow this session did not run, per explicit
  instruction not to block on it. The REST adapter is real and ready
  (`server/src/adapters/higgsfieldAdapter.ts`), but has not been exercised
  against a funded account from *this* prototype — a sibling project's
  credentials were previously verified reaching Higgsfield's real queue and
  stopping at `not_enough_credits`, which is the expected failure mode once
  real credentials are supplied here too.
- **Video generation and character/Soul-ID creation are not implemented**
  against the real Higgsfield API — no endpoint for either was ever
  verified, so the real adapter fails loudly (`501`) rather than guessing.
  The mock adapter implements all five methods for demo purposes.
- **The AI copilot (Ask Real AI, transcript, summary) is scripted, not a
  live LLM.** This is disclosed in-product. Wiring it to a real model is
  the natural next step and does not require changing the generation
  adapter abstraction.
- **Real screen sharing and the guided demo's simulated screen share are
  two separate code paths** (by design, so the guided demo needs no OS
  permission prompt) — a live conference would use only the real path.
- **No automated visual/screenshot testing was run in this environment**
  (no usable headless browser was available); verification here is
  component-level (Testing Library + jsdom) and live HTTP smoke-testing
  against the real running server, not a rendered-pixel screenshot.
- **No production build has been deployed anywhere** — `npm run build`
  succeeds and `dist/` is ready, but hosting/deploy is a separate step not
  taken in this session.
- **The floating-panes composition is desktop-first**, matching the
  brief's own "desktop-first meeting workspace" direction. A ~980px
  breakpoint switches to a stacked, scrollable layout so nothing is
  unusable on a smaller screen, but it hasn't been visually tuned the way
  the desktop experience has.
