import { describe, expect, it } from 'vitest';
import { countForEntry, getTableEntries, normalizeTable } from '../src/normalize.js';

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
});
