import { WclAuth } from './auth.js';
import type { WclOrigin } from './constants.js';
import { WclError, jsonDetail } from './errors.js';
import { defaultSleep, parseRetryAfter } from './retry.js';
import type { FetchLike, GraphqlErrorItem, JsonObject, Sleep, WclConfig } from './types.js';

function graphqlErrorDetails(errors: GraphqlErrorItem[]): JsonObject {
  return {
    errors: errors.map((error) => ({
      message: error.message,
      ...(error.path === undefined ? {} : { path: error.path }),
      ...(error.extensions === undefined ? {} : { extensions: jsonDetail(error.extensions) }),
    })),
  };
}

function isGraphqlErrorItem(value: unknown): value is GraphqlErrorItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

export type WclClientOptions = {
  fetcher?: FetchLike;
  sleep?: Sleep;
  now?: () => number;
  auth?: WclAuth;
};

export class WclClient {
  readonly auth: WclAuth;
  private readonly fetcher: FetchLike;
  private readonly sleep: Sleep;
  private readonly now: () => number;

  constructor(
    private readonly config: WclConfig,
    options: WclClientOptions = {},
  ) {
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.auth = options.auth ?? new WclAuth(config, this.fetcher, this.now, this.sleep);
  }

  async query(
    origin: WclOrigin,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<unknown> {
    let token = await this.auth.getToken(origin);
    let refreshed = false;
    let transientRetries = 0;
    let rateLimitRetried = false;

    for (;;) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      let response: Response;
      try {
        response = await this.fetcher(`${origin}/api/v2/client`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'user-agent': 'warcraftlogs-mcp/0.1.0',
          },
          body: JSON.stringify({ query, variables }),
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
          throw new WclError('TIMEOUT', 'Warcraft Logs API request timed out.', {
            cause: error,
            retryable: true,
          });
        }
        throw new WclError('NETWORK_ERROR', 'Warcraft Logs API request failed.', {
          cause: error,
          retryable: true,
        });
      }
      clearTimeout(timeout);

      if (response.status === 401) {
        if (refreshed) {
          throw new WclError('AUTH_FAILED', 'Warcraft Logs rejected the refreshed access token.', {
            details: { status: 401 },
          });
        }
        this.auth.invalidate(origin, token);
        token = await this.auth.getToken(origin, true);
        refreshed = true;
        continue;
      }

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
        throw new WclError('RATE_LIMITED', 'Warcraft Logs rate limit was reached.', {
          details: { retryAfterMs },
          retryable: true,
        });
      }

      if (response.status === 403) {
        throw new WclError('FORBIDDEN', 'Warcraft Logs denied access to this resource.', {
          details: { status: 403 },
        });
      }
      if (response.status === 404) {
        throw new WclError('NOT_FOUND', 'Warcraft Logs API endpoint or resource was not found.', {
          details: { status: 404 },
        });
      }
      if (response.status >= 500) {
        if (transientRetries < this.config.maxRetries) {
          await this.sleep(250 * 2 ** transientRetries);
          transientRetries += 1;
          continue;
        }
        throw new WclError('SERVER_ERROR', 'Warcraft Logs API is temporarily unavailable.', {
          details: { status: response.status },
          retryable: true,
        });
      }
      if (!response.ok) {
        throw new WclError('INVALID_RESPONSE', 'Warcraft Logs API returned an unexpected status.', {
          details: { status: response.status },
        });
      }

      let envelope: unknown;
      try {
        envelope = await response.json();
      } catch (cause) {
        throw new WclError('INVALID_RESPONSE', 'Warcraft Logs API returned invalid JSON.', {
          cause,
        });
      }

      if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
        throw new WclError('INVALID_RESPONSE', 'Warcraft Logs GraphQL response was not an object.');
      }
      const errorsValue = 'errors' in envelope ? envelope.errors : undefined;
      if (Array.isArray(errorsValue) && errorsValue.length > 0) {
        const errors = errorsValue.filter(isGraphqlErrorItem);
        throw new WclError('GRAPHQL_ERROR', 'Warcraft Logs GraphQL query failed.', {
          details: graphqlErrorDetails(errors),
        });
      }
      const data = 'data' in envelope ? envelope.data : undefined;
      if (data === undefined || data === null) {
        throw new WclError('INVALID_RESPONSE', 'Warcraft Logs GraphQL response contained no data.');
      }
      return data;
    }
  }
}

export { parseRetryAfter } from './retry.js';
