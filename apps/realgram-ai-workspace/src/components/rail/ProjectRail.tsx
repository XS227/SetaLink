import { useState } from "react";
import { motion } from "framer-motion";
import { RealGramLogo } from "../RealGramLogo";
import { useWorkspace } from "../../state/workspaceStore";
import { RailMeeting } from "./RailMeeting";
import { RailFiles } from "./RailFiles";
import { RailTasks } from "./RailTasks";

const ICONS = [
  { key: "meeting", glyph: "◐", label: "Meeting" },
  { key: "files", glyph: "▢", label: "Files" },
  { key: "tasks", glyph: "✓", label: "Tasks" },
] as const;

/** The project rail — meeting control, files, tasks. Collapses to a slim
 * icon strip so the stage stays the dominant surface by default. */
export function ProjectRail() {
  const { state } = useWorkspace();
  const [expanded, setExpanded] = useState(true);

  return (
    <motion.nav
      className={`rail ${expanded ? "rail--expanded" : "rail--collapsed"}`}
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      aria-label="Project"
    >
      <div className="rail__brand">
        <RealGramLogo size={22} />
        {expanded && (
          <span className="rail__wordmark">
            RealGram <span className="rail__wordmark-feature">AI Workspace</span>
          </span>
        )}
        <button
          type="button"
          className="rail__collapse-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse project rail" : "Expand project rail"}
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "‹" : "›"}
        </button>
      </div>

      {expanded ? (
        <div className="rail__body">
          <RailMeeting />
          <RailFiles jobs={state.generationJobs} />
          <RailTasks />
        </div>
      ) : (
        <div className="rail__icons">
          {ICONS.map((icon) => (
            <button
              key={icon.key}
              type="button"
              className="rail__icon"
              onClick={() => setExpanded(true)}
              title={icon.label}
              aria-label={icon.label}
            >
              <span aria-hidden>{icon.glyph}</span>
            </button>
          ))}
        </div>
      )}
    </motion.nav>
  );
}
