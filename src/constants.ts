export const PACKAGE_NAME = 'warcraftlogs-mcp';
export const PACKAGE_VERSION = '0.2.0';

export const WCL_ORIGINS = {
  global: 'https://www.warcraftlogs.com',
  cn: 'https://cn.warcraftlogs.com',
} as const;

export type WclRegion = keyof typeof WCL_ORIGINS;
export type WclOrigin = (typeof WCL_ORIGINS)[WclRegion];

export const REPORT_CODE_PATTERN = /^[A-Za-z0-9]{16}$/;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_RETRY_AFTER_MS = 2_000;
export const TOKEN_EXPIRY_SKEW_MS = 30_000;
export const DEFAULT_TABLE_MAX_ENTRIES = 200;
export const MAX_TABLE_MAX_ENTRIES = 1_000;
export const DEFAULT_TABLE_MAX_BYTES = 500_000;
export const MAX_TABLE_MAX_BYTES = 1_000_000;
export const DEFAULT_EVENT_LIMIT = 300;
export const MIN_EVENT_LIMIT = 1;
export const MAX_EVENT_LIMIT = 5_000;
export const DEFAULT_EVENT_PAGE_SIZE = 500;
export const MAX_EVENT_PAGE_SIZE = 10_000;
export const MIN_EVENT_PAGE_SIZE = 100;
export const DEFAULT_EVENT_MAX_PAGES = 5;
export const MAX_EVENT_MAX_PAGES = 20;
export const DEFAULT_EVENT_MAX_BYTES = 500_000;
export const MAX_EVENT_MAX_BYTES = 1_000_000;
