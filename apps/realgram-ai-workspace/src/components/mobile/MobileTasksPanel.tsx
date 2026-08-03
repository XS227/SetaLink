import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useWorkspace, useWorkspaceActions } from "../../state/workspaceStore";
import { api } from "../../services/api";
import { downloadMeetingIntelligencePack } from "../../services/exportPack";

interface AccordionRowProps {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/**
 * A custom accordion instead of native <details> — the browser's built-in
 * disclosure snaps open/closed with no animation, which reads as a form,
 * not an app. This animates height smoothly and gives every tap real
 * press feedback, matching the rest of the mobile experience.
 */
function AccordionRow({ title, count, open, onToggle, children }: AccordionRowProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="mobile-tasks__section">
      <motion.button
        type="button"
        className="mobile-tasks__section-summary"
        onClick={onToggle}
        aria-expanded={open}
        whileTap={{ scale: 0.985 }}
      >
        <span>{title}</span>
        {count !== undefined && <span className="mobile-tasks__count">{count}</span>}
        <motion.span
          className="mobile-tasks__chevron"
          aria-hidden
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.25 }}
        >
          +
        </motion.span>
      </motion.button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="mobile-tasks__section-body"
            initial={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: "hidden" }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MobileTasksPanel() {
  const { state } = useWorkspace();
  const actions = useWorkspaceActions();
  const [generating, setGenerating] = useState(false);
  const [open, setOpen] = useState<{ summary: boolean; decisions: boolean; actions: boolean }>({
    summary: false,
    decisions: false,
    actions: false,
  });

  const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

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
        <motion.button
          type="button"
          className="mobile-tasks__generate"
          onClick={handleGenerate}
          disabled={generating || !state.aiActive}
          whileTap={state.aiActive ? { scale: 0.985 } : undefined}
        >
          {generating ? "Summarizing…" : "Generate decisions & action items"}
        </motion.button>
      </section>
    );
  }

  return (
    <section className="mobile-tasks">
      <AccordionRow title="Meeting summary" open={open.summary} onToggle={() => toggle("summary")}>
        <p className="mobile-tasks__summary-text">{state.summary}</p>
      </AccordionRow>

      <AccordionRow title="Decisions" count={state.decisions.length} open={open.decisions} onToggle={() => toggle("decisions")}>
        <ul>
          {state.decisions.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </AccordionRow>

      <AccordionRow title="Action items" count={state.actionItems.length} open={open.actions} onToggle={() => toggle("actions")}>
        <ul>
          {state.actionItems.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </AccordionRow>

      <motion.button
        type="button"
        className="mobile-tasks__export"
        onClick={() => downloadMeetingIntelligencePack(state)}
        whileTap={{ scale: 0.97 }}
      >
        Export Meeting Intelligence Pack
      </motion.button>
    </section>
  );
}
