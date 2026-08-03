import { useGuidedDemo } from "../../hooks/useGuidedDemo";
import { useWorkspace } from "../../state/workspaceStore";

export function RailMeeting() {
  const { state } = useWorkspace();
  const { play, pause, restart, sceneIndex, demoPlaying, scenes } = useGuidedDemo();
  const scene = scenes[sceneIndex];

  return (
    <div className="rail-section">
      <h2 className="rail-section__heading">Meeting</h2>
      <p className="rail-meeting__title">{state.meetingTitle || "—"}</p>

      {scenes.length > 0 && (
        <div className="rail-meeting__demo">
          <div className="rail-meeting__scene mono">
            Scene {sceneIndex + 1} / {scenes.length}
          </div>
          {scene && <p className="rail-meeting__scene-desc">{scene.title}</p>}
          <div className="rail-meeting__demo-controls">
            {demoPlaying ? (
              <button type="button" onClick={pause}>
                Pause
              </button>
            ) : (
              <button type="button" onClick={play} className="rail-meeting__demo-play">
                {sceneIndex === 0 ? "Play guided demo" : "Resume"}
              </button>
            )}
            <button type="button" onClick={restart} disabled={demoPlaying}>
              Restart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
