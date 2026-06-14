import {
  sendMessage, listMessages, markMessageRead, DM_MAX_LEN,
} from '../services/entitlementService';

const mockFetch = jest.fn();
(globalThis as unknown as Record<string, unknown>).fetch = mockFetch;

function okJson(data: unknown) {
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ ok: true, data }),
  } as Response);
}

beforeEach(() => mockFetch.mockReset());

describe('direct message service (v0.9.33)', () => {
  it('sendMessage posts recipient + body to send-message', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ message_id: 7, recipient_user_id: 'SL-227-BOB00001', created_at: '2026-06-14 16:00:00' }));
    const res = await sendMessage('dev-alice', 'SL-227-BOB00001', 'hi');
    expect(res.message_id).toBe(7);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('action=send-message');
    // body travels as multipart FormData, not in the URL
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('listMessages maps snake_case rows to DirectMessage', async () => {
    mockFetch.mockResolvedValueOnce(okJson({
      messages: [
        { id: 2, direction: 'in', peer_user_id: 'SL-227-ALICE01', peer_device: 'dev-alice', body: 'سلام', read: false, created_at: '2026-06-14 16:01:00' },
        { id: 1, direction: 'out', peer_user_id: 'SL-227-BOB00001', peer_device: 'dev-bob', body: 'hi', read: true, created_at: '2026-06-14 16:00:00' },
      ],
      unread: 1,
    }));
    const msgs = await listMessages('dev-alice');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ id: 2, direction: 'in', peerUserId: 'SL-227-ALICE01', body: 'سلام', read: false });
    expect(msgs[1].direction).toBe('out');
  });

  it('listMessages tolerates a missing messages array', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ unread: 0 }));
    await expect(listMessages('dev-x')).resolves.toEqual([]);
  });

  it('markMessageRead posts the message id', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ updated: true }));
    await markMessageRead('dev-alice', 42);
    expect(mockFetch.mock.calls[0][0]).toContain('action=mark-message-read');
  });

  it('exposes the shared max length', () => {
    expect(DM_MAX_LEN).toBe(2000);
  });
});
