import { WclError } from './errors.js';
import type {
  JsonObject,
  JsonValue,
  NormalizedTable,
  TableDataType,
  TableFilter,
} from './types.js';

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function byteLength(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

type TrimState = { truncated: boolean };

function trimArrays(value: JsonValue, maxEntries: number, state: TrimState): JsonValue {
  if (Array.isArray(value)) {
    if (value.length > maxEntries) state.truncated = true;
    return value.slice(0, maxEntries).map((entry) => trimArrays(entry, maxEntries, state));
  }
  if (isJsonObject(value)) {
    const result: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = trimArrays(entry, maxEntries, state);
    }
    return result;
  }
  return value;
}

function findEntries(value: JsonValue): JsonObject[] | null {
  if (Array.isArray(value)) {
    return value.every(isJsonObject) ? value : null;
  }
  if (!isJsonObject(value)) return null;
  const direct = value['entries'];
  if (Array.isArray(direct) && direct.every(isJsonObject)) return direct;
  const nested = value['data'];
  if (nested !== undefined) {
    const found = findEntries(nested);
    if (found !== null) return found;
  }
  return null;
}

export function getTableEntries(value: JsonValue): JsonObject[] {
  return findEntries(value) ?? [];
}

export function normalizeTable(
  dataType: TableDataType,
  fightID: number,
  filter: TableFilter,
  raw: JsonValue,
  maxEntries: number,
  maxPayloadBytes: number,
): NormalizedTable {
  const originalEntries = findEntries(raw);
  let effectiveMaxEntries = maxEntries;
  let state: TrimState = { truncated: false };
  let data = trimArrays(raw, effectiveMaxEntries, state);
  let bytes = byteLength(data);

  while (bytes > maxPayloadBytes && effectiveMaxEntries > 1) {
    effectiveMaxEntries = Math.max(1, Math.floor(effectiveMaxEntries / 2));
    state = { truncated: true };
    data = trimArrays(raw, effectiveMaxEntries, state);
    bytes = byteLength(data);
  }
  if (bytes > maxPayloadBytes) {
    throw new WclError(
      'PAYLOAD_TOO_LARGE',
      'A single Warcraft Logs table entry exceeds the payload budget.',
      {
        details: { bytes, maxPayloadBytes },
      },
    );
  }

  const returnedEntries = findEntries(data);
  return {
    dataType,
    fightID,
    filter,
    data,
    meta: {
      bytes,
      originalEntryCount: originalEntries?.length ?? null,
      returnedEntryCount: returnedEntries?.length ?? null,
      truncated: state.truncated,
      maxEntries: effectiveMaxEntries,
      maxPayloadBytes,
    },
  };
}

export function numberField(object: JsonObject, keys: string[]): number | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

export function stringField(object: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

export function countForEntry(object: JsonObject, dataType: TableDataType): number | null {
  if (dataType === 'Deaths') {
    const deathEvents = object['deathEvents'];
    if (Array.isArray(deathEvents)) return deathEvents.length;
    return numberField(object, ['deaths', 'deathCount', 'count', 'total']);
  }
  if (dataType === 'Interrupts' || dataType === 'Casts' || dataType === 'Dispels') {
    return numberField(object, ['uses', 'totalUses', 'count', 'total']);
  }
  return numberField(object, ['total', 'amount', 'totalDamage', 'totalHealing']);
}
