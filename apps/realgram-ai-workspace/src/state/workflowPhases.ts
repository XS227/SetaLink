import type { DemoScene } from "../types/api";

/**
 * Groups the guided demo's 9 granular scene keys (server/src/demo/script.ts)
 * into the 6 conceptual phases its own comment already names: "call ->
 * share -> AI analyzes -> AI summarizes -> AI creates -> export." Shared by
 * the desktop WorkflowStepper and the mobile stepper so the two can never
 * drift into describing the meeting's progress differently.
 */
export interface WorkflowPhase {
  label: string;
  detail: string;
  sceneKeys: readonly string[];
}

export const WORKFLOW_PHASES: readonly WorkflowPhase[] = [
  { label: "Join", detail: "Enter the meeting.", sceneKeys: ["join"] },
  { label: "Share", detail: "Share your screen with the room.", sceneKeys: ["share"] },
  { label: "Analyze", detail: "Real AI reads what's on screen.", sceneKeys: ["surface"] },
  { label: "Summarize", detail: "Real AI writes the recap — decisions, action items.", sceneKeys: ["summary"] },
  { label: "Create", detail: "Ask Real AI to generate a launch visual.", sceneKeys: ["ask", "generate", "progress", "result"] },
  { label: "Export", detail: "Download the Meeting Intelligence Pack.", sceneKeys: ["export"] },
];

export function getActivePhaseIndex(scenes: DemoScene[], sceneIndex: number): number {
  const currentSceneKey = scenes[sceneIndex]?.key ?? "";
  const index = WORKFLOW_PHASES.findIndex((phase) => phase.sceneKeys.includes(currentSceneKey));
  return Math.max(0, index);
}
