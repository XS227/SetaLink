import { allLocaleStrings } from '../i18n';
import type { Conversation } from './unifiedThreads';

/**
 * Calls tab history (Gold After Dark, v0.9.153). There is no separate call
 * history API: CallScreen already writes one DM into the thread when an
 * outgoing call ends ("Missed call" / "Audio call · 2:05" / "Video call ·
 * 0:41", in the caller's own language). Both sides see that message, so the
 * thread itself is the real call log — this just reads it back out.
 */
export type CallLogKind = 'missed' | 'audio' | 'video';

export interface CallLogEntry {
  key:          string;
  conversation: Conversation;
  /** 'out' = this device placed the call (it wrote the log message). */
  direction:    'in' | 'out';
  kind:         CallLogKind;
  duration?:    string;
  createdAt:    string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templates(key: 'call.logMissed' | 'call.logAudio' | 'call.logVideo'): RegExp[] {
  return allLocaleStrings(key).map((tpl) =>
    new RegExp('^' + escapeRegex(tpl).replace('\\{duration\\}', '(.+)') + '$'));
}

let PATTERNS: Array<{ kind: CallLogKind; res: RegExp[] }> | null = null;
function patterns() {
  if (!PATTERNS) {
    PATTERNS = [
      { kind: 'missed', res: templates('call.logMissed') },
      { kind: 'audio',  res: templates('call.logAudio') },
      { kind: 'video',  res: templates('call.logVideo') },
    ];
  }
  return PATTERNS;
}

export function parseCallLogBody(body: string): { kind: CallLogKind; duration?: string } | null {
  const text = body.trim();
  for (const { kind, res } of patterns()) {
    for (const re of res) {
      const m = re.exec(text);
      if (m) return m[1] ? { kind, duration: m[1] } : { kind };
    }
  }
  return null;
}

export function buildCallLog(conversations: Conversation[], limit = 100): CallLogEntry[] {
  const out: CallLogEntry[] = [];
  for (const c of conversations) {
    if (c.support || c.kind !== 'dm') continue;
    for (const m of c.messages) {
      const parsed = parseCallLogBody(m.body);
      if (!parsed) continue;
      out.push({
        key: `${c.key}-${m.key}`, conversation: c, direction: m.direction,
        kind: parsed.kind, duration: parsed.duration, createdAt: m.createdAt,
      });
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out.slice(0, limit);
}
