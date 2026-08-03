import { motion, AnimatePresence } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { api } from "../../services/api";
import { AssistantOrb } from "../assistant/AssistantOrb";
import { ConsentOverlay } from "../assistant/ConsentOverlay";
import { LiveTicker } from "../assistant/LiveTicker";
import { ThoughtFeed } from "../assistant/ThoughtFeed";
import { CommandBar } from "../assistant/CommandBar";

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
export function MobileAssistantSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const isSharing = state.screenShare !== "off";

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
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mobile-sheet__handle" aria-hidden />
            <header className="mobile-sheet__header">
              <AssistantOrb activity={state.assistantActivity} dormant={!state.aiActive} size={36} />
              <div className="mobile-sheet__heading">
                <span className="mobile-sheet__name">Real AI</span>
                <span className="mobile-sheet__status">{statusLabel(state.aiActive, state.assistantActivity, isSharing)}</span>
              </div>
              {state.aiConsent && (
                <div className="mobile-sheet__header-actions">
                  {state.aiActive ? (
                    <button type="button" onClick={actions.stopAiAnalysis} aria-label="Stop AI analysis" title="Stop AI analysis">
                      ⏸
                    </button>
                  ) : (
                    <button type="button" onClick={actions.grantAiConsent} aria-label="Resume AI analysis" title="Resume AI analysis">
                      ▶
                    </button>
                  )}
                  <button type="button" onClick={handleDelete} aria-label="Delete session data" title="Delete session data">
                    ⌫
                  </button>
                </div>
              )}
              <button type="button" className="mobile-sheet__close" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </header>

            {!state.aiConsent ? (
              <ConsentOverlay />
            ) : (
              <div className="mobile-sheet__body">
                <LiveTicker />
                <ThoughtFeed entries={state.feed} />
                <CommandBar />
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
