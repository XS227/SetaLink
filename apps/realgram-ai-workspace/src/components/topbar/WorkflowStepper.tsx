import { useWorkspace } from "../../state/workspaceStore";

/**
 * Groups the guided demo's 9 granular scene keys (server/src/demo/script.ts)
 * into the 6 conceptual phases the product workflow comment there already
 * names: "call -> share -> AI analyzes -> AI summarizes -> AI creates ->
 * export." A top-bar stepper at scene-granularity would be too busy; this
 * is the same progression, one level up.
 */
const PHASES = [
  { label: "Join", sceneKeys: ["join"] },
  { label: "Share", sceneKeys: ["share"] },
  { label: "Analyze", sceneKeys: ["surface"] },
  { label: "Summarize", sceneKeys: ["summary"] },
  { label: "Create", sceneKeys: ["ask", "generate", "progress", "result"] },
  { label: "Export", sceneKeys: ["export"] },
] as const;

export function WorkflowStepper() {
  const { state } = useWorkspace();
  const currentSceneKey = state.scenes[state.sceneIndex]?.key;
  const activeIndex = Math.max(
    0,
    PHASES.findIndex((phase) => (phase.sceneKeys as readonly string[]).includes(currentSceneKey ?? "")),
  );

  return (
    <ol className="workflow-stepper" aria-label="Meeting workflow">
      {PHASES.map((phase, index) => {
        const status = index < activeIndex ? "done" : index === activeIndex ? "active" : "upcoming";
        return (
          <li key={phase.label} className={`workflow-stepper__step workflow-stepper__step--${status}`}>
            <span className="workflow-stepper__dot" aria-hidden />
            <span className="workflow-stepper__label">{phase.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
