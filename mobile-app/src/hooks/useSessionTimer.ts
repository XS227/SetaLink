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

export function useSessionTimer(running: boolean): string {
  const [elapsed, setElapsed] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      setElapsed(0);
      ref.current = setInterval(() => setElapsed(p => p + 1), 1000);
    } else {
      if (ref.current) { clearInterval(ref.current); ref.current = null; }
      setElapsed(0);
    }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [running]);

  return formatElapsed(elapsed);
}
