import { describe, expect, it } from 'vitest';
import {
  countDeathsForPlayer,
  countForEntry,
  countInterruptsForPlayer,
  getTableEntries,
  normalizeTable,
} from '../src/normalize.js';
import { ACTORS } from './helpers.js';

const alice = {
  ...ACTORS[0]!,
  fightIDs: [1],
  specs: ['Retribution'],
  itemLevels: [301],
};

describe('table normalization', () => {
  it('preserves the WCL shape while bounding nested entry arrays', () => {
    const raw = {
      data: {
        totalTime: 1_000,
        entries: [
          { id: 1, name: 'A', total: 10, abilities: [{ name: 'x' }, { name: 'y' }] },
          { id: 2, name: 'B', total: 20 },
          { id: 3, name: 'C', total: 30 },
        ],
      },
    };
    const result = normalizeTable('DamageDone', 1, { sourceID: 1 }, raw, 2, 100_000);
    expect(getTableEntries(result.data)).toHaveLength(2);
    expect(result.meta).toMatchObject({
      originalEntryCount: 3,
      returnedEntryCount: 2,
      truncated: true,
    });
  });

  it('extracts metric counts across table types', () => {
    expect(countForEntry({ total: 123 }, 'DamageDone')).toBe(123);
    expect(countForEntry({ uses: 7 }, 'Interrupts')).toBe(7);
    expect(countForEntry({ deathEvents: [{ timestamp: 1 }, { timestamp: 2 }] }, 'Deaths')).toBe(2);
  });

  it('counts repeated WCL death rows for one player', () => {
    const value = {
      data: {
        entries: [
          { id: 1, name: 'Alice', timestamp: 1_000, killingBlow: { name: 'Fire' } },
          { id: 2, name: 'Bob', timestamp: 2_000, killingBlow: { name: 'Void' } },
          { id: 1, name: 'Alice', timestamp: 3_000, killingBlow: { name: 'Melee' } },
        ],
      },
    };

    expect(countDeathsForPlayer(value, alice)).toBe(2);
  });

  it('does not fall back to a matching name when actor IDs conflict', () => {
    expect(
      countDeathsForPlayer(
        { data: { entries: [{ id: 2, name: 'Alice', timestamp: 1_000 }] } },
        alice,
      ),
    ).toBe(0);
  });

  it('sums nested per-player interrupt details across interrupted abilities', () => {
    const value = {
      data: {
        entries: [
          {
            entries: [
              {
                name: 'Chaos Bolt',
                details: [
                  { id: 1, name: 'Alice', total: 3, abilities: [{ name: 'Rebuke', total: 3 }] },
                  { id: 2, name: 'Bob', total: 1 },
                ],
              },
              { name: 'Fel Missiles', details: [{ id: 1, name: 'Alice', total: 4 }] },
            ],
          },
        ],
      },
    };

    expect(countInterruptsForPlayer(value, alice)).toBe(7);
  });

  it('keeps compatibility with flat interrupt player rows', () => {
    expect(
      countInterruptsForPlayer({ data: { entries: [{ id: 1, name: 'Alice', uses: 4 }] } }, alice),
    ).toBe(4);
  });
});
