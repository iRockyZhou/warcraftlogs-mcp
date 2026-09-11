import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { DEFAULT_OAUTH_LOGIN_TIMEOUT_MS, WCL_ORIGINS, type WclRegion } from './constants.js';
import { assertCredentials } from './config.js';
import { WclError } from './errors.js';
import { saveUserToken } from './storage.js';
import type { FetchLike, WclConfig } from './types.js';

type OAuthTokenPayload = {
  access_token?: unknown;
  expires_in?: unknown;
};

function callbackHtml(message: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Warcraft Logs authorization</title><p>${message}</p><script>history.replaceState(null, '', '/authorization-complete')</script>`;
}

export function validateRedirectUri(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new WclError('CONFIG_ERROR', 'WCL_OAUTH_REDIRECT_URI must be a valid URL.', { cause });
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (
    url.protocol !== 'http:' ||
    !loopback ||
    url.username !== '' ||
    url.password !== '' ||
    url.port === '0' ||
    url.hash !== ''
  ) {
    throw new WclError(
      'CONFIG_ERROR',
      'The OAuth callback must be an http://127.0.0.1 or http://localhost URL without userinfo, port 0, or a fragment.',
    );
  }
  return url;
}

export function authorizationUrl(
  region: WclRegion,
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const url = new URL('/oauth/authorize', WCL_ORIGINS[region]);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.href;
}

export async function exchangeAuthorizationCode(
  config: WclConfig,
  region: WclRegion,
  redirectUri: string,
  code: string,
  fetcher: FetchLike = globalThis.fetch,
): Promise<{ accessToken: string; expiresAt?: number }> {
  assertCredentials(config);
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString(
    'base64',
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  let response: Response;
  try {
    response = await fetcher(`${WCL_ORIGINS[region]}/oauth/token`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (cause) {
    throw new WclError(
      controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      controller.signal.aborted
        ? 'Warcraft Logs user-token exchange timed out.'
        : 'Warcraft Logs user-token exchange failed.',
      { cause, retryable: true },
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new WclError('AUTH_FAILED', 'Warcraft Logs rejected the authorization code.', {
      details: { status: response.status },
    });
  }
  let payload: OAuthTokenPayload;
  try {
    payload = (await response.json()) as OAuthTokenPayload;
  } catch (cause) {
    throw new WclError('INVALID_RESPONSE', 'Warcraft Logs returned invalid OAuth JSON.', {
      cause,
    });
  }
  if (typeof payload.access_token !== 'string' || payload.access_token === '') {
    throw new WclError('INVALID_RESPONSE', 'Warcraft Logs returned no user access token.');
  }
  const expiresAt =
    typeof payload.expires_in === 'number' &&
    Number.isFinite(payload.expires_in) &&
    payload.expires_in > 0
      ? Date.now() + payload.expires_in * 1_000
      : undefined;
  return {
    accessToken: payload.access_token,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

export async function loginWithLocalCallback(
  config: WclConfig,
  region: WclRegion,
  redirectUriValue: string,
  onAuthorizationUrl: (url: string) => void,
): Promise<{ region: WclRegion; expiresAt: number | null; stateDirectory: string }> {
  assertCredentials(config);
  const redirectUri = validateRedirectUri(redirectUriValue);
  const loginTimeoutMs = config.oauthLoginTimeoutMs ?? DEFAULT_OAUTH_LOGIN_TIMEOUT_MS;
  const state = randomBytes(32).toString('base64url');
  const code = await new Promise<string>((resolve, reject) => {
    let finished = false;
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', redirectUri.origin);
      if (requestUrl.pathname !== redirectUri.pathname) {
        response.writeHead(404).end('Not found');
        return;
      }
      const returnedState = requestUrl.searchParams.get('state');
      const returnedCode = requestUrl.searchParams.get('code');
      const oauthError = requestUrl.searchParams.get('error');
      if (returnedState !== state) {
        response
          .writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          .end('Invalid OAuth state.');
        finish(new WclError('AUTH_FAILED', 'OAuth state validation failed.'));
        return;
      }
      if (oauthError !== null || returnedCode === null || returnedCode === '') {
        response
          .writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          .end('Warcraft Logs authorization was denied.');
        finish(new WclError('AUTH_FAILED', 'Warcraft Logs authorization was denied.'));
        return;
      }
      response
        .writeHead(200, {
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'",
          'content-type': 'text/html; charset=utf-8',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
        })
        .end(
          callbackHtml(
            'Warcraft Logs authorization was received. Return to the terminal while the secure token exchange completes; you can close this window.',
          ),
        );
      finish(undefined, returnedCode);
    });
    const timer = setTimeout(
      () =>
        finish(
          new WclError(
            'TIMEOUT',
            `OAuth login timed out after ${Math.round(loginTimeoutMs / 60_000)} minutes. Restart \`warcraftlogs-mcp auth login\` before authorizing again; an expired callback page will show connection refused.`,
          ),
        ),
      loginTimeoutMs,
    );
    const finish = (error?: Error, value?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      server.close();
      if (error !== undefined) reject(error);
      else resolve(value!);
    };
    server.once('error', (cause) => {
      finish(
        new WclError('NETWORK_ERROR', 'Could not start the local OAuth callback server.', {
          cause,
        }),
      );
    });
    server.listen(Number(redirectUri.port || '80'), redirectUri.hostname, () => {
      try {
        onAuthorizationUrl(authorizationUrl(region, config.clientId, redirectUri.href, state));
      } catch (cause) {
        finish(
          new WclError('CONFIG_ERROR', 'Could not display the OAuth authorization URL.', {
            cause,
          }),
        );
      }
    });
  });
  const token = await exchangeAuthorizationCode(config, region, redirectUri.href, code);
  await saveUserToken(config.stateDirectory, region, token);
  return { region, expiresAt: token.expiresAt ?? null, stateDirectory: config.stateDirectory };
}
