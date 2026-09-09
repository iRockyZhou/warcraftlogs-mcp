import { PACKAGE_VERSION, TOKEN_EXPIRY_SKEW_MS, type WclOrigin } from './constants.js';
import { assertCredentials } from './config.js';
import { WclError } from './errors.js';
import { defaultSleep, parseRetryAfter } from './retry.js';
import type { FetchLike, Sleep, WclConfig } from './types.js';

type CachedToken = { value: string; expiresAt: number };
type TokenPayload = { access_token?: unknown; expires_in?: unknown };

export class WclAuth {
  private readonly cache = new Map<WclOrigin, CachedToken>();
  private readonly inflight = new Map<WclOrigin, Promise<string>>();

  constructor(
    private readonly config: WclConfig,
    private readonly fetcher: FetchLike = globalThis.fetch,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = defaultSleep,
  ) {}

  async getToken(origin: WclOrigin, forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = this.cache.get(origin);
      if (cached !== undefined && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > this.now()) {
        return cached.value;
      }
      const active = this.inflight.get(origin);
      if (active !== undefined) return active;
    } else {
      this.cache.delete(origin);
    }

    const active = this.inflight.get(origin);
    if (active !== undefined) return active;
    const request = this.requestToken(origin).finally(() => this.inflight.delete(origin));
    this.inflight.set(origin, request);
    return request;
  }

  invalidate(origin: WclOrigin, usedToken?: string): void {
    const cached = this.cache.get(origin);
    if (usedToken === undefined || cached?.value === usedToken) this.cache.delete(origin);
  }

  private async requestToken(origin: WclOrigin): Promise<string> {
    assertCredentials(this.config);
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
      'utf8',
    ).toString('base64');
    let transientRetries = 0;
    let rateLimitRetried = false;

    for (;;) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      let response: Response;
      try {
        response = await this.fetcher(`${origin}/oauth/token`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Basic ${credentials}`,
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': `warcraftlogs-mcp/${PACKAGE_VERSION}`,
          },
          body: new URLSearchParams({ grant_type: 'client_credentials' }),
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeout);
        if (transientRetries < this.config.maxRetries) {
          await this.sleep(250 * 2 ** transientRetries);
          transientRetries += 1;
          continue;
        }
        if (controller.signal.aborted) {
          throw new WclError('TIMEOUT', 'Warcraft Logs OAuth request timed out.', {
            cause: error,
            retryable: true,
          });
        }
        throw new WclError('NETWORK_ERROR', 'Warcraft Logs OAuth request failed.', {
          cause: error,
          retryable: true,
        });
      }
      clearTimeout(timeout);

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.now());
        if (
          !rateLimitRetried &&
          retryAfterMs !== null &&
          retryAfterMs <= this.config.maxRetryAfterMs
        ) {
          rateLimitRetried = true;
          await this.sleep(retryAfterMs);
          continue;
        }
        throw new WclError('RATE_LIMITED', 'Warcraft Logs OAuth rate limit was reached.', {
          details: { retryAfterMs },
          retryable: true,
        });
      }
      if (response.status >= 500) {
        if (transientRetries < this.config.maxRetries) {
          await this.sleep(250 * 2 ** transientRetries);
          transientRetries += 1;
          continue;
        }
        throw new WclError('SERVER_ERROR', 'Warcraft Logs OAuth is temporarily unavailable.', {
          details: { status: response.status },
          retryable: true,
        });
      }
      if (!response.ok) {
        throw new WclError('AUTH_FAILED', 'Warcraft Logs OAuth rejected the credentials.', {
          details: { status: response.status },
        });
      }

      let payload: TokenPayload;
      try {
        const value: unknown = await response.json();
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new TypeError('OAuth response was not an object.');
        }
        payload = value;
      } catch (cause) {
        throw new WclError('INVALID_RESPONSE', 'Warcraft Logs OAuth returned invalid JSON.', {
          cause,
        });
      }
      if (typeof payload.access_token !== 'string' || payload.access_token === '') {
        throw new WclError('INVALID_RESPONSE', 'Warcraft Logs OAuth returned no access token.');
      }
      const expiresIn =
        typeof payload.expires_in === 'number' &&
        Number.isFinite(payload.expires_in) &&
        payload.expires_in > 0
          ? payload.expires_in
          : 3_600;
      this.cache.set(origin, {
        value: payload.access_token,
        expiresAt: this.now() + expiresIn * 1_000,
      });
      return payload.access_token;
    }
  }
}
