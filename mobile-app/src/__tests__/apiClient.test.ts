import { apiGet, apiPost, apiPatch, apiDelete, ApiError, API_BASE } from '../services/api/client';

const mockFetch = jest.fn();
(globalThis as unknown as Record<string, unknown>).fetch = mockFetch;

function okJson(body: unknown, status = 200) {
  return Promise.resolve({
    ok: true,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

function errResponse(status: number, body = '') {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  } as unknown as Response);
}

beforeEach(() => mockFetch.mockReset());

describe('ApiError', () => {
  it('sets status and name', () => {
    const err = new ApiError(404, 'not found');
    expect(err.status).toBe(404);
    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('not found');
  });
});

describe('apiGet', () => {
  it('calls fetch with correct method and path', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ ok: true }));
    await apiGet('/items');
    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/items`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends Authorization header when token provided', async () => {
    mockFetch.mockResolvedValueOnce(okJson({}));
    await apiGet('/me', 'tok123');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer tok123');
  });

  it('includes X-Client header on every request', async () => {
    mockFetch.mockResolvedValueOnce(okJson({}));
    await apiGet('/check');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['X-Client']).toBe('setalink-mobile/1.0');
  });

  it('returns parsed JSON on 200', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ id: 42 }));
    const result = await apiGet<{ id: number }>('/resource');
    expect(result).toEqual({ id: 42 });
  });

  it('returns undefined on 204', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 204,
      json: () => Promise.reject(new Error('no body')),
      text: () => Promise.resolve(''),
    } as unknown as Response);
    const result = await apiGet('/noop');
    expect(result).toBeUndefined();
  });

  it('throws ApiError with correct status on 4xx', async () => {
    mockFetch.mockResolvedValueOnce(errResponse(404, '{"message":"not found"}'));
    await expect(apiGet('/missing')).rejects.toMatchObject({ status: 404, message: 'not found' });
  });

  it('throws ApiError on 500 with raw text fallback', async () => {
    mockFetch.mockResolvedValueOnce(errResponse(500, 'Internal Server Error'));
    await expect(apiGet('/boom')).rejects.toMatchObject({ status: 500, message: 'Internal Server Error' });
  });

  it('throws ApiError(408) when fetch is aborted', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortErr);
    await expect(apiGet('/slow')).rejects.toMatchObject({ status: 408 });
  });

  it('re-throws non-abort fetch errors', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('network failure'));
    await expect(apiGet('/flaky')).rejects.toThrow('network failure');
  });
});

describe('apiPost', () => {
  it('sends body as JSON', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ created: true }));
    await apiPost('/items', { name: 'test' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(JSON.stringify({ name: 'test' }));
  });
});

describe('apiPatch', () => {
  it('uses PATCH method', async () => {
    mockFetch.mockResolvedValueOnce(okJson({}));
    await apiPatch('/items/1', { name: 'updated' });
    expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
  });
});

describe('apiDelete', () => {
  it('uses DELETE method with no body', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.reject(), text: () => Promise.resolve('') } as unknown as Response);
    await apiDelete('/items/1', 'token');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('DELETE');
    expect(opts.body).toBeUndefined();
  });
});

describe('401 handling', () => {
  it('throws ApiError(401) with session-expired message', async () => {
    mockFetch.mockResolvedValueOnce(errResponse(401));
    await expect(apiGet('/secure', 'expired')).rejects.toMatchObject({
      status: 401,
      message: 'Session expired — please sign in again',
    });
  });
});
