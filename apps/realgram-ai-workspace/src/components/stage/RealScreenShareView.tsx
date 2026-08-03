import { useEffect, useRef } from "react";

export function RealScreenShareView({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return <video ref={videoRef} className="real-screen-share" autoPlay muted playsInline />;
}
