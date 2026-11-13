import { expect, it } from 'vitest';
import {
  DEFAULT_IDLE_DAYS,
  MAX_IDLE_DAYS,
  MIN_IDLE_DAYS,
  parseIdleDays,
} from '../../apps/worker/src/retention-preview';

it('defaults and bounds idleDays strictly', () => {
  expect(parseIdleDays(undefined)).toBe(DEFAULT_IDLE_DAYS);
  expect(parseIdleDays(String(MIN_IDLE_DAYS))).toBe(MIN_IDLE_DAYS);
  expect(parseIdleDays(String(MAX_IDLE_DAYS))).toBe(MAX_IDLE_DAYS);
  for (const bad of ['', '0', '6', '3651', '-1', '1.5', 'abc'])
    expect(() => parseIdleDays(bad)).toThrow();
});
