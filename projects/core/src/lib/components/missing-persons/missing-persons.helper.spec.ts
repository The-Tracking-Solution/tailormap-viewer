import { describe, expect, test } from 'vitest';
import { missingElapsed, missingIsoDate, missingLocalDate } from './missing-persons.helper';

describe('missing person time boundaries', () => {
  test('uses last observation rather than data entry time for 30/60 minute reminders', () => {
    const observation = '2026-11-22T10:00:00Z';
    expect(missingElapsed(observation, Date.parse('2026-11-22T10:29:59Z'))).toBe(29);
    expect(missingElapsed(observation, Date.parse('2026-11-22T10:30:00Z'))).toBe(30);
    expect(missingElapsed(observation, Date.parse('2026-11-22T11:00:00Z'))).toBe(60);
    expect(missingElapsed(observation, Date.parse('2026-11-22T09:00:00Z'))).toBe(0);
  });
  test('roundtrips browser local time and rejects invalid input', () => {
    const instant = '2026-11-22T10:15:00.000Z';
    expect(missingIsoDate(missingLocalDate(instant))).toBe(instant);
    expect(missingIsoDate('')).toBeNull();
    expect(missingIsoDate('invalid')).toBeNull();
  });
});
