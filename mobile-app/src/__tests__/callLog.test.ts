import { parseCallLogBody, buildCallLog } from '../utils/callLog';
import { buildConversations } from '../utils/unifiedThreads';
import { DEFAULT_PEER_BADGE, type DirectMessage } from '../services/entitlementService';

const dm = (o: Partial<DirectMessage>): DirectMessage => ({
  id: 1, direction: 'out', peerUserId: 'SL-A', peerDevice: 'dev-a', body: 'hi', read: true,
  createdAt: '2026-10-24 10:00:00', expireSecs: 0, expiresAt: null, peerBadge: DEFAULT_PEER_BADGE, ...o,
});

describe('callLog.parseCallLogBody', () => {
  it('recognises the call-log bodies CallScreen writes, in every app language', () => {
    expect(parseCallLogBody('Missed call')).toEqual({ kind: 'missed' });
    expect(parseCallLogBody('Audio call · 2:05')).toEqual({ kind: 'audio', duration: '2:05' });
    expect(parseCallLogBody('Video call · 0:41')).toEqual({ kind: 'video', duration: '0:41' });
    expect(parseCallLogBody('تماس بی‌پاسخ')).toEqual({ kind: 'missed' });
    expect(parseCallLogBody('تماس تصویری · 1:00')).toEqual({ kind: 'video', duration: '1:00' });
    expect(parseCallLogBody('语音通话 · 3:10')).toEqual({ kind: 'audio', duration: '3:10' });
    expect(parseCallLogBody('Пропущенный звонок')).toEqual({ kind: 'missed' });
  });

  it('ignores ordinary messages that merely mention a call', () => {
    expect(parseCallLogBody('Missed call earlier, sorry!')).toBeNull();
    expect(parseCallLogBody('call me')).toBeNull();
    expect(parseCallLogBody('')).toBeNull();
  });
});

describe('callLog.buildCallLog', () => {
  it('lists only call-log messages from DM threads, newest first, with direction', () => {
    const convos = buildConversations([
      dm({ id: 1, body: 'hello', createdAt: '2026-10-24 09:00:00' }),
      dm({ id: 2, body: 'Missed call', createdAt: '2026-10-24 09:05:00' }),
      dm({ id: 3, direction: 'in', peerUserId: 'SL-B', peerDevice: 'dev-b', body: 'Video call · 0:41', createdAt: '2026-10-24 11:00:00' }),
    ], [], 'Support');
    const log = buildCallLog(convos);
    expect(log.map((e) => [e.kind, e.direction, e.conversation.peerDevice])).toEqual([
      ['video', 'in', 'dev-b'],
      ['missed', 'out', 'dev-a'],
    ]);
    expect(log[0]!.duration).toBe('0:41');
  });

  it('never includes the Support thread', () => {
    const convos = buildConversations([], [], 'Support');
    expect(buildCallLog(convos)).toEqual([]);
  });
});
