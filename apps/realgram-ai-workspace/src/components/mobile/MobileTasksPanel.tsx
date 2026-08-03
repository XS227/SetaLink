import { useState } from "react";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { api } from "../../services/api";
import { downloadMeetingIntelligencePack } from "../../services/exportPack";

/**
 * Decisions/action items/summary collapse into <details> disclosures,
 * closed by default with counts in their headers, so the page's dominant
 * element stays the generated visual, not a wall of meeting-minutes text.
 * Export drops from "the biggest button on the page" (desktop's rail) to a
 * plain secondary action at the bottom of this panel.
 */
export function MobileTasksPanel() {
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

  if (!state.summary) {
    return (
      <section className="mobile-tasks">
        <button type="button" className="mobile-tasks__generate" onClick={handleGenerate} disabled={generating || !state.aiActive}>
          {generating ? "Summarizing…" : "Generate decisions & action items"}
        </button>
      </section>
    );
  }

  return (
    <section className="mobile-tasks">
      <details className="mobile-tasks__section">
        <summary>Meeting summary</summary>
        <p className="mobile-tasks__summary-text">{state.summary}</p>
      </details>

      <details className="mobile-tasks__section">
        <summary>
          Decisions <span className="mobile-tasks__count">{state.decisions.length}</span>
        </summary>
        <ul>
          {state.decisions.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </details>

      <details className="mobile-tasks__section">
        <summary>
          Action items <span className="mobile-tasks__count">{state.actionItems.length}</span>
        </summary>
        <ul>
          {state.actionItems.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </details>

      <button type="button" className="mobile-tasks__export" onClick={() => downloadMeetingIntelligencePack(state)}>
        Export Meeting Intelligence Pack
      </button>
    </section>
  );
}
