# RealGram AI Workspace — setup

Isolated contest prototype at `apps/realgram-ai-workspace/`. Two independent
npm packages — a Vite/React/TypeScript SPA (`src/`) and a small Express demo
backend (`server/`) — neither touches production RealGram (`public/*.php`,
`mobile-app/`, `calling-relay/`, `admin/`).

## Requirements

- Node 18+ (developed and tested on Node 18.19.1)
- No database, no external services required for the default (mock) mode

## Install

```bash
cd apps/realgram-ai-workspace
npm install
cd server && npm install && cd ..
```

## Run in development

Two processes, two terminals:

```bash
# terminal 1 — demo backend on :4181
cd apps/realgram-ai-workspace/server
npm run dev

# terminal 2 — SPA on :4180 (proxies /api to :4181, see vite.config.ts)
cd apps/realgram-ai-workspace
npm run dev
```

Open **http://localhost:4180**. No login, no API keys needed — the
generation adapter defaults to a local mock (see
`server/src/adapters/mockAdapter.ts`), so the guided demo works completely
offline.

## Environment variables

Copy `.env.example` to `.env` (or export directly) — see that file for the
full, commented list. The only variable that changes behavior in the
common case is:

```bash
GENERATION_ADAPTER=mock       # default — no credentials needed, never blocks on OAuth
GENERATION_ADAPTER=higgsfield # requires HIGGSFIELD_API_KEY + HIGGSFIELD_API_SECRET
```

### Switching to the real Higgsfield adapter

1. Obtain `HIGGSFIELD_API_KEY` / `HIGGSFIELD_API_SECRET` from your
   Higgsfield account (`platform.higgsfield.ai`) — **not** the `claude mcp
   add higgsfield` OAuth flow; that connects Claude Code itself to the
   Higgsfield MCP server for interactive use in this session, which is a
   different integration path from the server-side REST credentials this
   app needs. See `docs/HIGGSFIELD_VISUAL_PIPELINE.md` on the
   shahnameh-backend repo for how those credentials were originally
   obtained for the sibling Shahnameh visual-pipeline project.
2. Set `GENERATION_ADAPTER=higgsfield`, `HIGGSFIELD_API_KEY=...`,
   `HIGGSFIELD_API_SECRET=...` in the server's environment.
3. Restart the server. `GET /api/health` will report
   `{"provider":"higgsfield"}` once it picks up the real adapter.
4. Image generation (`generateImage` / `getGenerationStatus`) is verified
   against the real Higgsfield API. Video generation and character/Soul-ID
   creation are **not** — they return `501 Not Implemented` with an
   explanatory message rather than guessing an unverified request shape
   (see `server/src/adapters/higgsfieldAdapter.ts`).
5. If the account has no generation credits, image requests will queue
   successfully and then fail with Higgsfield's own `not_enough_credits`
   error — this is a Higgsfield-account state, not a bug in this adapter.

No code changes are needed to swap adapters — see
`server/src/adapters/index.ts`.

## Tests, lint, typecheck, build

Run from each package directory:

```bash
# frontend (apps/realgram-ai-workspace/)
npm run typecheck   # tsc -b --noEmit
npm run lint         # eslint . --ext ts,tsx --max-warnings 0
npm run test          # vitest run
npm run build         # tsc -b && vite build -> dist/

# backend (apps/realgram-ai-workspace/server/)
npm run typecheck
npm run lint
npm run test
npm run build          # tsc -> dist/
npm start                # node dist/index.js
```

All four (typecheck, lint, test, build) pass in both packages as of this
writing, using only the mock adapter (no Higgsfield credentials in this
environment).

## Production preview

```bash
cd apps/realgram-ai-workspace
npm run build
npm run preview   # serves dist/ on :4173

# separately, the built server:
cd server && npm run build && npm start   # :4181
```

`vite preview` does not proxy `/api` the way the dev server does — when
serving the built SPA and the built server on separate ports/hosts, set
`VITE_API_BASE_URL` (see `.env.example`) before building the SPA so its
fetch calls target the server directly.
