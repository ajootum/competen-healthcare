import { REMINDER_HORIZON_DAYS } from "./vocabulary";

// ── WHAT IS DUE FOR RENEWAL ── pure, from the dates the person recorded ── COMPETEN-IND-007 ──────────────
//
// One rule for every reminder surface: the in-app panels (Professional home and the evidence page) and the
// email scan (reminders.ts) agree on what "due" means. An item is due when its expiry date has passed or
// falls within REMINDER_HORIZON_DAYS of today.
//
// ⚠ NO INVENTED REQUIREMENTS. The dates are the ones the person typed. Nothing here knows a regulator's
// renewal cycle, and no surface may present a reminder as anything but "according to the date you
// recorded".

export type DueItem = { kind: "registration" | "credential"; id: string | null; title: string; expiresOn: string; expired: boolean };

const plusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

export function dueRenewals(
  input: {
    registration: { body: string | null; expiresOn: string | null } | null;
    credentials: readonly { id: string; kind: string; title: string; expires_on: string | null }[];
  },
  today: string,
  horizonDays = REMINDER_HORIZON_DAYS,
): DueItem[] {
  const horizon = plusDays(today, horizonDays);
  const out: DueItem[] = [];
  const reg = input.registration;
  if (reg?.expiresOn && reg.expiresOn <= horizon) {
    out.push({ kind: "registration", id: null, title: reg.body ? `Your registration with ${reg.body}` : "Your professional registration", expiresOn: reg.expiresOn, expired: reg.expiresOn < today });
  }
  for (const c of input.credentials) {
    if (c.kind === "credential" && c.expires_on && c.expires_on <= horizon) {
      out.push({ kind: "credential", id: c.id, title: c.title, expiresOn: c.expires_on, expired: c.expires_on < today });
    }
  }
  return out.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}
