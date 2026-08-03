import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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
  const reduceMotion = useReducedMotion();
  const activeIndex = getActivePhaseIndex(state.scenes, state.sceneIndex);
  const activePhase = WORKFLOW_PHASES[activeIndex];

  return (
    <section className="mobile-stepper glass" aria-label="Meeting workflow">
      <motion.button
        type="button"
        className="mobile-stepper__summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        whileTap={{ scale: 0.99 }}
      >
        <div className="mobile-stepper__current">
          <span className="mobile-stepper__eyebrow">
            Step {activeIndex + 1} of {WORKFLOW_PHASES.length}
          </span>
          <span className="mobile-stepper__label-frame">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={activePhase.label}
                className="mobile-stepper__label"
                initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                {activePhase.label}
              </motion.span>
            </AnimatePresence>
          </span>
        </div>
        <ol className="mobile-stepper__dots" aria-hidden>
          {WORKFLOW_PHASES.map((phase, index) => (
            <motion.li
              key={phase.label}
              className={`mobile-stepper__dot ${
                index < activeIndex ? "mobile-stepper__dot--done" : index === activeIndex ? "mobile-stepper__dot--active" : ""
              }`}
              animate={index === activeIndex ? { scale: [1, 1.35, 1] } : { scale: 1 }}
              transition={{ duration: 0.5 }}
            />
          ))}
        </ol>
        <motion.span
          className="mobile-stepper__chevron"
          aria-hidden
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.25 }}
        >
          ▾
        </motion.span>
      </motion.button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="mobile-stepper__detail-frame"
            initial={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: "hidden" }}
          >
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
                  <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={pause}>
                    Pause guided demo
                  </motion.button>
                ) : (
                  <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={play} className="mobile-stepper__demo-play">
                    {activeIndex === 0 ? "Play guided demo" : "Resume guided demo"}
                  </motion.button>
                )}
                <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={restart} disabled={demoPlaying}>
                  Restart
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
