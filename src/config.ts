import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_RETRY_AFTER_MS,
  DEFAULT_TIMEOUT_MS,
} from './constants.js';
import { WclError } from './errors.js';
import type { WclConfig } from './types.js';

function readInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new WclError(
      'CONFIG_ERROR',
      `${key} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WclConfig {
  const clientId = env['WCL_CLIENT_ID']?.trim();
  const clientSecret = env['WCL_CLIENT_SECRET']?.trim();
  return {
    ...(clientId === undefined || clientId === '' ? {} : { clientId }),
    ...(clientSecret === undefined || clientSecret === '' ? {} : { clientSecret }),
    requestTimeoutMs: readInteger(
      env,
      'WCL_REQUEST_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
      1_000,
      120_000,
    ),
    maxRetries: readInteger(env, 'WCL_MAX_RETRIES', DEFAULT_MAX_RETRIES, 0, 5),
    maxRetryAfterMs: readInteger(
      env,
      'WCL_MAX_RETRY_AFTER_MS',
      DEFAULT_MAX_RETRY_AFTER_MS,
      0,
      30_000,
    ),
  };
}

export function assertCredentials(config: WclConfig): asserts config is WclConfig & {
  clientId: string;
  clientSecret: string;
} {
  if (config.clientId === undefined || config.clientSecret === undefined) {
    throw new WclError(
      'CONFIG_ERROR',
      'WCL_CLIENT_ID and WCL_CLIENT_SECRET are required for Warcraft Logs API calls.',
    );
  }
}
