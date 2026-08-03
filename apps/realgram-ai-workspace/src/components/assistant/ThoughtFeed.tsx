import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { FeedEntry } from "../../state/workspaceStore";

export function ThoughtFeed({ entries }: { entries: FeedEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="thought-feed thought-feed--empty">
        <p>Real AI is listening. Ask it anything about this meeting, or watch it think out loud as things happen.</p>
      </div>
    );
  }

  return (
    <div className="thought-feed">
      {entries.map((entry) =>
        entry.kind === "qa" ? (
          <div key={entry.id} className="feed-exchange">
            <motion.p
              className="feed-bubble feed-bubble--you"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {entry.question}
            </motion.p>
            <motion.p
              className="feed-bubble feed-bubble--ai"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              {entry.answer}
            </motion.p>
          </div>
        ) : entry.kind === "notice" ? (
          <motion.p
            key={entry.id}
            className="feed-bubble feed-bubble--notice"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <span className="feed-bubble__glyph" aria-hidden>
              ⟡
            </span>
            {entry.text}
          </motion.p>
        ) : (
          <motion.div
            key={entry.id}
            className="feed-bubble feed-bubble--shared-asset"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <img src={entry.imageUrl} alt={entry.prompt} className="feed-bubble__thumb" />
            <span>Shared to the meeting: {entry.prompt}</span>
          </motion.div>
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}
