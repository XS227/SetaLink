import { useState } from "react";
import { useWorkspace } from "../../state/workspaceStore";
import { WORKFLOW_PHASES, getActivePhaseIndex } from "../../state/workflowPhases";
import { useGuidedDemo } from "../../hooks/useGuidedDemo";

/**
 * Mobile's answer to the desktop top bar's six-dot horizontal stepper: one
 * readable current-step label plus a compact dot row always visible, and
 * the full phase-by-phase breakdown (plus the guided-demo transport
 * controls) tucked behind a tap-to-expand disclosure so it never competes
 * with the generated visual for space.
 */
export function MobileStepper() {
  const { state } = useWorkspace();
  const { play, pause, restart, demoPlaying } = useGuidedDemo();
  const [expanded, setExpanded] = useState(false);
  const activeIndex = getActivePhaseIndex(state.scenes, state.sceneIndex);
  const activePhase = WORKFLOW_PHASES[activeIndex];

  return (
    <section className="mobile-stepper glass" aria-label="Meeting workflow">
      <button
        type="button"
        className="mobile-stepper__summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="mobile-stepper__current">
          <span className="mobile-stepper__eyebrow">Step {activeIndex + 1} of {WORKFLOW_PHASES.length}</span>
          <span className="mobile-stepper__label">{activePhase.label}</span>
        </div>
        <ol className="mobile-stepper__dots" aria-hidden>
          {WORKFLOW_PHASES.map((phase, index) => (
            <li
              key={phase.label}
              className={`mobile-stepper__dot ${
                index < activeIndex ? "mobile-stepper__dot--done" : index === activeIndex ? "mobile-stepper__dot--active" : ""
              }`}
            />
          ))}
        </ol>
        <span className="mobile-stepper__chevron" aria-hidden>
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="mobile-stepper__detail">
          <ol className="mobile-stepper__phase-list">
            {WORKFLOW_PHASES.map((phase, index) => (
              <li
                key={phase.label}
                className={`mobile-stepper__phase ${index === activeIndex ? "mobile-stepper__phase--active" : ""}`}
              >
                <span className="mobile-stepper__phase-label">{phase.label}</span>
                <span className="mobile-stepper__phase-detail">{phase.detail}</span>
              </li>
            ))}
          </ol>
          <div className="mobile-stepper__demo-controls">
            {demoPlaying ? (
              <button type="button" onClick={pause}>
                Pause guided demo
              </button>
            ) : (
              <button type="button" onClick={play} className="mobile-stepper__demo-play">
                {activeIndex === 0 ? "Play guided demo" : "Resume guided demo"}
              </button>
            )}
            <button type="button" onClick={restart} disabled={demoPlaying}>
              Restart
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
