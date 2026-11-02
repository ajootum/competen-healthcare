import { PREFILL_KEYS, type Participation, type PrefillKey } from "./person-details";

// ── THE ADD USER DIALOG, THE PARTS THAT ARE NOT PIXELS ── owner GO "HQ User Management, Invitations and
//    Individual Profile Completion" (2 Nov 2026) ─────────────────────────────────────────────────────────────
//
// Pure, so the wording the owner approved and the shape sent to the server are tested rather than looked at.

export const ACCESS_PRESET_DAYS = [30, 90, 180, 365] as const;
export const ACCESS_MAX_DAYS = 366;

/** The UTC calendar date `days` after `now`, as YYYY-MM-DD (the basis the server checks on). */
export const endDateFor = (days: number, now: Date = new Date()): string => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** "31 Jan 2027" from a YYYY-MM-DD date, in UTC so the day never shifts with the browser time zone. */
export function displayDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const productsText = (scholar: boolean, professional: boolean): string =>
  [scholar ? "Competen Scholar" : null, professional ? "Competen Professional" : null].filter(Boolean).join(" and ");

/** The success line names exactly what was given. */
export function individualSuccess(p: { email: string; scholar: boolean; professional: boolean; endsOn: string; warnings?: string[] }): string {
  const base = `Invitation sent to ${p.email}. ${productsText(p.scholar, p.professional)} until ${displayDate(p.endsOn)}. No organisation role.`;
  return [base, ...(p.warnings ?? [])].join(" ");
}

export type Refusal = { status: number; code?: string; message?: string };

/** Plain words for each refusal the invitation can answer with. Anything else shows the server own message. */
export function individualRefusalText(r: Refusal): string {
  if (r.code === "ACCOUNT_EXISTS") return "This email already has a Competen account. Nothing was created. Grant access to that account from Individual access instead.";
  if (r.code === "NOT_SET_UP") return "Inviting people to Competen Scholar or Professional is not set up in this environment yet. Nothing was created.";
  if (r.status === 404) return "Competen Individual is not switched on here, so nobody can be invited to it yet. Nothing was created.";
  if (r.status === 403) return "You do not hold the Individual access right, so you cannot invite people to Competen Scholar or Professional. Nothing was created.";
  return r.message || "The invitation could not be sent. Nothing was created.";
}

export type IndividualForm = {
  email: string; givenName: string; middleNames: string; familyName: string; preferredName: string;
  accountType: string; scholar: boolean; professional: boolean; adultConfirmed: boolean; endsOn: string;
  participation: Participation; expiresInDays: string; phone: string; country: string; note: string;
} & Record<PrefillKey, string>;

/** The body POSTed to /api/hq/individual/invitations. Blank optional values are left out. */
export function individualBody(f: IndividualForm): Record<string, unknown> {
  const t = (v: string) => v.trim();
  const prefill: Record<string, string> = {};
  for (const k of PREFILL_KEYS) if (t(f[k])) prefill[k] = t(f[k]);
  return {
    basis: "ordinary",
    email: t(f.email), givenName: t(f.givenName), familyName: t(f.familyName),
    ...(t(f.middleNames) ? { middleNames: t(f.middleNames) } : {}),
    ...(t(f.preferredName) ? { preferredName: t(f.preferredName) } : {}),
    ...(t(f.phone) ? { phone: t(f.phone) } : {}),
    ...(t(f.country) ? { country: t(f.country) } : {}),
    ...(t(f.note) ? { note: t(f.note) } : {}),
    ...(Object.keys(prefill).length ? { prefill } : {}),
    experiences: [f.scholar ? "scholar" : null, f.professional ? "professional" : null].filter(Boolean),
    adultConfirmed: f.scholar ? f.adultConfirmed : false,
    endsOn: f.endsOn, participation: f.participation,
    expiresInDays: Number(f.expiresInDays) || 14,
    accountType: f.accountType,
  };
}

/** Whether the individual form can be sent. The server checks everything again. */
export function individualReady(f: IndividualForm, now: Date = new Date()): boolean {
  if (!/.+@.+\..+/.test(f.email.trim()) || !f.givenName.trim() || !f.familyName.trim()) return false;
  if (!f.scholar && !f.professional) return false;
  if (f.scholar && !f.adultConfirmed) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.endsOn)) return false;
  if (f.endsOn < endDateFor(0, now) || f.endsOn > endDateFor(ACCESS_MAX_DAYS, now)) return false;
  const days = Number(f.expiresInDays);
  return Number.isInteger(days) && days >= 1 && days <= 30;
}
