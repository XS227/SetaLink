import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { RealGramLogo } from "../RealGramLogo";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { WORKFLOW_PHASES, getActivePhaseIndex } from "../../state/workflowPhases";
import type { TranslationLang } from "../../types/api";
import { triggerHaptic } from "../../services/haptics";

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
  const reduceMotion = useReducedMotion();
  const menuRef = useRef<HTMLDivElement>(null);
  const isLive = state.screenShare !== "off";
  const phase = WORKFLOW_PHASES[getActivePhaseIndex(state.scenes, state.sceneIndex)];

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  return (
    <header className="mobile-header glass">
      <div className="mobile-header__row">
        <RealGramLogo size={18} />

        <AnimatePresence>
          {isLive && (
            <motion.span
              className="mobile-header__live"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              <span className="mobile-header__live-dot" aria-hidden />
              Live
            </motion.span>
          )}
        </AnimatePresence>

        <span className="mobile-header__phase-frame" title={`Current phase: ${phase.label}`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={phase.label}
              className="mobile-header__phase"
              initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              {phase.label}
            </motion.span>
          </AnimatePresence>
        </span>

        <span className="mobile-header__participants" title="Participants">
          {state.participants.length || 0}
        </span>

        <motion.button
          type="button"
          className="mobile-header__overflow"
          aria-label="More options"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          whileTap={{ scale: 0.88 }}
          onTapStart={() => triggerHaptic("light")}
        >
          <span aria-hidden>⋯</span>
        </motion.button>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            ref={menuRef}
            className="mobile-header__menu glass"
            role="menu"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: "top right" }}
          >
            {state.aiConsent && (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onTapStart={() => triggerHaptic("light")}
                type="button"
                role="menuitem"
                onClick={() => (state.aiActive ? actions.stopAiAnalysis() : actions.grantAiConsent())}
              >
                {state.aiActive ? "Stop AI analysis" : "Resume AI analysis"}
              </motion.button>
            )}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onTapStart={() => triggerHaptic("light")}
              type="button"
              role="menuitem"
              onClick={actions.toggleCaptions}
              aria-pressed={state.captionsOn}
            >
              {state.captionsOn ? "Turn off captions" : "Turn on captions"}
            </motion.button>
            {state.captionsOn && (
              <div className="mobile-header__menu-langs" role="group" aria-label="Caption language">
                {(Object.keys(LANG_LABEL) as TranslationLang[]).map((lang) => (
                  <motion.button
                    key={lang}
                    whileTap={{ scale: 0.94 }}
                    onTapStart={() => triggerHaptic("light")}
                    type="button"
                    className={state.translationLang === lang ? "mobile-header__menu-lang--active" : ""}
                    onClick={() => actions.setTranslationLang(lang)}
                  >
                    {LANG_LABEL[lang]}
                  </motion.button>
                ))}
              </div>
            )}
            {state.aiConsent && (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onTapStart={() => triggerHaptic("warning")}
                type="button"
                role="menuitem"
                onClick={actions.deleteSessionData}
              >
                Delete session data
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
