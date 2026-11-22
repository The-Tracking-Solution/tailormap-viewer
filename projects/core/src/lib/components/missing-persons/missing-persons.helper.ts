/** Native datetime-local values have no timezone; convert at the browser boundary only. */
export function missingLocalDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) { return ''; }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function missingIsoDate(local: string): string | null {
  const date = new Date(local);
  return local && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function missingElapsed(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}
