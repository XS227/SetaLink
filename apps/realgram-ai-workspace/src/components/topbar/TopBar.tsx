import { motion } from "framer-motion";
import { RealGramLogo } from "../RealGramLogo";
import { useWorkspace } from "../../state/workspaceStore";
import { WorkflowStepper } from "./WorkflowStepper";

/**
 * The one full-width surface in the layout — everything else (rail, stage,
 * assistant pane, dock) floats below it. Carries the brand line (gradient
 * gold->purple, tokens.css's --gradient-brand) and the workflow stepper, so
 * "whose product is this" and "where are we in the meeting" are both
 * readable at a glance without opening any panel.
 */
export function TopBar() {
  const { state } = useWorkspace();
  const isLive = state.screenShare !== "off";

  return (
    <motion.header
      className="topbar glass"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="topbar__brand">
        <RealGramLogo size={20} />
        <span className="topbar__wordmark">
          RealGram <span className="topbar__wordmark-feature">AI Workspace</span>
        </span>
      </div>

      <WorkflowStepper />

      <div className="topbar__meta">
        {isLive && (
          <span className="topbar__live">
            <span className="topbar__live-dot" aria-hidden />
            Live
          </span>
        )}
        <span className="topbar__meeting-title mono" title={state.meetingTitle || undefined}>
          {state.meetingTitle || "—"}
        </span>
        <span className="topbar__participants" title="Participants">
          {state.participants.length || 0}
        </span>
      </div>
    </motion.header>
  );
}
