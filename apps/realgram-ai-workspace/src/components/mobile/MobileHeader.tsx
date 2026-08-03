import { useState } from "react";
import { RealGramLogo } from "../RealGramLogo";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { WORKFLOW_PHASES, getActivePhaseIndex } from "../../state/workflowPhases";
import type { TranslationLang } from "../../types/api";

const LANG_LABEL: Record<TranslationLang, string> = { en: "EN", no: "NO", fa: "FA" };

/**
 * The compact mobile equivalent of TopBar — one row, not a brand line plus
 * a six-step stepper plus meeting metadata. Everything that doesn't fit
 * gets an overflow menu instead of being crammed in or dropped.
 */
export function MobileHeader() {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const isLive = state.screenShare !== "off";
  const phase = WORKFLOW_PHASES[getActivePhaseIndex(state.scenes, state.sceneIndex)];

  return (
    <header className="mobile-header glass">
      <div className="mobile-header__row">
        <RealGramLogo size={18} />

        {isLive && (
          <span className="mobile-header__live">
            <span className="mobile-header__live-dot" aria-hidden />
            Live
          </span>
        )}

        <span className="mobile-header__phase" title={`Current phase: ${phase.label}`}>
          {phase.label}
        </span>

        <span className="mobile-header__participants" title="Participants">
          {state.participants.length || 0}
        </span>

        <button
          type="button"
          className="mobile-header__overflow"
          aria-label="More options"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span aria-hidden>⋯</span>
        </button>
      </div>

      {menuOpen && (
        <div className="mobile-header__menu glass" role="menu">
          {state.aiConsent && (
            <button
              type="button"
              role="menuitem"
              onClick={() => (state.aiActive ? actions.stopAiAnalysis() : actions.grantAiConsent())}
            >
              {state.aiActive ? "Stop AI analysis" : "Resume AI analysis"}
            </button>
          )}
          <button type="button" role="menuitem" onClick={actions.toggleCaptions} aria-pressed={state.captionsOn}>
            {state.captionsOn ? "Turn off captions" : "Turn on captions"}
          </button>
          {state.captionsOn && (
            <div className="mobile-header__menu-langs" role="group" aria-label="Caption language">
              {(Object.keys(LANG_LABEL) as TranslationLang[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  className={state.translationLang === lang ? "mobile-header__menu-lang--active" : ""}
                  onClick={() => actions.setTranslationLang(lang)}
                >
                  {LANG_LABEL[lang]}
                </button>
              ))}
            </div>
          )}
          {state.aiConsent && (
            <button type="button" role="menuitem" onClick={actions.deleteSessionData}>
              Delete session data
            </button>
          )}
        </div>
      )}
    </header>
  );
}
