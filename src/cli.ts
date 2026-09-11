#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { PACKAGE_NAME, PACKAGE_VERSION } from './constants.js';
import { loadConfig } from './config.js';
import { errorToJson } from './errors.js';
import { createServer } from './server.js';
import { WclService } from './service.js';
import { loginWithLocalCallback } from './oauth.js';
import { loadStoredAuth, removeUserToken } from './storage.js';
import { resolveReportReference } from './url.js';

const HELP = `${PACKAGE_NAME} ${PACKAGE_VERSION}

Usage:
  warcraftlogs-mcp                 Start the MCP server over stdio
  warcraftlogs-mcp serve           Start the MCP server over stdio
  warcraftlogs-mcp doctor [report] Check configuration and WCL connectivity
  warcraftlogs-mcp auth login [global|cn] [redirect-uri]
                                   Authorize access to private reports
  warcraftlogs-mcp auth status     Show user-authorization status
  warcraftlogs-mcp auth logout [global|cn]
                                   Remove a stored user access token
  warcraftlogs-mcp --help          Show this help
  warcraftlogs-mcp --version       Show the version

Environment:
  WCL_CLIENT_ID                    Warcraft Logs OAuth client ID
  WCL_CLIENT_SECRET                Warcraft Logs OAuth client secret
  WCL_USER_ACCESS_TOKEN            Optional global-site user access token
  WCL_CN_USER_ACCESS_TOKEN         Optional CN-site user access token
  WCL_OAUTH_REDIRECT_URI           Local OAuth callback (default: http://127.0.0.1:8765/callback)
  WCL_OAUTH_LOGIN_TIMEOUT_MS       Interactive login wait (default: 900000)
  WCL_STATE_DIR                    Token, active-character, and subscription directory
  WCL_REQUEST_TIMEOUT_MS           Request timeout (default: 15000)
  WCL_MAX_RETRIES                  Transient retry count (default: 2)
  WCL_MAX_RETRY_AFTER_MS           Longest 429 delay to wait (default: 2000)
`;

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function nodeMajor(): number {
  return Number(process.versions.node.split('.')[0]);
}

async function runDoctor(reportInput?: string): Promise<number> {
  const config = loadConfig();
  const checks: Record<string, unknown> = {
    node: {
      ok: nodeMajor() >= 20,
      version: process.versions.node,
      required: '>=20',
    },
    credentials: {
      ok: config.clientId !== undefined && config.clientSecret !== undefined,
      clientIdConfigured: config.clientId !== undefined,
      clientSecretConfigured: config.clientSecret !== undefined,
    },
    userAuthorization: {
      globalConfigured: config.userAccessTokens.global !== undefined,
      cnConfigured: config.userAccessTokens.cn !== undefined,
    },
  };

  if (config.clientId === undefined || config.clientSecret === undefined) {
    writeJson({ ok: false, checks, message: 'Configure WCL_CLIENT_ID and WCL_CLIENT_SECRET.' });
    return 1;
  }

  const service = WclService.fromConfig(config);
  try {
    const publicRegion =
      reportInput === undefined ? 'global' : resolveReportReference(reportInput).region;
    checks['connectivity'] = await service.doctor(publicRegion, 'public');
    const userConnectivity: Record<string, unknown> = {};
    for (const region of ['global', 'cn'] as const) {
      if (config.userAccessTokens[region] === undefined) continue;
      try {
        userConnectivity[region] = await service.doctor(region, 'user');
      } catch (error) {
        userConnectivity[region] = { ok: false, error: errorToJson(error) };
      }
    }
    if (Object.keys(userConnectivity).length > 0) checks['userConnectivity'] = userConnectivity;
    if (reportInput === undefined) {
      // Public and configured user endpoints were checked above.
    } else {
      checks['report'] = await service.getReport(reportInput);
    }
    const userConnectivityOk = Object.values(userConnectivity).every(
      (value) => typeof value === 'object' && value !== null && 'ok' in value && value.ok === true,
    );
    writeJson({ ok: userConnectivityOk, checks });
    return userConnectivityOk ? 0 : 1;
  } catch (error) {
    checks['connectivity'] = { ok: false, error: errorToJson(error) };
    writeJson({ ok: false, checks });
    return 1;
  }
}

async function runAuth(args: string[]): Promise<number> {
  const [action = 'status', regionInput = 'global', redirectInput, ...extra] = args;
  if (regionInput !== 'global' && regionInput !== 'cn') {
    process.stderr.write('OAuth region must be global or cn.\n');
    return 2;
  }
  if (extra.length > 0) {
    process.stderr.write('Too many auth arguments.\n');
    return 2;
  }
  const config = loadConfig();
  if (action === 'status') {
    if (args.length > 1) {
      process.stderr.write('auth status accepts no region or redirect URI.\n');
      return 2;
    }
    const stored = loadStoredAuth(config.stateDirectory);
    writeJson({
      stateDirectory: config.stateDirectory,
      global: {
        configured: config.userAccessTokens.global !== undefined,
        stored: stored.tokens.global !== undefined,
        expiresAt: stored.tokens.global?.expiresAt ?? null,
      },
      cn: {
        configured: config.userAccessTokens.cn !== undefined,
        stored: stored.tokens.cn !== undefined,
        expiresAt: stored.tokens.cn?.expiresAt ?? null,
      },
    });
    return 0;
  }
  if (action === 'logout') {
    if (redirectInput !== undefined) {
      process.stderr.write('auth logout accepts at most one region.\n');
      return 2;
    }
    const removed = await removeUserToken(config.stateDirectory, regionInput);
    writeJson({ removed, region: regionInput, stateDirectory: config.stateDirectory });
    return 0;
  }
  if (action === 'login') {
    const redirectUri =
      redirectInput ?? process.env['WCL_OAUTH_REDIRECT_URI'] ?? 'http://127.0.0.1:8765/callback';
    const result = await loginWithLocalCallback(config, regionInput, redirectUri, (url) => {
      process.stdout.write(`Open this URL in your browser to authorize private reports:\n${url}\n`);
    });
    writeJson({ ok: true, ...result });
    return 0;
  }
  process.stderr.write('Unknown auth action. Use login, status, or logout.\n');
  return 2;
}

function serve(): void {
  const config = loadConfig();
  const service = WclService.fromConfig(config);
  const handle = serveStdio(() => createServer(service));
  process.once('SIGINT', () => void handle.close().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void handle.close().finally(() => process.exit(0)));
  process.stderr.write(`${PACKAGE_NAME} ${PACKAGE_VERSION} listening on stdio\n`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, argument, ...extra] = argv;
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return 0;
  }
  if (command === 'doctor') {
    if (extra.length > 0) {
      process.stderr.write('doctor accepts at most one report URL or code.\n');
      return 2;
    }
    return runDoctor(argument);
  }
  if (command === 'auth')
    return runAuth([argument, ...extra].filter((value): value is string => value !== undefined));
  if (command === undefined || command === 'serve') {
    if (argument !== undefined) {
      process.stderr.write('serve accepts no arguments.\n');
      return 2;
    }
    serve();
    return 0;
  }
  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  return 2;
}

void main()
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((error: unknown) => {
    writeJson({ ok: false, error: errorToJson(error) });
    process.exitCode = 1;
  });
