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
  show:    (message: string, type?: ToastType, duration?: number, bypassScreenShareSuppression?: boolean) => void;
  dismiss: () => void;
}

let _timer: ReturnType<typeof setTimeout> | null = null;

// Screen-share privacy (spec §6): "ikke vise lokale RealGram-varsler over
// sensitivt innhold dersom dette kan skjules sikkert" -- an ordinary toast
// (DM preview, etc.) IS captured by the screen recorder same as anything
// else on screen, and suppressing it costs nothing (it can always be
// re-read once sharing stops), so default to safe. Module-level, not
// store state -- CallEngine (not a React component) is what actually
// knows when sharing starts/stops, via setScreenSharingActive() below.
let _screenSharingActive = false;
export function setScreenSharingActive(active: boolean): void {
  _screenSharingActive = active;
}

export const useToastStore = create<ToastState>((set) => ({
  current: null,

  show: (message, type = 'info', duration = 3000, bypassScreenShareSuppression = false) => {
    // The screen-share feature's OWN status toasts (emergency camera-stop,
    // start/stop errors) must always show regardless -- this suppression
    // is for incidental content (DM previews etc.), not for telling the
    // user about screen sharing itself.
    if (_screenSharingActive && !bypassScreenShareSuppression) return;
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
