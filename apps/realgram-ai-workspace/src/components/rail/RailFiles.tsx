import type { GenerationJob } from "../../types/api";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";

export function RailFiles({ jobs }: { jobs: GenerationJob[] }) {
  return (
    <div className="rail-section">
      <h2 className="rail-section__heading">Files</h2>
      {jobs.length === 0 ? (
        <p className="rail-section__empty">Generated visuals will appear here.</p>
      ) : (
        <div className="rail-files">
          {jobs.map((job) => (
            <FileCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileCard({ job }: { job: GenerationJob }) {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const isCompleted = job.status === "completed" && Boolean(job.resultUrl);
  const isPresenting = isCompleted && state.presentedAsset?.url === job.resultUrl;

  return (
    <div className={`file-card file-card--${job.status}`}>
      {isCompleted && job.resultUrl ? (
        <img src={job.resultUrl} alt={job.prompt} className="file-card__image" />
      ) : (
        <div className="file-card__progress">
          <span className="file-card__spinner" aria-hidden />
          {job.status === "failed" ? "Failed" : job.status}
        </div>
      )}
      <p className="file-card__prompt">{job.prompt}</p>

      {isCompleted && job.resultUrl && (
        <div className="file-card__actions">
          <button
            type="button"
            className="file-card__action"
            aria-pressed={isPresenting}
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
            className="file-card__action"
            onClick={() => actions.shareAssetToChat(job.resultUrl as string, job.prompt)}
          >
            Share to chat
          </button>
        </div>
      )}
    </div>
  );
}
