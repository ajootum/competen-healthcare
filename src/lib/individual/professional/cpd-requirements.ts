/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LearningReference } from "@/lib/learning/products";
import type { CpdRequirement } from "../lcpd-config";

// ── CPD REQUIREMENTS: THE PERSON'S CHOICE, AND WHAT THEIR RECORD SHOWS AGAINST IT ── LCPD-01 LCPD-5, migration 490 ──
//
// A requirement is configuration (lcpd-config.ts), with its authoritative source and review status. A person chooses the
// one they follow and when their cycle started (individual_professional_cpd_setting, own row). The summary is a count of
// their own record, in three kinds the owner keeps apart:
//
//   recorded               every CPD entry and completed Competen Learning course in the cycle
//   potentially eligible   of those, the activity types the requirement says may count
//   verified or accepted   NOTHING, always, with the reason: Competen has no authorised route to verify CPD with any
//                          regulator or professional body. Never zero hours "verified", never "compliant".
//
// A course from Competen Learning counts as type "course" and is counted once (the CPD duplicate rule runs first).

export type CpdSetting = { requirementCode: string | null; cycleStart: string | null };

/** The person's setting. null = could not be read. `available` false = migration 490 is not on this environment. */
export async function loadCpdSetting(admin: any, userId: string): Promise<{ available: boolean; setting: CpdSetting } | null> {
  try {
    const { data, error } = await admin.from("individual_professional_cpd_setting").select("requirement_code, cycle_start").eq("user_id", userId).maybeSingle();
    if (error) return /does not exist|schema cache|could not find/i.test(error.message ?? "") ? { available: false, setting: { requirementCode: null, cycleStart: null } } : null;
    return { available: true, setting: { requirementCode: data?.requirement_code ?? null, cycleStart: data?.cycle_start ?? null } };
  } catch { return null; }
}

const addMonths = (d: string, m: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCMonth(t.getUTCMonth() + m);
  return t.toISOString().slice(0, 10);
};
const r1 = (n: number) => Math.round(n * 10) / 10;

export type CpdEntryLike = { activity_type: string; activity_date: string; hours: number | string | null; cpd_points: number | string | null };

export type RequirementSummary = {
  cycle: { start: string; end: string; current: boolean };
  recorded: { entries: number; hours: number; credits: number; withoutHours: number };
  eligible: { entries: number; hours: number; credits: number };
  verified: null; verifiedReason: string;
  mandatory: { label: string; eligibleHours: number; minHours: number }[];
  requiredHours: number | null; requiredCredits: number | null;
};

export const NOT_VERIFIED = "Competen has no authorised route to verify CPD with any regulator or professional body, so nothing here is verified or accepted. Your body decides what it accepts.";

/**
 * Pure: the person's own record against one requirement, for the cycle that starts on `cycleStart` (and the cycle that
 * contains `today`, if the person's cycle start is earlier). Counts only. No verdict.
 */
export function summarise(req: CpdRequirement, cycleStart: string, cpd: readonly CpdEntryLike[], learning: readonly LearningReference[], today: string): RequirementSummary {
  let start = cycleStart, end = addMonths(start, req.cycleMonths);
  while (end <= today && end > start) { start = end; end = addMonths(start, req.cycleMonths); }
  const inCycle = (d: string) => d >= start && d < end;
  const rows = [
    ...cpd.map(c => ({ type: c.activity_type, date: String(c.activity_date).slice(0, 10), hours: c.hours == null || c.hours === "" ? null : Number(c.hours), credits: c.cpd_points == null || c.cpd_points === "" ? 0 : Number(c.cpd_points) })),
    ...learning.map(r => ({ type: "course", date: r.completedOn, hours: r.hours, credits: 0 })),
  ].filter(r => inCycle(r.date));
  const eligible = (t: string) => !req.eligibleTypes.length || req.eligibleTypes.includes(t);
  const sum = (xs: typeof rows, k: "hours" | "credits") => r1(xs.reduce((s, x) => s + (x[k] ?? 0), 0));
  const el = rows.filter(r => eligible(r.type));
  return {
    cycle: { start, end, current: start <= today && today < end },
    recorded: { entries: rows.length, hours: sum(rows, "hours"), credits: sum(rows, "credits"), withoutHours: rows.filter(r => r.hours == null).length },
    eligible: { entries: el.length, hours: sum(el, "hours"), credits: sum(el, "credits") },
    verified: null, verifiedReason: NOT_VERIFIED,
    mandatory: req.mandatoryCategories.map(m => ({ label: m.label, minHours: m.minHours, eligibleHours: sum(rows.filter(r => m.types.includes(r.type)), "hours") })),
    requiredHours: req.requiredHours, requiredCredits: req.requiredCredits,
  };
}

