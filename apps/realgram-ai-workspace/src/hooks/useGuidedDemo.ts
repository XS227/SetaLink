import { useCallback, useRef } from "react";
import { useWorkspace, useWorkspaceActions } from "../state/workspaceStore";
import { api } from "../services/api";
import { pollGenerationJob } from "../services/pollGeneration";
import type { GenerationJob } from "../types/api";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives the guided demo (brief's Scene 1 .. Scene 9) end to end without
 * requiring a second real participant. Each scene performs one real side
 * effect against the demo backend (ask, generate, poll, summarize) so the
 * "guided demo" is actually exercising the same code path a manual user
 * would hit, not a separately-maintained fake. Two scenes also trigger the
 * signature "AI points at the screen" annotation — see AnnotationLayer.
 *
 * `lastJobIdRef` carries the generation job id from Scene 5 ("generate")
 * to Scene 6 ("progress") without reading it back out of `state`. Reading
 * from `state.generationJobs` here would be stale: `play()`'s while loop
 * runs inside one long-lived async closure captured at click time, and
 * doesn't pick up newer re-renders of `state` as the demo progresses.
 */
export function useGuidedDemo() {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const stopRequested = useRef(false);
  const lastJobRef = useRef<GenerationJob | null>(null);

  const runScene = useCallback(
    async (index: number) => {
      const scene = state.scenes[index];
      if (!scene) return;

      switch (scene.key) {
        case "join":
          actions.revealNextTranscriptLine();
          await delay(1600);
          break;
        case "share":
          actions.setScreenShare("simulated");
          actions.revealNextTranscriptLine();
          await delay(1600);
          break;
        case "surface":
          actions.revealNextTranscriptLine();
          await delay(900);
          actions.showAnnotation({
            xPercent: 50,
            yPercent: 30,
            label: "Team adoption is trending up — 67% and climbing. Worth calling out in the recap.",
          });
          actions.addNotice("Noticed team adoption is trending up (67%) — pointed it out on screen.");
          await delay(1600);
          break;
        case "ask": {
          actions.revealNextTranscriptLine();
          actions.revealNextTranscriptLine();
          actions.setAssistantActivity("thinking");
          const { answer } = await api.askRealAi(state.askRealAiPrompt);
          actions.addAsk(state.askRealAiPrompt, answer);
          await delay(1200);
          break;
        }
        case "generate": {
          actions.setAssistantActivity("thinking");
          const job = await api.generateImage(state.askRealAiPrompt);
          lastJobRef.current = job;
          actions.addGenerationJob(job);
          await delay(800);
          break;
        }
        case "progress": {
          if (lastJobRef.current) {
            const finalJob = await pollGenerationJob(lastJobRef.current.id, (job) => {
              lastJobRef.current = job;
              actions.updateGenerationJob(job);
            }).catch(() => null);
            if (finalJob) lastJobRef.current = finalJob;
          }
          break;
        }
        case "result": {
          const job = lastJobRef.current;
          if (job?.status === "completed" && job.resultUrl) {
            actions.showAnnotation({
              xPercent: 50,
              yPercent: 14,
              label: "Your on-brand launch visual is ready.",
              imageUrl: job.resultUrl,
            });
            actions.addNotice("Generated a launch visual on-brand with RealGram — ready above.");
          } else {
            actions.setAssistantActivity("idle");
          }
          await delay(2200);
          break;
        }
        case "summary": {
          actions.setAssistantActivity("thinking");
          const { summary, decisions, actionItems } = await api.meetingSummary();
          actions.setSummary(summary, decisions, actionItems);
          actions.setAssistantActivity("idle");
          await delay(1500);
          break;
        }
        case "export":
          // Terminal scene — the user exports manually from the project rail.
          break;
      }
    },
    [state.scenes, state.askRealAiPrompt, actions],
  );

  const play = useCallback(async () => {
    if (!state.aiConsent) {
      actions.grantAiConsent();
    }
    stopRequested.current = false;
    actions.setDemoPlaying(true);

    let index = state.sceneIndex;
    while (index < state.scenes.length && !stopRequested.current) {
      actions.setSceneIndex(index);
      // eslint-disable-next-line no-await-in-loop
      await runScene(index);
      index += 1;
    }
    actions.setSceneIndex(Math.min(index, state.scenes.length - 1));
    actions.setDemoPlaying(false);
    actions.setAssistantActivity("idle");
  }, [state.aiConsent, state.sceneIndex, state.scenes.length, actions, runScene]);

  const pause = useCallback(() => {
    stopRequested.current = true;
    actions.setDemoPlaying(false);
  }, [actions]);

  const restart = useCallback(() => {
    stopRequested.current = true;
    lastJobRef.current = null;
    actions.setSceneIndex(0);
    actions.setScreenShare("off");
    actions.clearAnnotation();
  }, [actions]);

  return { play, pause, restart, sceneIndex: state.sceneIndex, demoPlaying: state.demoPlaying, scenes: state.scenes };
}
