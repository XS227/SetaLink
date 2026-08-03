import { AnimatePresence, motion } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import type { TranslationLang } from "../../types/api";

const LANG_LABEL: Record<TranslationLang, string> = { en: "EN", no: "NO", fa: "FA" };

/** A one-line "what's being said right now" ticker — the assistant
 * visibly following the conversation, not a scrollback transcript log. */
export function LiveTicker() {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const current = state.transcript[state.transcriptRevealCount - 1];
  const speaker = current && state.participants.find((p) => p.id === current.speakerId);

  return (
    <div className="live-ticker">
      <div className="live-ticker__row">
        <span className={`live-ticker__dot ${current ? "live-ticker__dot--live" : ""}`} aria-hidden />
        <div className="live-ticker__text">
          <AnimatePresence mode="wait">
            {current ? (
              <motion.div
                key={state.transcriptRevealCount}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
              >
                <span className="live-ticker__speaker">{speaker?.name ?? "…"}</span>{" "}
                {state.captionsOn && state.translationLang !== "en" ? current[state.translationLang] : current.en}
              </motion.div>
            ) : (
              <span className="live-ticker__idle">Nothing said yet</span>
            )}
          </AnimatePresence>
        </div>
        <div className="live-ticker__controls">
          <button
            type="button"
            className={`live-ticker__cc ${state.captionsOn ? "live-ticker__cc--active" : ""}`}
            onClick={actions.toggleCaptions}
            aria-pressed={state.captionsOn}
            title="Toggle translated captions"
          >
            CC
          </button>
          <select
            value={state.translationLang}
            onChange={(e) => actions.setTranslationLang(e.target.value as TranslationLang)}
            aria-label="Caption translation language"
          >
            {(Object.keys(LANG_LABEL) as TranslationLang[]).map((lang) => (
              <option key={lang} value={lang}>
                {LANG_LABEL[lang]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
