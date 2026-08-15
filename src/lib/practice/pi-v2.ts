import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";

// CPR-PI-001 v2 P0 -- the three metrics the existing modules do not compute, and ONLY those three.
//
// Everything else the v2 screen contracts need already lives in intelligence.ts's modules (the
// follow-up completion proportion with its censoring disclosed, demographics, new-to-practice, the
// encounter trend, diagnosis counts by patients AND by records) -- recomputing any of it here would
// be the conflicting-copy bug s16 of CORE-001 forbids and v2 s14's registry exists to prevent.
//
// THE THREE: recency of last visit (v2 s7), average visits per patient (s7), and median days from
// due to completion for follow-ups (s9/s15). Each is registry-defined (pi.*) and three-stated.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PiV2Extras = {
  available: boolean;
  unavailableReason: string | null;
  provenance: "Derived";
  data: {
    /** v2 s7: buckets over ACTIVE patients by days since last qualifying encounter, denominator shown. */
    recency: {
      buckets: { key: string; label: string; count: number }[];
      neverSeen: number;
      denominator: number;
      truncated: boolean;
    };
    /** v2 s7: qualifying encounters over distinct patients seen, in the period. A ratio with both halves. */
    avgVisitsPerPatient: { encounters: number; patients: number };
    /** v2 s15: median elapsed days between due_on and closed_at over valid completed pairs in period. */
    medianDaysToFollowUp: { medianDays: number | null; pairs: number };
  } | null;
};

const RECENCY_BUCKETS: [string, string, number, number][] = [
  ["d0_30", "0 to 30 days", 0, 30],
  ["d31_90", "31 to 90 days", 31, 90],
  ["d91_180", "91 to 180 days", 91, 180],
  ["d181_365", "181 to 365 days", 181, 365],
  ["d365_plus", "over 365 days", 366, Number.MAX_SAFE_INTEGER],
];

/** Exact median over an integer list; the .5 of an even split is kept, never rounded away. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function piV2Extras(admin: any, ctx: WorkspaceContext, range: {
  fromDay: string; toDay: string; todayDate: string;
}): Promise<PiV2Extras> {
  if (!hasCapability(ctx, "report.view"))
    return { available: false, unavailableReason: "needs report.view", provenance: "Derived", data: null };

  // ⚠ 999+1 on every read: PostgREST's silent 1000 cap must be a visible truncation, not a wrong count.
  const CAP = 999;
  const [patientsRes, encountersRes, followUpsRes] = await Promise.all([
    admin.from("practice_patient").select("id, status")
      .eq("workspace_id", ctx.workspaceId).neq("status", "merged").limit(CAP + 1),
    admin.from("practice_encounter").select("patient_id, started_at, status")
      .eq("workspace_id", ctx.workspaceId).not("patient_id", "is", null)
      .order("started_at", { ascending: false }).limit(CAP + 1),
    admin.from("practice_follow_up").select("due_on, closed_at, status")
      .eq("workspace_id", ctx.workspaceId).eq("status", "COMPLETED")
      .not("closed_at", "is", null).not("due_on", "is", null)
      .gte("closed_at", range.fromDay).limit(CAP + 1),
  ]);
  if (patientsRes.error || encountersRes.error || followUpsRes.error) {
    return {
      available: false, provenance: "Derived", data: null,
      unavailableReason: [patientsRes.error?.message, encountersRes.error?.message, followUpsRes.error?.message]
        .filter(Boolean).join("; "),
    };
  }

  const patients = (patientsRes.data ?? []) as any[];
  const encounters = (encountersRes.data ?? []) as any[];
  const truncated = patients.length > CAP || encounters.length > CAP;
  const pats = patients.slice(0, CAP);
  const encs = encounters.slice(0, CAP);

  // Last visit per patient -- the encounters arrive newest-first, so first sight is the latest.
  const lastSeen = new Map<string, string>();
  for (const e of encs) if (!lastSeen.has(e.patient_id)) lastSeen.set(e.patient_id, e.started_at);

  const today = Date.parse(range.todayDate + "T00:00:00Z");
  const counts = new Map<string, number>(RECENCY_BUCKETS.map(([k]) => [k, 0]));
  let neverSeen = 0;
  for (const p of pats) {
    const seenAt = lastSeen.get(p.id);
    if (!seenAt) { neverSeen++; continue; }
    const days = Math.max(0, Math.floor((today - Date.parse(String(seenAt))) / 86400000));
    const bucket = RECENCY_BUCKETS.find(([, , lo, hi]) => days >= lo && days <= hi);
    if (bucket) counts.set(bucket[0], (counts.get(bucket[0]) ?? 0) + 1);
  }

  // In-period distincts for the visits-per-patient ratio (v2 s15's Patients seen / Consultations).
  const inPeriod = encs.filter(e =>
    String(e.started_at).slice(0, 10) >= range.fromDay && String(e.started_at).slice(0, 10) <= range.toDay);
  const distinctPatients = new Set(inPeriod.map(e => e.patient_id)).size;

  // Median: completed follow-ups whose closure fell in/after the period start, days from due to close.
  // Negative values (closed early) count as 0 days late... no -- s15 measures ELAPSED days between the
  // due reference and completion, so an early close is a NEGATIVE elapsed value and is kept as such:
  // clamping it would overstate how long follow-up takes.
  const pairs = ((followUpsRes.data ?? []) as any[])
    .slice(0, CAP)
    .map(f => Math.round((Date.parse(String(f.closed_at).slice(0, 10) + "T00:00:00Z")
      - Date.parse(String(f.due_on) + "T00:00:00Z")) / 86400000))
    .filter(n => Number.isFinite(n));

  return {
    available: true, unavailableReason: null, provenance: "Derived",
    data: {
      recency: {
        buckets: RECENCY_BUCKETS.map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0 })),
        neverSeen,
        denominator: pats.length,
        truncated,
      },
      avgVisitsPerPatient: { encounters: inPeriod.length, patients: distinctPatients },
      medianDaysToFollowUp: { medianDays: medianOf(pairs), pairs: pairs.length },
    },
  };
}
