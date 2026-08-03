import { motion } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import type { ScreenShareStatus } from "../../hooks/useScreenShare";
import { ParticipantPill } from "./ParticipantPill";

interface ParticipantDockProps {
  onShareScreen: () => void;
  onStopShareScreen: () => void;
  shareStatus: ScreenShareStatus;
}

/**
 * A single floating capsule, bottom-center — participants and call controls
 * together, the way a real conferencing app's overlay controls sit with
 * the people they control, not a separate dashboard row. Share screen is
 * the widest, brightest control in the dock by design (the brief calls it
 * out as the one that must read as visually important) — but it's bright
 * neutral, not gold: gold is reserved for the AI's own presence elsewhere
 * in the interface, so this stays legible as "a call control," not "an AI
 * control."
 */
export function ParticipantDock({ onShareScreen, onStopShareScreen, shareStatus }: ParticipantDockProps) {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const isSharing = state.screenShare !== "off";

  const handleShareClick = () => {
    if (isSharing) onStopShareScreen();
    else onShareScreen();
  };

  return (
    <motion.div
      className="dock glass"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="dock__participants">
        {state.participants.map((p) => (
          <ParticipantPill key={p.id} participant={p} micOn={p.id === "you" ? state.micOn : true} />
        ))}
      </div>

      <div className="dock__divider" aria-hidden />

      <div className="dock__controls">
        <IconToggle active={state.micOn} onClick={actions.toggleMic} label="Mic" glyph={state.micOn ? "●" : "○"} offTone="danger" />
        <IconToggle active={state.cameraOn} onClick={actions.toggleCamera} label="Camera" glyph="▢" offTone="danger" />

        <button
          type="button"
          className={`dock__share ${isSharing ? "dock__share--active" : ""}`}
          onClick={handleShareClick}
          aria-pressed={isSharing}
        >
          <span aria-hidden>⇪</span>
          {isSharing ? "Stop sharing" : "Share screen"}
          {shareStatus === "requesting" && <span className="dock__share-status">Requesting…</span>}
          {shareStatus === "denied" && <span className="dock__share-status">Permission denied</span>}
        </button>

        <button type="button" className="dock__leave" aria-label="Leave meeting" title="Leave meeting">
          <span aria-hidden>✕</span>
        </button>
      </div>
    </motion.div>
  );
}

function IconToggle({
  active,
  onClick,
  label,
  glyph,
  offTone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  glyph: string;
  offTone: "danger";
}) {
  return (
    <button
      type="button"
      className={`dock__icon ${!active ? `dock__icon--${offTone}` : ""}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
    >
      <span aria-hidden>{glyph}</span>
    </button>
  );
}
