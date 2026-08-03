import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { useGuidedDemo } from "../../hooks/useGuidedDemo";
import type { ScreenShareStatus } from "../../hooks/useScreenShare";
import { AssistantOrb } from "../assistant/AssistantOrb";
import { MobileHeader } from "./MobileHeader";
import { MobileStepper } from "./MobileStepper";
import { MobileGeneratedVisual } from "./MobileGeneratedVisual";
import { MobileTasksPanel } from "./MobileTasksPanel";
import { MobileMeetingDock } from "./MobileMeetingDock";
import { MobileAssistantSheet } from "./MobileAssistantSheet";
import { triggerHaptic } from "../../services/haptics";

function statusLabel(aiActive: boolean, activity: string, isSharing: boolean): string {
  if (!aiActive) return "Paused";
  if (activity === "thinking") return "Thinking…";
  if (activity === "pointing") return "Pointing something out";
  return isSharing ? "Watching your screen" : "Listening";
}

interface MobileWorkspaceProps {
  onShareScreen: () => void;
  onStopShareScreen: () => void;
  shareStatus: ScreenShareStatus;
}

const columnVariants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

/**
 * The whole mobile page in one glance-able column: header, meeting name,
 * current step, AI status, a single primary action, then the generated
 * visual (the dominant element), then tasks, with call controls pinned to
 * the bottom at all times. A separate tree from the desktop canvas — see
 * useIsMobile — not a reflow of it.
 */
export function MobileWorkspace({ onShareScreen, onStopShareScreen, shareStatus }: MobileWorkspaceProps) {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const { play, pause, demoPlaying } = useGuidedDemo();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [focusCommandBar, setFocusCommandBar] = useState(false);
  const reduceMotion = useReducedMotion();
  const isSharing = state.screenShare !== "off";

  const openAssistant = useCallback((focus = false) => {
    setFocusCommandBar(focus);
    setAssistantOpen(true);
  }, []);

  const primaryAction = !state.aiConsent
    ? { label: "Wake Real AI", onClick: () => actions.grantAiConsent() }
    : demoPlaying
      ? { label: "Pause guided demo", onClick: pause }
      : state.sceneIndex === 0 && state.generationJobs.length === 0
        ? { label: "Play guided demo", onClick: play }
        : { label: "Ask Real AI", onClick: () => openAssistant(true) };

  return (
    <div className="mobile-workspace">
      <MobileHeader />

      <motion.main
        className="mobile-workspace__scroll"
        variants={reduceMotion ? undefined : columnVariants}
        initial="hidden"
        animate="shown"
      >
        <motion.p variants={reduceMotion ? undefined : itemVariants} className="mobile-meeting-strip mono">
          {state.meetingTitle || "—"}
        </motion.p>

        <motion.div variants={reduceMotion ? undefined : itemVariants}>
          <MobileStepper />
        </motion.div>

        <motion.button
          variants={reduceMotion ? undefined : itemVariants}
          whileTap={{ scale: 0.98 }}
          onTapStart={() => triggerHaptic("light")}
          type="button"
          className="mobile-ai-status glass"
          onClick={() => openAssistant(false)}
        >
          <AssistantOrb activity={state.assistantActivity} dormant={!state.aiActive} size={24} />
          <span>{statusLabel(state.aiActive, state.assistantActivity, isSharing)}</span>
          <span className="mobile-ai-status__open">Open Real AI ›</span>
        </motion.button>

        <motion.button
          variants={reduceMotion ? undefined : itemVariants}
          whileTap={{ scale: 0.97 }}
          onTapStart={() => triggerHaptic("medium")}
          type="button"
          className="mobile-primary-action"
          onClick={primaryAction.onClick}
        >
          {primaryAction.label}
        </motion.button>

        <motion.div variants={reduceMotion ? undefined : itemVariants}>
          <MobileGeneratedVisual onAskRealAi={() => openAssistant(true)} />
        </motion.div>

        <motion.div variants={reduceMotion ? undefined : itemVariants}>
          <MobileTasksPanel />
        </motion.div>
      </motion.main>

      <MobileMeetingDock
        onShareScreen={onShareScreen}
        onStopShareScreen={onStopShareScreen}
        shareStatus={shareStatus}
        onOpenAssistant={() => openAssistant(false)}
      />

      <MobileAssistantSheet
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        focusCommandBar={focusCommandBar}
      />
    </div>
  );
}
