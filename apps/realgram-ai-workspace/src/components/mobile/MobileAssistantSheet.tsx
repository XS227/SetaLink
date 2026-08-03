import { motion, AnimatePresence, useDragControls, useReducedMotion } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { api } from "../../services/api";
import { AssistantOrb } from "../assistant/AssistantOrb";
import { ConsentOverlay } from "../assistant/ConsentOverlay";
import { LiveTicker } from "../assistant/LiveTicker";
import { ThoughtFeed } from "../assistant/ThoughtFeed";
import { CommandBar } from "../assistant/CommandBar";
import { triggerHaptic } from "../../services/haptics";

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 500;

function statusLabel(aiActive: boolean, activity: string, isSharing: boolean): string {
  if (!aiActive) return "Paused";
  if (activity === "thinking") return "Thinking…";
  if (activity === "pointing") return "Pointing something out";
  return isSharing ? "Watching your screen" : "Listening";
}

/**
 * The desktop assistant pane doesn't fit as a permanent floating panel on a
 * phone screen already dominated by the generated visual — so Real AI lives
 * behind a bottom sheet instead, opened from the meeting dock. Same
 * consent/orb/feed/command-bar components as desktop, just staged
 * differently; no assistant behavior is reimplemented here.
 */
interface MobileAssistantSheetProps {
  open: boolean;
  onClose: () => void;
  /** True when opened from an "ask something" intent (the primary action,
   * or the generated-visual empty state) — false when opened just to check
   * status, so a status glance never yanks the keyboard open. */
  focusCommandBar?: boolean;
}

export function MobileAssistantSheet({ open, onClose, focusCommandBar = false }: MobileAssistantSheetProps) {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const reduceMotion = useReducedMotion();
  const isSharing = state.screenShare !== "off";
  const dragControls = useDragControls();

  const handleDelete = () => {
    actions.deleteSessionData();
    api.deleteSession().catch(() => undefined);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="mobile-sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="mobile-sheet glass"
            role="dialog"
            aria-label="Real AI"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: reduceMotion ? 0.15 : 0.35, ease: [0.16, 1, 0.3, 1] }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) {
                triggerHaptic("light");
                onClose();
              }
            }}
          >
            <div
              className="mobile-sheet__handle-area"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="mobile-sheet__handle" aria-hidden />
            </div>
            <header className="mobile-sheet__header">
              <AssistantOrb activity={state.assistantActivity} dormant={!state.aiActive} size={36} />
              <div className="mobile-sheet__heading">
                <span className="mobile-sheet__name">Real AI</span>
                <span className="mobile-sheet__status">{statusLabel(state.aiActive, state.assistantActivity, isSharing)}</span>
              </div>
              {state.aiConsent && (
                <div className="mobile-sheet__header-actions">
                  {state.aiActive ? (
                    <motion.button
                      whileTap={{ scale: 0.92 }}
                      onTapStart={() => triggerHaptic("light")}
                      type="button"
                      onClick={actions.stopAiAnalysis}
                      aria-label="Stop AI analysis"
                      title="Stop AI analysis"
                    >
                      ⏸
                    </motion.button>
                  ) : (
                    <motion.button
                      whileTap={{ scale: 0.92 }}
                      onTapStart={() => triggerHaptic("light")}
                      type="button"
                      onClick={actions.grantAiConsent}
                      aria-label="Resume AI analysis"
                      title="Resume AI analysis"
                    >
                      ▶
                    </motion.button>
                  )}
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    onTapStart={() => triggerHaptic("warning")}
                    type="button"
                    onClick={handleDelete}
                    aria-label="Delete session data"
                    title="Delete session data"
                  >
                    ⌫
                  </motion.button>
                </div>
              )}
              <motion.button
                whileTap={{ scale: 0.92 }}
                onTapStart={() => triggerHaptic("light")}
                type="button"
                className="mobile-sheet__close"
                onClick={onClose}
                aria-label="Close"
              >
                ✕
              </motion.button>
            </header>

            {!state.aiConsent ? (
              <ConsentOverlay />
            ) : (
              <div className="mobile-sheet__body">
                <LiveTicker />
                <ThoughtFeed entries={state.feed} />
                <CommandBar autoFocus={focusCommandBar} />
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
