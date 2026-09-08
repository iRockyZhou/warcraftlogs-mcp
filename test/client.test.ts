import { describe, expect, it } from 'vitest';
import { WclClient } from '../src/client.js';
import { WclError } from '../src/errors.js';
import { TEST_CONFIG, jsonResponse, queueFetch, requestHeader, tokenResponse } from './helpers.js';

const ORIGIN = 'https://www.warcraftlogs.com' as const;

describe('WclClient', () => {
  it('refreshes once after a 401', async () => {
    const { fetcher, calls } = queueFetch([
      tokenResponse('old-token'),
      jsonResponse({}, 401),
      tokenResponse('new-token'),
      jsonResponse({ data: { ok: true } }),
    ]);
    const client = new WclClient(TEST_CONFIG, { fetcher, sleep: () => Promise.resolve() });

    await expect(client.query(ORIGIN, 'query Test { ok }', {})).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(4);
    expect(requestHeader(calls[1], 'authorization')).toBe('Bearer old-token');
    expect(requestHeader(calls[3], 'authorization')).toBe('Bearer new-token');
  });

  it('waits once for a short Retry-After then succeeds', async () => {
    const waits: number[] = [];
    const { fetcher } = queueFetch([
      tokenResponse(),
      jsonResponse({}, 429, { 'retry-after': '0.01' }),
      jsonResponse({ data: { ok: true } }),
    ]);
    const client = new WclClient(TEST_CONFIG, {
      fetcher,
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
    });
    await expect(client.query(ORIGIN, 'query Test { ok }', {})).resolves.toEqual({ ok: true });
    expect(waits).toEqual([10]);
  });

  it('fails quickly for a long Retry-After', async () => {
    const { fetcher } = queueFetch([
      tokenResponse(),
      jsonResponse({}, 429, { 'retry-after': '60' }),
    ]);
    const client = new WclClient(TEST_CONFIG, { fetcher, sleep: () => Promise.resolve() });
    await expect(client.query(ORIGIN, 'query Test { ok }', {})).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterMs: 60_000 },
    });
  });

  it('retries 5xx with exponential backoff', async () => {
    const waits: number[] = [];
    const { fetcher } = queueFetch([
      tokenResponse(),
      jsonResponse({}, 503),
      jsonResponse({}, 502),
      jsonResponse({ data: { ok: true } }),
    ]);
    const client = new WclClient(TEST_CONFIG, {
      fetcher,
      sleep: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
    });
    await expect(client.query(ORIGIN, 'query Test { ok }', {})).resolves.toEqual({ ok: true });
    expect(waits).toEqual([250, 500]);
  });

  it('normalizes GraphQL errors without leaking requests or credentials', async () => {
    const { fetcher } = queueFetch([
      tokenResponse(),
      jsonResponse({
        data: null,
        errors: [
          {
            message: 'Unknown report',
            path: ['reportData', 'report'],
            extensions: { category: 'validation' },
          },
        ],
      }),
    ]);
    const client = new WclClient(TEST_CONFIG, { fetcher });
    let thrown: unknown;
    try {
      await client.query(ORIGIN, 'query Secret { report }', { secret: 'do-not-leak' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WclError);
    expect(thrown).toMatchObject({
      code: 'GRAPHQL_ERROR',
      details: { errors: [{ message: 'Unknown report' }] },
    });
    expect(JSON.stringify(thrown)).not.toContain('do-not-leak');
  });

  it.each([
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ])('normalizes HTTP %i responses as %s', async (status, code) => {
    const { fetcher } = queueFetch([tokenResponse(), jsonResponse({}, status)]);
    const client = new WclClient(TEST_CONFIG, { fetcher });
    await expect(client.query(ORIGIN, 'query Test { ok }', {})).rejects.toMatchObject({ code });
  });

  it('times out a stalled GraphQL request after retries are exhausted', async () => {
    let calls = 0;
    const fetcher = (_input: string | URL, init?: RequestInit): Promise<Response> => {
      calls += 1;
      if (calls === 1) return Promise.resolve(tokenResponse());
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    };
    const client = new WclClient(
      { ...TEST_CONFIG, requestTimeoutMs: 1, maxRetries: 0 },
      { fetcher },
    );
    await expect(client.query(ORIGIN, 'query Test { ok }', {})).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });
});
