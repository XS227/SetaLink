import type { DemoParticipant } from "../../types/api";

export function ParticipantPill({ participant, micOn = true }: { participant: DemoParticipant; micOn?: boolean }) {
  return (
    <div className="participant-pill" title={participant.name}>
      {participant.videoOn ? (
        <div className="participant-pill__video" aria-hidden />
      ) : (
        <span className="participant-pill__initials">{participant.initials}</span>
      )}
      {!micOn && <span className="participant-pill__muted" aria-label="Muted" />}
    </div>
  );
}
