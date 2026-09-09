import { describe, expect, it } from 'vitest';
import {
  characterIdentity,
  normalizeCharacterRegion,
  normalizeServerSlug,
} from '../src/character.js';

describe('character identity', () => {
  it.each([
    ['na', 'us'],
    ['Americas', 'us'],
    ['europe', 'eu'],
    ['china', 'cn'],
    ['TW', 'tw'],
  ] as const)('normalizes region %s to %s', (input, expected) => {
    expect(normalizeCharacterRegion(input)).toBe(expected);
  });

  it('normalizes spaces and punctuation without destroying CJK realm names', () => {
    expect(normalizeServerSlug('  Area 52!  ')).toBe('area-52');
    expect(normalizeServerSlug('  \u94f6\u6708  ')).toBe('\u94f6\u6708');
  });

  it('selects the CN API origin only for CN characters', () => {
    expect(characterIdentity('\u6e29\u67d4\u6613\u5927\u529b', '\u94f6\u6708', 'cn')).toEqual({
      name: '\u6e29\u67d4\u6613\u5927\u529b',
      serverSlug: '\u94f6\u6708',
      serverRegion: 'cn',
      apiRegion: 'cn',
    });
    expect(characterIdentity('Alice', 'Area 52', 'us').apiRegion).toBe('global');
  });

  it('rejects incomplete identity fields', () => {
    expect(() => normalizeCharacterRegion('oce')).toThrow(/Unsupported character region/);
    expect(() => normalizeServerSlug('!!!')).toThrow(/must not be empty/);
    expect(() => characterIdentity('   ', 'Area 52', 'us')).toThrow(/must not be empty/);
  });
});
