import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { storage } from '../storage/storage';

export interface SessionRecord {
  id:         string;
  serverId:   string;
  serverName: string;
  serverFlag: string;
  protocol:   string;
  startedAt:  number;  // unix ms
  endedAt:    number;  // unix ms
  duration:   number;  // seconds
  sentBytes:  number;
  recvBytes:  number;
  status:     'success' | 'dropped' | 'timeout';
}

type NewSession = Omit<SessionRecord, 'id'>;

interface SessionState {
  sessions: SessionRecord[];

  addSession:   (s: NewSession) => void;
  clearHistory: () => void;

  // Selectors
  sessionsToday:        () => SessionRecord[];
  sessionsThisMonth:    () => SessionRecord[];
  totalBytesToday:      () => number;
  totalBytesThisMonth:  () => number;
  totalDurationToday:   () => number;  // seconds
  hourlyDownload:       () => number[]; // 24 values (MB per hour, today)
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const MAX_SESSIONS = 100;

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],

      addSession: (s) => set((state) => {
        const record: SessionRecord = { ...s, id: String(Date.now()) };
        const next = [record, ...state.sessions].slice(0, MAX_SESSIONS);
        return { sessions: next };
      }),

      clearHistory: () => set({ sessions: [] }),

      sessionsToday: () => {
        const cutoff = startOfDay(Date.now());
        return get().sessions.filter((s) => s.startedAt >= cutoff);
      },

      sessionsThisMonth: () => {
        const cutoff = startOfMonth(Date.now());
        return get().sessions.filter((s) => s.startedAt >= cutoff);
      },

      totalBytesToday: () =>
        get().sessionsToday().reduce((sum, s) => sum + s.sentBytes + s.recvBytes, 0),

      totalBytesThisMonth: () =>
        get().sessionsThisMonth().reduce((sum, s) => sum + s.sentBytes + s.recvBytes, 0),

      totalDurationToday: () =>
        get().sessionsToday().reduce((sum, s) => sum + s.duration, 0),

      hourlyDownload: () => {
        const bins = new Array<number>(24).fill(0);
        const todaySessions = get().sessionsToday();
        const dayStart = startOfDay(Date.now());

        for (const session of todaySessions) {
          const startHour = Math.floor((session.startedAt - dayStart) / 3_600_000);
          const endHour   = Math.floor((session.endedAt   - dayStart) / 3_600_000);

          for (let h = Math.max(0, startHour); h <= Math.min(23, endHour); h++) {
            bins[h] += session.recvBytes / 1_000_000; // MB
          }
        }
        return bins;
      },
    }),
    {
      name:    'setalink-sessions',
      storage: createJSONStorage(() => storage),
    }
  )
);
