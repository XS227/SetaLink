import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { RealGramLogo } from "../RealGramLogo";

/**
 * The dominant element of the mobile page — full-width, a real minimum
 * height even before anything has been generated, and never a bare "empty
 * mock panel": with no job yet it's a branded RealGram invitation card, not
 * blank space. Present/Share-to-chat live in a sticky action row directly
 * under it (see .mobile-generated__actions), reachable no matter how far
 * the user scrolls into the tasks panel below.
 */
export function MobileGeneratedVisual({ onAskRealAi }: { onAskRealAi: () => void }) {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const reduceMotion = useReducedMotion();
  const job = state.generationJobs[0];
  const isPresenting = job?.resultUrl && state.presentedAsset?.url === job.resultUrl;
  const badgeLabel = job && job.provider !== "mock" ? "AI generated" : "Demo generation";

  return (
    <section className="mobile-generated" aria-label="Real AI's generated visual">
      <div className="mobile-generated__frame">
        <AnimatePresence mode="wait" initial={false}>
          {!job && (
            <motion.div
              key="empty"
              className="mobile-generated__empty"
              initial={reduceMotion ? undefined : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <RealGramLogo size={30} />
              <p className="mobile-generated__empty-title">Nothing generated yet</p>
              <p className="mobile-generated__empty-hint">Ask Real AI for a launch visual and it'll appear here, full size.</p>
              <motion.button whileTap={{ scale: 0.97 }} type="button" className="mobile-generated__ask" onClick={onAskRealAi}>
                Ask Real AI to create
              </motion.button>
            </motion.div>
          )}

          {job && (job.status === "queued" || job.status === "processing") && (
            <motion.div
              key="progress"
              className="mobile-generated__progress"
              initial={reduceMotion ? undefined : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <span className="mobile-generated__spinner" aria-hidden />
              <p className="mobile-generated__progress-title">Real AI is generating…</p>
              <p className="mobile-generated__progress-prompt">{job.prompt}</p>
              <span className="mobile-generated__badge mobile-generated__badge--status mono">{job.status}</span>
            </motion.div>
          )}

          {job?.status === "failed" && (
            <motion.div
              key="failed"
              className="mobile-generated__failed"
              initial={reduceMotion ? undefined : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
            >
              <p>Generation failed.</p>
              <p className="mobile-generated__progress-prompt">{job.error ?? "Try asking again."}</p>
            </motion.div>
          )}

          {job?.status === "completed" && job.resultUrl && (
            <motion.div
              key="result"
              initial={reduceMotion ? undefined : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <img src={job.resultUrl} alt={job.prompt} className="mobile-generated__image" />
              <motion.span
                className="mobile-generated__badge mono"
                initial={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.3 }}
              >
                {badgeLabel}
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {job?.status === "completed" && job.resultUrl && (
        <motion.div
          className="mobile-generated__actions"
          initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            className="mobile-generated__action"
            aria-pressed={Boolean(isPresenting)}
            onClick={() =>
              isPresenting
                ? actions.stopPresenting()
                : actions.presentAsset({ url: job.resultUrl as string, prompt: job.prompt })
            }
          >
            {isPresenting ? "Presenting" : "Present on stage"}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            type="button"
            className="mobile-generated__action"
            onClick={() => actions.shareAssetToChat(job.resultUrl as string, job.prompt)}
          >
            Share to chat
          </motion.button>
        </motion.div>
      )}
    </section>
  );
}
