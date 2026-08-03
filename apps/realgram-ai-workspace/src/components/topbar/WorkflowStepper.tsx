import { useWorkspace } from "../../state/workspaceStore";
import { WORKFLOW_PHASES, getActivePhaseIndex } from "../../state/workflowPhases";

export function WorkflowStepper() {
  const { state } = useWorkspace();
  const activeIndex = getActivePhaseIndex(state.scenes, state.sceneIndex);

  return (
    <ol className="workflow-stepper" aria-label="Meeting workflow">
      {WORKFLOW_PHASES.map((phase, index) => {
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
