import { REPORT_CODE_PATTERN, WCL_ORIGINS, type WclRegion } from './constants.js';
import { WclError } from './errors.js';
import type { FightSelector, ParsedReportUrl, ReportReference } from './types.js';

const HOST_TO_REGION = new Map<string, WclRegion>([
  ['www.warcraftlogs.com', 'global'],
  ['cn.warcraftlogs.com', 'cn'],
]);

function parseFightValue(value: string | null): FightSelector | null {
  if (value === null || value === '') return null;
  if (value === 'last') return 'last';
  if (!/^\d+$/.test(value)) {
    throw new WclError('INVALID_URL', 'The fight selector must be a positive integer or "last".');
  }
  const fight = Number(value);
  if (!Number.isSafeInteger(fight) || fight <= 0) {
    throw new WclError('INVALID_URL', 'The fight selector must be a positive integer or "last".');
  }
  return fight;
}

function fightFromHash(hash: string): string | null {
  if (hash.length <= 1) return null;
  const fragment = hash.slice(1).replace(/^\/?/, '');
  const queryLike = fragment.includes('?') ? fragment.slice(fragment.indexOf('?') + 1) : fragment;
  const params = new URLSearchParams(queryLike);
  const direct = params.get('fight');
  if (direct !== null) return direct;
  return /(?:^|[?&])fight=([^&]+)/.exec(fragment)?.[1] ?? null;
}

export function parseWclUrl(input: string): ParsedReportUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch (cause) {
    throw new WclError('INVALID_URL', 'Expected a valid Warcraft Logs report URL.', { cause });
  }

  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    throw new WclError(
      'INVALID_URL',
      'Only credential-free HTTPS Warcraft Logs URLs on the default port are accepted.',
    );
  }

  const region = HOST_TO_REGION.get(url.hostname);
  if (region === undefined) {
    throw new WclError('INVALID_URL', 'Unsupported Warcraft Logs host.', {
      details: { host: url.hostname },
    });
  }

  const match = /^\/reports\/([A-Za-z0-9]{16})\/?$/.exec(url.pathname);
  if (match?.[1] === undefined || !REPORT_CODE_PATTERN.test(match[1])) {
    throw new WclError('INVALID_URL', 'Expected a /reports/<16-character-code> URL.');
  }

  const reportCode = match[1];
  const fight = parseFightValue(url.searchParams.get('fight') ?? fightFromHash(url.hash));
  const origin = WCL_ORIGINS[region];
  const canonicalUrl = `${origin}/reports/${reportCode}${fight === null ? '' : `?fight=${fight}`}`;
  return { origin, region, reportCode, fight, canonicalUrl };
}

export function resolveReportReference(
  input: string,
  region: WclRegion = 'global',
): ReportReference {
  if (REPORT_CODE_PATTERN.test(input)) {
    const origin = WCL_ORIGINS[region];
    return {
      origin,
      region,
      reportCode: input,
      fight: null,
      canonicalUrl: `${origin}/reports/${input}`,
      inputWasUrl: false,
    };
  }
  return { ...parseWclUrl(input), inputWasUrl: true };
}
