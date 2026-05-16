import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastEntry {
  id:       string;
  message:  string;
  type:     ToastType;
  duration: number; // ms
}

interface ToastState {
  current: ToastEntry | null;
  show:    (message: string, type?: ToastType, duration?: number) => void;
  dismiss: () => void;
}

let _timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  current: null,

  show: (message, type = 'info', duration = 3000) => {
    if (_timer) { clearTimeout(_timer); _timer = null; }

    const entry: ToastEntry = {
      id:      String(Date.now()),
      message,
      type,
      duration,
    };

    set({ current: entry });

    _timer = setTimeout(() => {
      set({ current: null });
      _timer = null;
    }, duration);
  },

  dismiss: () => {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    set({ current: null });
  },
}));
