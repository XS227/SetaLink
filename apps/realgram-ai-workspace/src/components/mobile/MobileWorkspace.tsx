import { useState } from "react";
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
  const isSharing = state.screenShare !== "off";

  const primaryAction = !state.aiConsent
    ? { label: "Wake Real AI", onClick: () => actions.grantAiConsent() }
    : demoPlaying
      ? { label: "Pause guided demo", onClick: pause }
      : state.sceneIndex === 0 && state.generationJobs.length === 0
        ? { label: "Play guided demo", onClick: play }
        : { label: "Ask Real AI", onClick: () => setAssistantOpen(true) };

  return (
    <div className="mobile-workspace">
      <MobileHeader />

      <main className="mobile-workspace__scroll">
        <p className="mobile-meeting-strip mono">{state.meetingTitle || "—"}</p>

        <MobileStepper />

        <button type="button" className="mobile-ai-status glass" onClick={() => setAssistantOpen(true)}>
          <AssistantOrb activity={state.assistantActivity} dormant={!state.aiActive} size={24} />
          <span>{statusLabel(state.aiActive, state.assistantActivity, isSharing)}</span>
          <span className="mobile-ai-status__open">Open Real AI ›</span>
        </button>

        <button type="button" className="mobile-primary-action" onClick={primaryAction.onClick}>
          {primaryAction.label}
        </button>

        <MobileGeneratedVisual onAskRealAi={() => setAssistantOpen(true)} />

        <MobileTasksPanel />
      </main>

      <MobileMeetingDock
        onShareScreen={onShareScreen}
        onStopShareScreen={onStopShareScreen}
        shareStatus={shareStatus}
        onOpenAssistant={() => setAssistantOpen(true)}
      />

      <MobileAssistantSheet open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  );
}
