import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";

/** Where the comet enters from — approximates the orb's position in the
 * floating assistant pane, so the marker reads as "the AI left its panel." */
const ORIGIN = { x: "94%", y: "9%" };
const AUTO_DISMISS_MS = 7000;

export function AnnotationLayer() {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const reduceMotion = useReducedMotion();
  const annotation = state.activeAnnotation;

  useEffect(() => {
    if (!annotation) return;
    const timer = setTimeout(() => {
      actions.clearAnnotation();
      actions.setAssistantActivity("idle");
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotation?.id]);

  if (!annotation) return null;

  const targetX = `${annotation.xPercent}%`;
  const targetY = `${annotation.yPercent}%`;
  const labelOnLeft = annotation.xPercent > 55;
  const labelAbove = annotation.yPercent > 55;

  return (
    <div className="annotation-layer" aria-live="polite">
      <AnimatePresence>
        <motion.div
          key={annotation.id}
          className="annotation-comet"
          initial={reduceMotion ? { left: targetX, top: targetY, opacity: 0 } : { left: ORIGIN.x, top: ORIGIN.y, opacity: 1, scale: 1.2 }}
          animate={{ left: targetX, top: targetY, opacity: 0, scale: 0.4 }}
          transition={{ duration: reduceMotion ? 0.2 : 0.85, ease: [0.16, 1, 0.3, 1] }}
        />
      </AnimatePresence>

      <motion.div
        key={`marker-${annotation.id}`}
        className="annotation-marker"
        style={{ left: targetX, top: targetY }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: reduceMotion ? 0 : 0.75, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <span className="annotation-marker__ring" />
        <span className="annotation-marker__dot" />
      </motion.div>

      <motion.div
        key={`label-${annotation.id}`}
        className={`annotation-label ${labelOnLeft ? "annotation-label--left" : "annotation-label--right"} ${
          labelAbove ? "annotation-label--above" : "annotation-label--below"
        }`}
        style={{ left: targetX, top: targetY }}
        initial={{ opacity: 0, scale: 0.9, y: labelAbove ? 6 : -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: reduceMotion ? 0.1 : 0.9, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {annotation.imageUrl ? (
          <img src={annotation.imageUrl} alt="" className="annotation-label__thumb" aria-hidden />
        ) : (
          <span className="annotation-label__glyph" aria-hidden>
            ⟡
          </span>
        )}
        <span>{annotation.label}</span>
      </motion.div>
    </div>
  );
}
