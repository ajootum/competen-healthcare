// The person's own calendar day. This is planning logic, not a security decision, so it may use the
// application clock. Grants and idempotency expiry are judged by the database clock instead.

export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the ISO week that holds this date. */
export function mondayOf(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return addDays(isoDate, -((d.getUTCDay() + 6) % 7));
}

export const isMonday = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`).getUTCDay() === 1;
