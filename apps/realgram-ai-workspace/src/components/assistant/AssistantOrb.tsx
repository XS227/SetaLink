import { motion, useReducedMotion } from "framer-motion";
import type { AssistantActivity } from "../../state/workspaceStore";

const LOOP: Record<AssistantActivity, { scale: number[]; duration: number } | null> = {
  idle: { scale: [1, 1.08, 1], duration: 3.2 },
  thinking: { scale: [1, 1.16, 1], duration: 0.9 },
  pointing: null, // the orb has "left" — shown hollow/dormant until it returns
};

export function AssistantOrb({ activity, dormant, size = 40 }: { activity: AssistantActivity; dormant: boolean; size?: number }) {
  const reduceMotion = useReducedMotion();
  const loop = dormant ? null : LOOP[activity];

  return (
    <div className="assistant-orb" style={{ width: size, height: size }} aria-hidden>
      <motion.span
        className={`assistant-orb__core ${dormant ? "assistant-orb__core--dormant" : ""} assistant-orb__core--${activity}`}
        animate={!reduceMotion && loop ? { scale: loop.scale } : undefined}
        transition={loop ? { duration: loop.duration, repeat: Infinity, ease: "easeInOut" } : undefined}
      />
      {!dormant && <span className="assistant-orb__halo" />}
    </div>
  );
}
