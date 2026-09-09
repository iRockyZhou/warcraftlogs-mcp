import { WclError } from './errors.js';
import type { CharacterIdentity, CharacterRegion } from './types.js';

const ALIASES: Record<string, CharacterRegion> = {
  na: 'us',
  america: 'us',
  americas: 'us',
  europe: 'eu',
  korea: 'kr',
  taiwan: 'tw',
  china: 'cn',
};
const REGIONS = new Set<CharacterRegion>(['us', 'eu', 'kr', 'tw', 'cn']);

export function normalizeCharacterRegion(value: string): CharacterRegion {
  const normalized = value.trim().toLocaleLowerCase();
  const region = ALIASES[normalized] ?? normalized;
  if (!REGIONS.has(region as CharacterRegion)) {
    throw new WclError(
      'INVALID_ARGUMENT',
      `Unsupported character region "${value}". Use us, eu, kr, tw, or cn.`,
    );
  }
  return region as CharacterRegion;
}

export function normalizeServerSlug(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  if (normalized === '') throw new WclError('INVALID_ARGUMENT', 'serverSlug must not be empty.');
  return normalized;
}

export function characterIdentity(
  name: string,
  server: string,
  serverRegionInput: string,
): CharacterIdentity {
  const trimmedName = name.normalize('NFKC').trim();
  if (trimmedName === '')
    throw new WclError('INVALID_ARGUMENT', 'Character name must not be empty.');
  const serverRegion = normalizeCharacterRegion(serverRegionInput);
  return {
    name: trimmedName,
    serverSlug: normalizeServerSlug(server),
    serverRegion,
    apiRegion: serverRegion === 'cn' ? 'cn' : 'global',
  };
}
