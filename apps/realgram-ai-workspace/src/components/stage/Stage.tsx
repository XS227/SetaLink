import { motion } from "framer-motion";
import { RealGramLogo } from "../RealGramLogo";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { SharedScreenView } from "./SharedScreenView";
import { RealScreenShareView } from "./RealScreenShareView";
import { AnnotationLayer } from "./AnnotationLayer";
import { GeneratingBanner } from "./GeneratingBanner";

/**
 * The stage is the center of the experience: a large window floating in
 * space, not a boxed dashboard tile flush with the browser edges. Ambient
 * void and ombre glow surround it so the eye reads it as the room's one
 * real object, the way a Vision Pro window sits in space rather than
 * filling the display.
 */
export function Stage({ realStream }: { realStream: MediaStream | null }) {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const isSharing = state.screenShare !== "off";
  const isPresenting = Boolean(state.presentedAsset);

  return (
    <div className="stage">
      <div className="stage__ambient" aria-hidden />
      <motion.div
        className="stage__window"
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <GeneratingBanner />

        {isPresenting && state.presentedAsset ? (
          <>
            <div className="stage__presenting stage__presenting--asset">
              <span className="stage__presenting-dot stage__presenting-dot--asset" aria-hidden />
              Presenting Real AI's result
              <button type="button" className="stage__stop-presenting" onClick={actions.stopPresenting}>
                Back to meeting
              </button>
            </div>
            <div className="stage__content stage__content--asset">
              <img src={state.presentedAsset.url} alt={state.presentedAsset.prompt} className="stage__presented-image" />
            </div>
          </>
        ) : isSharing ? (
          <>
            <div className="stage__presenting">
              <span className="stage__presenting-dot" aria-hidden />
              Presenting your screen
            </div>
            <div className="stage__content">
              {state.screenShare === "real" && realStream ? (
                <RealScreenShareView stream={realStream} />
              ) : (
                <SharedScreenView />
              )}
              <AnnotationLayer />
            </div>
          </>
        ) : (
          <div className="stage__empty">
            <RealGramLogo size={40} />
            <h1 className="stage__empty-title">{state.meetingTitle || "Waiting to join…"}</h1>
            <p className="stage__empty-hint">Share your screen to bring the workspace to life.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
