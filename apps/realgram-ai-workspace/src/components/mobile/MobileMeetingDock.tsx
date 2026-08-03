import { motion } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import type { ScreenShareStatus } from "../../hooks/useScreenShare";
import { triggerHaptic } from "../../services/haptics";

interface MobileMeetingDockProps {
  onShareScreen: () => void;
  onStopShareScreen: () => void;
  shareStatus: ScreenShareStatus;
  onOpenAssistant: () => void;
}

/**
 * The one thing that must always be reachable on a phone mid-call: call
 * controls. Fixed to the viewport bottom regardless of scroll position —
 * everything else on the page (generated visual, tasks) scrolls under it.
 */
export function MobileMeetingDock({ onShareScreen, onStopShareScreen, shareStatus, onOpenAssistant }: MobileMeetingDockProps) {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const isSharing = state.screenShare !== "off";

  const handleShareClick = () => {
    if (isSharing) onStopShareScreen();
    else onShareScreen();
  };

  return (
    <nav className="mobile-dock glass" aria-label="Meeting controls">
      <motion.button
        whileTap={{ scale: 0.88 }}
        onTapStart={() => triggerHaptic("light")}
        type="button"
        className={`mobile-dock__btn ${!state.micOn ? "mobile-dock__btn--off" : ""}`}
        onClick={actions.toggleMic}
        aria-pressed={state.micOn}
        aria-label="Microphone"
      >
        <span className="mobile-dock__icon" aria-hidden>
          {state.micOn ? "●" : "○"}
        </span>
        <span className="mobile-dock__label">Mic</span>
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.88 }}
        onTapStart={() => triggerHaptic("light")}
        type="button"
        className={`mobile-dock__btn ${!state.cameraOn ? "mobile-dock__btn--off" : ""}`}
        onClick={actions.toggleCamera}
        aria-pressed={state.cameraOn}
        aria-label="Camera"
      >
        <span className="mobile-dock__icon" aria-hidden>
          ▢
        </span>
        <span className="mobile-dock__label">Camera</span>
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.88 }}
        onTapStart={() => triggerHaptic("light")}
        type="button"
        className={`mobile-dock__btn ${isSharing ? "mobile-dock__btn--active" : ""}`}
        onClick={handleShareClick}
        aria-pressed={isSharing}
        aria-label="Share screen"
      >
        <span className="mobile-dock__icon" aria-hidden>
          ⇪
        </span>
        <span className="mobile-dock__label">{shareStatus === "requesting" ? "Requesting…" : "Share"}</span>
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.88 }}
        onTapStart={() => triggerHaptic("light")}
        type="button"
        className={`mobile-dock__btn mobile-dock__btn--ai ${state.aiActive ? "mobile-dock__btn--active" : ""}`}
        onClick={onOpenAssistant}
        aria-label="Real AI"
      >
        <span className="mobile-dock__icon" aria-hidden>
          <span className="mobile-dock__ai-dot" />
        </span>
        <span className="mobile-dock__label">Real AI</span>
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.88 }}
        onTapStart={() => triggerHaptic("warning")}
        type="button"
        className="mobile-dock__btn mobile-dock__btn--leave"
        aria-label="Leave meeting"
      >
        <span className="mobile-dock__icon" aria-hidden>
          ✕
        </span>
        <span className="mobile-dock__label">Leave</span>
      </motion.button>
    </nav>
  );
}
