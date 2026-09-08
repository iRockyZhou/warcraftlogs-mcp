#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { PACKAGE_NAME, PACKAGE_VERSION } from './constants.js';
import { loadConfig } from './config.js';
import { errorToJson } from './errors.js';
import { createServer } from './server.js';
import { WclService } from './service.js';
import { resolveReportReference } from './url.js';

const HELP = `${PACKAGE_NAME} ${PACKAGE_VERSION}

Usage:
  warcraftlogs-mcp                 Start the MCP server over stdio
  warcraftlogs-mcp serve           Start the MCP server over stdio
  warcraftlogs-mcp doctor [report] Check configuration and WCL connectivity
  warcraftlogs-mcp --help          Show this help
  warcraftlogs-mcp --version       Show the version

Environment:
  WCL_CLIENT_ID                    Warcraft Logs OAuth client ID
  WCL_CLIENT_SECRET                Warcraft Logs OAuth client secret
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
  };

  if (config.clientId === undefined || config.clientSecret === undefined) {
    writeJson({ ok: false, checks, message: 'Configure WCL_CLIENT_ID and WCL_CLIENT_SECRET.' });
    return 1;
  }

  const service = WclService.fromConfig(config);
  try {
    if (reportInput === undefined) {
      checks['connectivity'] = await service.doctor();
    } else {
      const reference = resolveReportReference(reportInput);
      checks['connectivity'] = await service.doctor(reference.region);
      checks['report'] = await service.getReport(reportInput);
    }
    writeJson({ ok: true, checks });
    return 0;
  } catch (error) {
    checks['connectivity'] = { ok: false, error: errorToJson(error) };
    writeJson({ ok: false, checks });
    return 1;
  }
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
