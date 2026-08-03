import { AssistantOrb } from "./AssistantOrb";
import { useWorkspaceActions } from "../../state/workspaceStore";
import { triggerHaptic } from "../../services/haptics";

/**
 * Before consent, the assistant is deliberately dormant — a sleeping orb,
 * not a chat window with a disabled input. Waking it is one explicit act,
 * matching the brief's privacy requirement in the interface's own voice.
 *
 * `haptics` is opt-in (mobile's assistant sheet passes it) — desktop's
 * pane omits it, same pattern as CommandBar's `autoFocus`.
 */
export function ConsentOverlay({ haptics = false }: { haptics?: boolean }) {
  const actions = useWorkspaceActions();

  return (
    <div className="consent-overlay">
      <AssistantOrb activity="idle" dormant size={44} />
      <p className="consent-overlay__statement">AI analysis starts only after everyone consents.</p>
      <p className="consent-overlay__detail">
        Meeting analysis is simulated locally in this prototype — nothing goes to a third-party API.
        Generated visuals go through an adapter that defaults to a local mock.
      </p>
      <button
        type="button"
        className="consent-overlay__wake"
        onPointerDown={haptics ? () => triggerHaptic("medium") : undefined}
        onClick={actions.grantAiConsent}
      >
        Wake Real AI
      </button>
    </div>
  );
}
