import { describe, expect, it } from 'vitest';
import { authorizationUrl, exchangeAuthorizationCode, validateRedirectUri } from '../src/oauth.js';
import { TEST_CONFIG, jsonResponse, queueFetch, requestHeader } from './helpers.js';

describe('user OAuth', () => {
  it('builds an authorization-code URL with the callback and CSRF state', () => {
    const value = new URL(
      authorizationUrl('global', 'client-id', 'http://127.0.0.1:8765/callback', 'random-state'),
    );
    expect(value.origin).toBe('https://www.warcraftlogs.com');
    expect(value.pathname).toBe('/oauth/authorize');
    expect(Object.fromEntries(value.searchParams)).toEqual({
      client_id: 'client-id',
      redirect_uri: 'http://127.0.0.1:8765/callback',
      response_type: 'code',
      state: 'random-state',
    });
  });

  it.each([
    'https://127.0.0.1/callback',
    'http://example.com/callback',
    'http://user@127.0.0.1/callback',
    'http://127.0.0.1:0/callback',
    'http://127.0.0.1:8765/callback#fragment',
    'not a URL',
  ])('rejects unsafe callback URI %s', (value) => {
    expect(() => validateRedirectUri(value)).toThrow();
  });

  it('exchanges a code without exposing the client secret in its result', async () => {
    const { fetcher, calls } = queueFetch([
      jsonResponse({ access_token: 'user-token', expires_in: 3_600 }),
    ]);
    const before = Date.now();
    const result = await exchangeAuthorizationCode(
      TEST_CONFIG,
      'global',
      'http://127.0.0.1:8765/callback',
      'authorization-code',
      fetcher,
    );

    expect(result.accessToken).toBe('user-token');
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3_599_000);
    expect(String(calls[0]?.input)).toBe('https://www.warcraftlogs.com/oauth/token');
    expect(requestHeader(calls[0], 'authorization')).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    );
    const body = calls[0]?.init?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    if (!(body instanceof URLSearchParams)) throw new Error('Expected URLSearchParams body');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('authorization-code');
    expect(JSON.stringify(result)).not.toContain('client-secret');
  });

  it('normalizes a rejected code without returning the OAuth response body', async () => {
    const { fetcher } = queueFetch([
      jsonResponse({ error: 'invalid_grant', secret_echo: 'must-not-leak' }, 400),
    ]);
    let thrown: unknown;
    try {
      await exchangeAuthorizationCode(
        TEST_CONFIG,
        'global',
        'http://127.0.0.1:8765/callback',
        'bad-code',
        fetcher,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'AUTH_FAILED', details: { status: 400 } });
    expect(JSON.stringify(thrown)).not.toContain('must-not-leak');
  });
});
