# RealGram AI Workspace — guided demo script

**Design pass (v2):** the workspace was rebuilt around one idea — the shared
screen is the room, and the AI is a presence in it, not a chatbot bolted to
the side. The stage (shared screen) fills the canvas as a floating window;
a living assistant pane floats beside it with a breathing orb avatar; when
the AI has something to say about what's on screen, it visibly "leaves" its
pane and points at the exact spot with a glowing tether and callout — see
`docs/higgsfield-contest-audit.md`'s successor design notes in
`apps/realgram-ai-workspace/src/components/stage/AnnotationLayer.tsx`.

The guided demo (left rail → "Play guided demo") runs all nine
brief-specified scenes end to end with **zero** second participant, zero
manual setup, and zero external credentials. Each scene performs a real
call against the local demo backend; see `src/hooks/useGuidedDemo.ts`.

| # | Scene | What happens | Real vs. simulated |
|---|-------|--------------|---------------------|
| 1 | Enter the meeting | Joins "RealGram Global Product Review"; the stage shows the meeting name until sharing starts | Participants/meeting are scripted demo data (`server/src/demo/script.ts`) |
| 2 | Share your screen | `screenShare` state flips to `simulated`; the stage window shows a "Presenting your screen" badge | Simulated — the *separate*, always-available Share screen dock control uses the real `getDisplayMedia()` API instead, any time, demo or not |
| 3 | Shared product interface | A mock RealGram analytics dashboard renders inside the stage window. **The AI orb detaches from its pane and points at the "Team adoption" stat with a glowing tether and callout** | Simulated UI, clearly labeled "Simulated" on-screen. The pointing interaction is real code (`AnnotationLayer.tsx`), not a canned video |
| 4 | Ask Real AI | Sends "Create a launch visual for this feature using the RealGram brand." to `POST /api/ai/ask`; appears as a chat bubble in the assistant's thought feed | Real HTTP call; scripted response text (`server/src/demo/aiMock.ts`) — this is not a live LLM, and the assistant says so before it wakes |
| 5 | Generation starts | `POST /api/generation/image` through the **GenerationAdapter abstraction**; orb status reads "Thinking…" | Real call, real adapter interface. Provider is the mock adapter unless the server is explicitly configured with `GENERATION_ADAPTER=higgsfield` + real credentials |
| 6 | Generation in progress | Polls `GET /api/generation/:id` every ~700ms; the file appears "queued → processing → completed" in the left rail's Files section | Real polling loop against real job state (time-derived in the mock adapter, not faked with a hardcoded delay) |
| 7 | Result appears | **The AI points at the stage again — this time the callout carries a thumbnail of the finished visual** ("Your on-brand launch visual is ready") | Mock adapter: a labeled placeholder SVG (never pretends to be a real Higgsfield render). Higgsfield adapter: the actual returned image URL |
| 8 | Meeting intelligence | `GET /api/ai/summary` returns a summary + 3 decisions + 3 action items, shown in the left rail's Tasks section | Real call; scripted content, not a live LLM |
| 9 | Export the pack | "Export Meeting Intelligence Pack" (Tasks section) downloads a JSON + Markdown bundle | 100% client-side (`src/services/exportPack.ts`) — built from browser state, no server round-trip |

## Manual walkthrough (no auto-play)

Every scene's action is also reachable by hand:

1. Load `http://localhost:4180` — the stage shows the meeting name, waiting to share.
2. Click **Wake Real AI** in the assistant pane's consent state (required before anything below works).
3. Click **Share screen** in the bottom dock for a *real* browser screen-share prompt, or use the guided demo's simulated version instead.
4. Type a prompt containing a generation keyword (e.g. "Create a launch visual…") into the assistant's command bar at the bottom of its pane — this triggers the same `generateImage` → poll → Files-section flow as Scene 5-7.
5. Open the left rail's **Tasks** section and click **Generate decisions & action items**.
6. Click **Export Meeting Intelligence Pack**.

## What's local, simulated, or sent to an API

Stated in-app in the assistant's consent state, repeated here for the
submission document: meeting "analysis" (transcript, translation, summary,
Ask Real AI answers) is scripted/simulated locally — nothing goes to a
third-party LLM API in this prototype. Image/video generation goes through
the `GenerationAdapter` abstraction — a local mock by default, or the real
Higgsfield REST API only if the server is explicitly configured with
credentials. The exported Meeting Intelligence Pack is built and downloaded
entirely client-side.
