import type { GenerationJob } from "../../types/api";

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
  return (
    <div className={`file-card file-card--${job.status}`}>
      {job.status === "completed" && job.resultUrl ? (
        <img src={job.resultUrl} alt={job.prompt} className="file-card__image" />
      ) : (
        <div className="file-card__progress">
          <span className="file-card__spinner" aria-hidden />
          {job.status === "failed" ? "Failed" : job.status}
        </div>
      )}
      <p className="file-card__prompt">{job.prompt}</p>
    </div>
  );
}
