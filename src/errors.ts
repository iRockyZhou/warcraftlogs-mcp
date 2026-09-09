import type { JsonObject, JsonValue } from './types.js';

export type WclErrorCode =
  | 'AUTH_FAILED'
  | 'CONFIG_ERROR'
  | 'FORBIDDEN'
  | 'GRAPHQL_ERROR'
  | 'INVALID_ARGUMENT'
  | 'INVALID_RESPONSE'
  | 'INVALID_URL'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'REPORT_NOT_FOUND'
  | 'FIGHT_NOT_FOUND'
  | 'FIGHT_REQUIRED'
  | 'PLAYER_NOT_FOUND'
  | 'SERVER_ERROR'
  | 'STORAGE_ERROR'
  | 'USER_AUTH_REQUIRED'
  | 'TIMEOUT';

export class WclError extends Error {
  readonly code: WclErrorCode;
  readonly details?: JsonObject;
  readonly retryable: boolean;

  constructor(
    code: WclErrorCode,
    message: string,
    options: { cause?: unknown; details?: JsonObject; retryable?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WclError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.details !== undefined) this.details = options.details;
  }

  toJSON(): JsonObject {
    const value: JsonObject = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.details !== undefined) value['details'] = this.details;
    return value;
  }
}

export function errorToJson(error: unknown): JsonObject {
  if (error instanceof WclError) return error.toJSON();
  if (error instanceof Error) {
    return { code: 'UNEXPECTED_ERROR', message: error.message, retryable: false };
  }
  return { code: 'UNEXPECTED_ERROR', message: 'An unexpected error occurred.', retryable: false };
}

export function jsonDetail(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(jsonDetail);
  if (typeof value === 'object') {
    const result: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) result[key] = jsonDetail(entry);
    return result;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? 'symbol';
  if (typeof value === 'function') return value.name === '' ? 'function' : value.name;
  return 'undefined';
}
