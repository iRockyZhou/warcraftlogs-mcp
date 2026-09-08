import { describe, expect, it } from 'vitest';
import { WclAuth } from '../src/auth.js';
import type { FetchLike } from '../src/types.js';
import { TEST_CONFIG, jsonResponse, queueFetch, requestHeader, tokenResponse } from './helpers.js';

describe('WclAuth', () => {
  it('caches a token in memory', async () => {
    const { fetcher, calls } = queueFetch([tokenResponse('cached')]);
    const auth = new WclAuth(TEST_CONFIG, fetcher, () => 1_000);

    await expect(auth.getToken('https://www.warcraftlogs.com')).resolves.toBe('cached');
    await expect(auth.getToken('https://www.warcraftlogs.com')).resolves.toBe('cached');
    expect(calls).toHaveLength(1);
    expect(requestHeader(calls[0], 'authorization')).toMatch(/^Basic /);
    expect(requestHeader(calls[0], 'authorization')).not.toContain('client-secret');
  });

  it('deduplicates concurrent token requests', async () => {
    let release: ((response: Response) => void) | undefined;
    let calls = 0;
    const fetcher: FetchLike = async () => {
      calls += 1;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    };
    const auth = new WclAuth(TEST_CONFIG, fetcher);
    const first = auth.getToken('https://cn.warcraftlogs.com');
    const second = auth.getToken('https://cn.warcraftlogs.com');
    release?.(jsonResponse({ access_token: 'shared', expires_in: 3600 }));

    await expect(Promise.all([first, second])).resolves.toEqual(['shared', 'shared']);
    expect(calls).toBe(1);
  });

  it('keeps origin token caches separate', async () => {
    const { fetcher, calls } = queueFetch([tokenResponse('global'), tokenResponse('cn')]);
    const auth = new WclAuth(TEST_CONFIG, fetcher);
    await auth.getToken('https://www.warcraftlogs.com');
    await auth.getToken('https://cn.warcraftlogs.com');
    expect(calls).toHaveLength(2);
  });

  it('retries transient OAuth failures with exponential backoff', async () => {
    const waits: number[] = [];
    const { fetcher, calls } = queueFetch([
      jsonResponse({}, 503),
      jsonResponse({}, 502),
      tokenResponse('recovered'),
    ]);
    const auth = new WclAuth(TEST_CONFIG, fetcher, Date.now, (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    });

    await expect(auth.getToken('https://www.warcraftlogs.com')).resolves.toBe('recovered');
    expect(waits).toEqual([250, 500]);
    expect(calls).toHaveLength(3);
  });

  it('honors a short OAuth Retry-After and normalizes a long one', async () => {
    const waits: number[] = [];
    const { fetcher } = queueFetch([
      jsonResponse({}, 429, { 'retry-after': '0.01' }),
      tokenResponse('after-wait'),
    ]);
    const auth = new WclAuth(TEST_CONFIG, fetcher, Date.now, (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    });
    await expect(auth.getToken('https://www.warcraftlogs.com')).resolves.toBe('after-wait');
    expect(waits).toEqual([10]);

    const limited = new WclAuth(
      TEST_CONFIG,
      queueFetch([jsonResponse({}, 429, { 'retry-after': '60' })]).fetcher,
    );
    await expect(limited.getToken('https://www.warcraftlogs.com')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterMs: 60_000 },
    });
  });
});
