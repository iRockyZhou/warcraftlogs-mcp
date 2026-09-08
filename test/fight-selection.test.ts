import { describe, expect, it } from 'vitest';
import { WclError } from '../src/errors.js';
import { selectFight } from '../src/service.js';
import type { ReportFight } from '../src/types.js';
import { FIGHT } from './helpers.js';

const fights: ReportFight[] = [
  { ...FIGHT, id: 1, startTime: 100 },
  { ...FIGHT, id: 3, startTime: 300 },
  { ...FIGHT, id: 2, startTime: 200 },
];

describe('fight selection', () => {
  it('selects an explicit ID and chronological last', () => {
    expect(selectFight(fights, 2, true)?.id).toBe(2);
    expect(selectFight(fights, 'last', true)?.id).toBe(3);
  });

  it('requires a selector for multi-fight report analysis', () => {
    expect(() => selectFight(fights, null, true)).toThrow(WclError);
    expect(selectFight(fights, null, false)).toBeNull();
  });
});
