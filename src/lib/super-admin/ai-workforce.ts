// Workforce Intelligence (AIP-001.3) loader — analyses people, competencies,
// rosters and learning to help deploy a safe, capable workforce. Platform-wide
// and fail-soft. Genuine computations only:
//   • Skill gaps  = framework competencies with NO validated passing score.
//   • Coverage    = validated-covered competencies / total.
//   • Shift risk  = upcoming op_shifts with no assigned staff.
//   • Shift load  = staff assigned to ≥6 shifts in the last 14 days (an
//                   operational fatigue INDICATOR, never a medical judgement).
// Roster publishing and succession mapping aren't modelled here → honest "—".
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const FATIGUE_THRESHOLD = 6; // shifts in 14 days

export async function loadWorkforceIntelligence(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });
  const day14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const [comps, domains, scores, staffCount, nurseCount, shifts, shiftStaff, pathways, pathItems, positions] = await Promise.all([
    admin.from("framework_competencies").select("id, domain_id").limit(20000),
    admin.from("framework_domains").select("id, name").limit(5000),
    admin.from("competency_scores").select("competency_id, is_passing, educator_validated").limit(60000),
    head("profiles"),
    admin.from("profiles").select("*", { count: "exact", head: true }).eq("role", "nurse"),
    admin.from("op_shifts").select("id, status, shift_date").limit(8000),
    admin.from("op_shift_staff").select("shift_id, staff_id").limit(40000),
    head("learning_pathways"),
    admin.from("pathway_items").select("status").limit(20000),
    head("positions"),
  ]);

  // ── Skill-gap analysis ──────────────────────────────────────────────────────
  const compRows = (comps.error ? [] : comps.data ?? []) as any[];
  const scoreRows = (scores.error ? [] : scores.data ?? []) as any[];
  const totalComps = compRows.length;
  const validatedCovered = new Set(scoreRows.filter(s => s.is_passing && s.educator_validated).map(s => s.competency_id));
  const anyScored = new Set(scoreRows.map(s => s.competency_id));
  const openSkillGaps = compRows.filter(c => !validatedCovered.has(c.id)).length;
  const coveragePct = totalComps ? Math.round((validatedCovered.size / totalComps) * 100) : null;
  const awaitingValidation = scoreRows.filter(s => s.is_passing && !s.educator_validated).length;
  const atRisk = scoreRows.filter(s => !s.is_passing).length;

  // Per-domain gap (top uncovered domains).
  const domName = new Map<string, string>((domains.error ? [] : domains.data ?? []).map((d: any) => [d.id, d.name]));
  const domTotal = new Map<string, number>();
  const domCovered = new Map<string, number>();
  for (const c of compRows) {
    if (!c.domain_id) continue;
    domTotal.set(c.domain_id, (domTotal.get(c.domain_id) ?? 0) + 1);
    if (validatedCovered.has(c.id)) domCovered.set(c.domain_id, (domCovered.get(c.domain_id) ?? 0) + 1);
  }
  const domainGaps = [...domTotal.entries()]
    .map(([id, total]) => { const cov = domCovered.get(id) ?? 0; return { name: domName.get(id) ?? "—", total, covered: cov, gap: total - cov, coverage: Math.round((cov / total) * 100) }; })
    .filter(d => d.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 6);

  // ── Roster intelligence ─────────────────────────────────────────────────────
  const shiftRows = (shifts.error ? [] : shifts.data ?? []) as any[];
  const staffRows = (shiftStaff.error ? [] : shiftStaff.data ?? []) as any[];
  const assignedByShift = new Map<string, number>();
  for (const s of staffRows) assignedByShift.set(s.shift_id, (assignedByShift.get(s.shift_id) ?? 0) + 1);
  const upcoming = shiftRows.filter(s => (s.shift_date ?? "") >= today);
  const unstaffedUpcoming = upcoming.filter(s => !assignedByShift.get(s.id)).length;
  const shiftStatus: Record<string, number> = {};
  for (const s of shiftRows) { const k = s.status ?? "unknown"; shiftStatus[k] = (shiftStatus[k] ?? 0) + 1; }

  // ── Shift-load (fatigue) indicator ──────────────────────────────────────────
  const recentShiftIds = new Set(shiftRows.filter(s => (s.shift_date ?? "") >= day14.slice(0, 10)).map(s => s.id));
  const loadByStaff = new Map<string, number>();
  for (const s of staffRows) if (recentShiftIds.has(s.shift_id)) loadByStaff.set(s.staff_id, (loadByStaff.get(s.staff_id) ?? 0) + 1);
  const highLoadStaff = [...loadByStaff.values()].filter(n => n >= FATIGUE_THRESHOLD).length;
  const rosterReady = !shifts.error;

  // ── Learning / training ─────────────────────────────────────────────────────
  const itemRows = (pathItems.error ? [] : pathItems.data ?? []) as any[];
  const pendingTraining = itemRows.filter(i => !["completed", "passed", "done", "closed"].includes(String(i.status ?? "").toLowerCase())).length;

  const kpis = {
    openSkillGaps: totalComps ? openSkillGaps : null,
    coveragePct,
    awaitingValidation: scores.error ? null : awaitingValidation,
    atRisk: scores.error ? null : atRisk,
    staff: num(staffCount),
    upcomingShifts: rosterReady ? upcoming.length : null,
    unstaffedShifts: rosterReady ? unstaffedUpcoming : null,
    trainingNeeds: pathItems.error ? null : pendingTraining,
  };

  // Workforce risk centre — rule-derived, prioritised, explainable, deep-linked.
  const risks: { title: string; reason: string; priority: "High" | "Medium" | "Low"; href: string }[] = [];
  if (unstaffedUpcoming > 0 && rosterReady) risks.push({ title: "Cover Unstaffed Shifts", reason: `${unstaffedUpcoming} upcoming shift${unstaffedUpcoming === 1 ? "" : "s"} with no assigned staff`, priority: "High", href: "/super-admin/platform-ops/monitoring" });
  if (highLoadStaff > 0) risks.push({ title: "Review Shift Load", reason: `${highLoadStaff} staff on ≥${FATIGUE_THRESHOLD} shifts in 14 days`, priority: "High", href: "/super-admin/platform-ops/monitoring" });
  if (openSkillGaps > 0 && totalComps) risks.push({ title: "Close Skill Gaps", reason: `${openSkillGaps} competenc${openSkillGaps === 1 ? "y has" : "ies have"} no validated coverage`, priority: "Medium", href: "/super-admin/ckp/competency" });
  if (awaitingValidation > 0) risks.push({ title: "Clear Validation Backlog", reason: `${awaitingValidation} passing score${awaitingValidation === 1 ? "" : "s"} awaiting educator validation`, priority: "Medium", href: "/super-admin/ckp/assessment" });
  if ((coveragePct ?? 100) < 80 && totalComps) risks.push({ title: "Raise Competency Coverage", reason: `Validated coverage is ${coveragePct}%`, priority: "Medium", href: "/super-admin/ckp/competency" });
  if (pendingTraining > 0) risks.push({ title: "Assign Training", reason: `${pendingTraining} pathway item${pendingTraining === 1 ? "" : "s"} outstanding`, priority: "Low", href: "/super-admin/ckp/studio" });
  const rank = { High: 0, Medium: 1, Low: 2 };
  risks.sort((a, b) => rank[a.priority] - rank[b.priority]);

  const capabilities = [
    { name: "Workforce Planning", desc: "By facility, department, role, shift" },
    { name: "Skill-Gap Analysis", desc: "Required vs validated competencies" },
    { name: "Roster Intelligence", desc: "Safe skill mix & coverage" },
    { name: "Competency Forecasting", desc: "Future competency risk" },
    { name: "Learning Recommendations", desc: "CPUs, pathways, reassessment" },
    { name: "Burnout & Fatigue", desc: "Operational load indicators" },
    { name: "Succession Planning", desc: "Critical roles & readiness" },
    { name: "Workforce Risk Centre", desc: "Prioritised staffing risks" },
  ];

  return {
    kpis,
    domainGaps,
    coverage: { total: totalComps, validated: validatedCovered.size, anyScored: anyScored.size },
    roster: { ready: rosterReady, total: shiftRows.length, upcoming: upcoming.length, unstaffed: unstaffedUpcoming, status: shiftStatus, highLoadStaff, fatigueThreshold: FATIGUE_THRESHOLD },
    training: { pathways: num(pathways), pendingItems: pathItems.error ? null : pendingTraining },
    succession: { positions: num(positions) },
    nurses: num(nurseCount),
    risks,
    capabilities,
    generatedAt: new Date().toISOString(),
  };
}
