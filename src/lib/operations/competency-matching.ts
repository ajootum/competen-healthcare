// Competency Matching Engine (WSE-001D) — matches workforce capability to clinical
// demand. Computes each staff member's competency currency from competency_decisions
// (current / expiring ≤30d / expired / none), then validates the generated roster:
// match score (% assignments with validated competency), unvalidated/high-risk
// assignments, recommended competency-current replacements, role coverage and skill mix.
// The currency overview is roster-independent (always real); the match analysis needs a
// roster. Competency Passport specialty/preceptor/orientation depth is honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRosterForWeek, mondayOf } from "@/lib/operations/roster-solver";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];
const CLINICAL = new Set(["nurse", "charge", "doctor", "therapist", "float"]);
const ROLE_LABEL: Record<string, string> = { nurse: "Registered Nurses", charge: "Charge Nurses", support: "Support Staff", float: "Float Pool", doctor: "Doctors", therapist: "Allied Health" };

export async function loadCompetencyMatching(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const ops = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ops.ready) return { ready: false as const };

  // Staff pool (distinct clinical staff)
  const seen = new Set<string>(); const pool: any[] = [];
  for (const s of ops.data.shiftStaff) { if (s.staff_id && CLINICAL.has(s.role) && !seen.has(s.staff_id)) { seen.add(s.staff_id); pool.push({ id: s.staff_id, name: s.profiles?.full_name ?? "Staff", role: s.role }); } }

  // Competency currency per staff (from competency_decisions)
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const decByStaff = new Map<string, any[]>();
  let expiredCerts = 0, expiringCerts = 0;
  try {
    const { data } = await scope(admin.from("competency_decisions").select("nurse_id, outcome, expiry_date"));
    for (const d of data ?? []) { if (!d.nurse_id) continue; if (!decByStaff.has(d.nurse_id)) decByStaff.set(d.nurse_id, []); decByStaff.get(d.nurse_id)!.push(d); }
    for (const d of data ?? []) { if (d.expiry_date && d.expiry_date < today) expiredCerts++; else if (d.expiry_date && d.expiry_date <= in30) expiringCerts++; }
  } catch { /* fail-soft */ }

  const statusOf = (id: string): "Current" | "Expiring" | "Expired" | "None" => {
    const ds = decByStaff.get(id) ?? [];
    if (!ds.length) return "None";
    const passing = ds.filter((d: any) => PASSING.includes(d.outcome));
    const current = passing.some((d: any) => !d.expiry_date || d.expiry_date >= today);
    if (!current) return "Expired";
    const expiring = passing.some((d: any) => d.expiry_date && d.expiry_date >= today && d.expiry_date <= in30);
    return expiring ? "Expiring" : "Current";
  };
  const staff = pool.map(s => ({ ...s, status: statusOf(s.id) }));
  const currentSet = new Set(staff.filter(s => s.status === "Current" || s.status === "Expiring").map(s => s.id));

  const skillMix = ["Current", "Expiring", "Expired", "None"].map(st => ({ label: st, n: staff.filter(s => s.status === st).length })).filter(x => x.n > 0);
  const roleCoverage = [...new Set(staff.map(s => s.role))].map(role => {
    const rs = staff.filter(s => s.role === role);
    const ok = rs.filter(s => s.status === "Current" || s.status === "Expiring").length;
    return { role, label: ROLE_LABEL[role] ?? role, total: rs.length, current: ok, pct: rs.length ? Math.round((ok / rs.length) * 100) : null };
  }).sort((a, b) => (b.total - a.total));

  // Roster match analysis
  const weekStart = mondayOf();
  const r = await loadRosterForWeek(admin, hid, isSuper, weekStart);
  const provisioned = (r as any).provisioned;
  const roster = provisioned ? (r as any).roster : null;
  let match: any = null;
  if (roster) {
    const asg: any[] = ((r as any).assignments ?? []).filter((a: any) => a.status === "assigned");
    const validated = asg.filter(a => a.competency_validated).length;
    const unvalidated = asg.filter(a => !a.competency_validated);
    const matchScore = asg.length ? Math.round((validated / asg.length) * 100) : null;
    // Recommended replacements: for each unvalidated assignment, a current-competency staff of same role
    const usedByShift = new Set(asg.map(a => `${a.staff_id}|${a.shift_date}`));
    const highRisk = unvalidated.slice(0, 8).map(a => {
      const alt = staff.find(s => s.role === a.role && currentSet.has(s.id) && !usedByShift.has(`${s.id}|${a.shift_date}`));
      return { unit: a.unit_name, role: ROLE_LABEL[a.role] ?? a.role, date: a.shift_date, shift: a.shift_type, staff: a.staff_name ?? "—", replacement: alt?.name ?? null };
    });
    match = { matchScore, assigned: asg.length, validated, unvalidatedCount: unvalidated.length, highRisk, rosterStatus: roster.status };
  }

  const insights: { icon: string; text: string; tone: string }[] = [];
  if (expiredCerts) insights.push({ icon: "⛔", text: `${expiredCerts} expired certification(s) — those staff cannot be scheduled to restricted roles without override`, tone: "red" });
  if (expiringCerts) insights.push({ icon: "⏰", text: `${expiringCerts} competenc(y/ies) expiring within 30 days — schedule reassessment`, tone: "amber" });
  if (match && match.unvalidatedCount) insights.push({ icon: "🎯", text: `${match.unvalidatedCount} roster assignment(s) lack a validated competency — see recommended replacements`, tone: "amber" });
  const noneCount = staff.filter(s => s.status === "None").length;
  if (noneCount) insights.push({ icon: "📋", text: `${noneCount} staff have no competency record — complete competency passport`, tone: "gray" });
  if (!insights.length) insights.push({ icon: "✅", text: "Workforce competency currency is healthy across all roles", tone: "green" });

  return {
    ready: true as const, provisioned, weekStart,
    kpis: { matchScore: match?.matchScore ?? null, currentPct: staff.length ? Math.round((currentSet.size / staff.length) * 100) : null, expiredCerts, expiringCerts, staffTotal: staff.length, noneCount },
    staff, skillMix, roleCoverage, match, insights,
    expiringStaff: staff.filter(s => s.status === "Expiring").slice(0, 8),
    expiredStaff: staff.filter(s => s.status === "Expired").slice(0, 8),
  };
}
