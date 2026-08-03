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
  const job = state.generationJobs[0];
  const isPresenting = job?.resultUrl && state.presentedAsset?.url === job.resultUrl;
  const badgeLabel = job && job.provider !== "mock" ? "AI generated" : "Demo generation";

  return (
    <section className="mobile-generated" aria-label="Real AI's generated visual">
      <div className="mobile-generated__frame">
        {!job && (
          <div className="mobile-generated__empty">
            <RealGramLogo size={30} />
            <p className="mobile-generated__empty-title">Nothing generated yet</p>
            <p className="mobile-generated__empty-hint">Ask Real AI for a launch visual and it'll appear here, full size.</p>
            <button type="button" className="mobile-generated__ask" onClick={onAskRealAi}>
              Ask Real AI to create
            </button>
          </div>
        )}

        {job && (job.status === "queued" || job.status === "processing") && (
          <div className="mobile-generated__progress">
            <span className="mobile-generated__spinner" aria-hidden />
            <p className="mobile-generated__progress-title">Real AI is generating…</p>
            <p className="mobile-generated__progress-prompt">{job.prompt}</p>
            <span className="mobile-generated__badge mobile-generated__badge--status mono">{job.status}</span>
          </div>
        )}

        {job?.status === "failed" && (
          <div className="mobile-generated__failed">
            <p>Generation failed.</p>
            <p className="mobile-generated__progress-prompt">{job.error ?? "Try asking again."}</p>
          </div>
        )}

        {job?.status === "completed" && job.resultUrl && (
          <>
            <img src={job.resultUrl} alt={job.prompt} className="mobile-generated__image" />
            <span className="mobile-generated__badge mono">{badgeLabel}</span>
          </>
        )}
      </div>

      {job?.status === "completed" && job.resultUrl && (
        <div className="mobile-generated__actions">
          <button
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
          </button>
          <button
            type="button"
            className="mobile-generated__action"
            onClick={() => actions.shareAssetToChat(job.resultUrl as string, job.prompt)}
          >
            Share to chat
          </button>
        </div>
      )}
    </section>
  );
}
