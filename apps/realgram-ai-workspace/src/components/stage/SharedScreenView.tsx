/**
 * The "simulated shared product interface" from the guided demo's Scene 3.
 * A self-contained, static mock of a RealGram analytics screen — not real
 * data, not a real chart library, just enough visual weight to read as "a
 * real product someone is presenting" inside the stage window.
 */
export function SharedScreenView() {
  const stats = [
    { label: "Active meetings", value: "142" },
    { label: "AI Workspace sessions", value: "58" },
    { label: "Avg. meeting length", value: "24m" },
  ];
  const adoption = 0.67;

  return (
    <div className="shared-screen" role="img" aria-label="Simulated RealGram product dashboard being presented">
      <div className="shared-screen__chrome">
        <span className="shared-screen__dot" />
        <span className="shared-screen__dot" />
        <span className="shared-screen__dot" />
        <span className="shared-screen__url mono">realgram.app/dashboard</span>
      </div>
      <div className="shared-screen__body">
        <div className="shared-screen__header">
          <span className="shared-screen__title">AI Workspace — rollout dashboard</span>
          <span className="shared-screen__badge">Simulated</span>
        </div>
        <div className="shared-screen__stats">
          {stats.map((stat) => (
            <div key={stat.label} className="stat-tile" data-stat={stat.label}>
              <span className="stat-tile__value">{stat.value}</span>
              <span className="stat-tile__label">{stat.label}</span>
            </div>
          ))}
        </div>
        <div className="shared-screen__progress" data-stat="Team adoption">
          <div className="shared-screen__progress-header">
            <span>Team adoption</span>
            <span className="mono">{Math.round(adoption * 100)}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-track__fill" style={{ width: `${adoption * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
