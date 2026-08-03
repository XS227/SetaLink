import { motion } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { api } from "../../services/api";
import { AssistantOrb } from "./AssistantOrb";
import { ConsentOverlay } from "./ConsentOverlay";
import { LiveTicker } from "./LiveTicker";
import { ThoughtFeed } from "./ThoughtFeed";
import { CommandBar } from "./CommandBar";

function statusLabel(aiActive: boolean, activity: string, isSharing: boolean): string {
  if (!aiActive) return "Paused";
  if (activity === "thinking") return "Thinking…";
  if (activity === "pointing") return "Pointing something out";
  return isSharing ? "Watching your screen" : "Listening";
}

export function LivingAssistant() {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const isSharing = state.screenShare !== "off";

  const handleDelete = () => {
    actions.deleteSessionData();
    api.deleteSession().catch(() => undefined);
  };

  return (
    <motion.aside
      className="assistant-pane glass"
      aria-label="Real AI"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="assistant-pane__header">
        <AssistantOrb activity={state.assistantActivity} dormant={!state.aiActive} />
        <div className="assistant-pane__heading">
          <span className="assistant-pane__name">Real AI</span>
          <span className="assistant-pane__status">{statusLabel(state.aiActive, state.assistantActivity, isSharing)}</span>
        </div>
        {state.aiConsent && (
          <div className="assistant-pane__header-actions">
            {state.aiActive ? (
              <button type="button" onClick={actions.stopAiAnalysis} title="Stop AI analysis" aria-label="Stop AI analysis">
                ⏸
              </button>
            ) : (
              <button type="button" onClick={actions.grantAiConsent} title="Resume AI analysis" aria-label="Resume AI analysis">
                ▶
              </button>
            )}
            <button type="button" onClick={handleDelete} title="Delete session data" aria-label="Delete session data">
              ⌫
            </button>
          </div>
        )}
      </header>

      {!state.aiConsent ? (
        <ConsentOverlay />
      ) : (
        <>
          <LiveTicker />
          <ThoughtFeed entries={state.feed} />
          <CommandBar />
        </>
      )}
    </motion.aside>
  );
}
