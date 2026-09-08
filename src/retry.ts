import type { Sleep } from './types.js';

export const defaultSleep: Sleep = async (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}
