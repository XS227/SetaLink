import { useCallback, useEffect, useRef, useState } from "react";

export type ScreenShareStatus = "idle" | "requesting" | "active" | "denied" | "error";

/**
 * Real browser screen sharing via navigator.mediaDevices.getDisplayMedia().
 * Per the brief: explicit permission each time, a way to stop it, and
 * handling both permission denial and the user ending the share from the
 * browser's own "Stop sharing" control — never captures without consent.
 */
export function useScreenShare() {
  const [status, setStatus] = useState<ScreenShareStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("error");
      return;
    }
    setStatus("requesting");
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = captured;
      setStream(captured);
      setStatus("active");

      // The user can end sharing from the browser's own UI (not our stop
      // button) — the video track's `ended` event is how we find out.
      const [videoTrack] = captured.getVideoTracks();
      videoTrack?.addEventListener("ended", () => {
        streamRef.current = null;
        setStream(null);
        setStatus("idle");
      });
    } catch (err) {
      // NotAllowedError covers both an explicit "Cancel" and OS/browser-level denial.
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setStatus("denied");
      } else {
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { status, stream, start, stop };
}