/** Pure: a requirement offered to people now -- in effect today. One no longer in effect stays readable but is not offered. */
export const inEffect = (r: CpdRequirement, today: string) => r.effectiveFrom <= today && (!r.effectiveTo || today <= r.effectiveTo);

/** Pure: the setting a person sent, or why not. A cycle start is a date not in the future, and needs a requirement. */
export function parseSetting(b: any, requirements: readonly CpdRequirement[], today: string): { ok: true; value: CpdSetting } | { ok: false; error: string } {
  const code = b?.requirementCode == null || b.requirementCode === "" ? null : String(b.requirementCode);
  if (code === null) return { ok: true, value: { requirementCode: null, cycleStart: null } };
  const req = requirements.find(r => r.code === code);
  if (!req || !inEffect(req, today)) return { ok: false, error: "Choose a CPD requirement that is offered now." };
  const start = typeof b?.cycleStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.cycleStart) ? b.cycleStart : null;
  if (!start || start > today) return { ok: false, error: "Give the date your current CPD cycle started (not in the future)." };
  return { ok: true, value: { requirementCode: code, cycleStart: start } };
}

/** The correction history of the person's CPD entries, newest first, per entry. null = unreadable, absent 490 = empty. */
export async function loadCpdHistory(admin: any, userId: string): Promise<Map<string, { title: string; activity_date: string; hours: number | null; corrected_at: string }[]> | null> {
  try {
    const { data, error } = await admin.from("individual_professional_cpd_history").select("cpd_id, title, activity_date, hours, corrected_at").eq("user_id", userId).order("corrected_at", { ascending: false }).limit(2000);
    if (error) return /does not exist|schema cache|could not find/i.test(error.message ?? "") ? new Map() : null;
    const out = new Map<string, any[]>();
    for (const r of data ?? []) out.set(r.cpd_id, [...(out.get(r.cpd_id) ?? []), { title: r.title, activity_date: r.activity_date, hours: r.hours == null ? null : Number(r.hours), corrected_at: r.corrected_at }]);
    return out;
  } catch { return null; }
}

/** Pure: the CPD log as CSV, for the person's own export. Quoted fields, no formula injection. */
export function cpdCsv(rows: readonly { activity_date: string; created_at?: string | null; title: string; activity_type: string; provider: string | null; hours: number | null; cpd_points: number | null; evidence_class: string }[], labelOf: (code: string) => string): string {
  const esc = (v: unknown) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const head = ["Activity date", "Recorded on", "Activity", "Type", "Provider", "Hours", "CPD credits", "Evidence"];
  const ev = (c: string) => (c === "source_linked" ? "Self-declared, with a document attached" : "Self-declared");
  return [head.map(esc).join(","), ...rows.map(r => [r.activity_date, (r.created_at ?? "").slice(0, 10), r.title, labelOf(r.activity_type), r.provider, r.hours ?? "", r.cpd_points ?? "", ev(r.evidence_class)].map(esc).join(","))].join("\r\n") + "\r\n";
}
