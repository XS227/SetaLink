import { useState } from "react";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { api } from "../../services/api";
import { downloadMeetingIntelligencePack } from "../../services/exportPack";

export function RailTasks() {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { summary, decisions, actionItems } = await api.meetingSummary();
      actions.setSummary(summary, decisions, actionItems);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="rail-section">
      <h2 className="rail-section__heading">Tasks</h2>

      {!state.summary ? (
        <button
          type="button"
          className="rail-tasks__generate"
          onClick={handleGenerate}
          disabled={generating || !state.aiActive}
        >
          {generating ? "Summarizing…" : "Generate decisions & action items"}
        </button>
      ) : (
        <>
          <p className="rail-tasks__summary">{state.summary}</p>

          <div className="rail-tasks__group">
            <h3>Decisions</h3>
            <ul>
              {state.decisions.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>

          <div className="rail-tasks__group">
            <h3>Action items</h3>
            <ul>
              {state.actionItems.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>

          <button type="button" className="rail-tasks__export" onClick={() => downloadMeetingIntelligencePack(state)}>
            Export Meeting Intelligence Pack
          </button>
        </>
      )}
    </div>
  );
}
