import { useState, useEffect, useRef } from 'react';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// When startedAt is provided the timer derives elapsed from wall clock,
// so it survives screen unmounts and re-mounts correctly.
export function useSessionTimer(running: boolean, startedAt?: number | null): string {
  const [tick, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      setTick(0);
      intervalRef.current = setInterval(() => setTick((n) => n + 1), 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  if (!running) return '00:00:00';

  const totalSeconds = startedAt
    ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    : tick;

  return formatElapsed(totalSeconds);
}
