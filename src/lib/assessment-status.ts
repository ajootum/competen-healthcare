// Assessment Status (CMO-004) — the Assessment Operations Command Centre. Real over two live spines:
// scheduled_assessments (hospital_id + scheduled_for + status → pending / overdue / calendar /
// upcoming) and assessments (via competency_cycles → completed / failed / by-method / trend /
// domain readiness). Real: the 6 KPIs, by-method overview grid, 12-week completed/failed trend,
// readiness by domain, named pending/overdue queues, the 14-day calendar, activity and rule-based
// explainable AI insights. Honest next-phase: assessment targets, pending/overdue historical trend
// lines and by-unit grouping (needs unit assignment mapping). Tenant-scoped; fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const PASS = 3; // Benner-style 0-6 score; competent+ passes.
const nowMs = () => Date.now();
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const METHOD_LABEL: Record<string, string> = { knowledge: "Knowledge", direct_observation: "Direct Observation", simulation: "Simulation", osce: "OSCE", concurrent_audit: "Concurrent Audit", retrospective_audit: "Retrospective Audit", logbook: "Logbook", workplace: "Workplace Observation", peer_review: "Peer Review" };
const ml = (m: string) => METHOD_LABEL[m] ?? (m ?? "Assessment").replace(/_/g, " ");
const COMPLETED = new Set(["complete", "validated"]);

export async function loadAssessmentStatus(admin: any, hid: string | null, isSuper: boolean) {
  const scopeH = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const now = nowMs();

  // ── Scheduling spine (pending / overdue / calendar / upcoming) ───────────────────────────────
  let schedProvisioned = true;
  let sched: any[] = [];
  try {
    const { data, error } = await scopeH(admin.from("scheduled_assessments")
      .select("id, method, scheduled_for, status, nurse_id, assessor_id, competency_id, nurse:profiles!nurse_id(full_name, role)")
      .order("scheduled_for", { ascending: true }).limit(5000));
    if (error) throw error;
    sched = data ?? [];
  } catch { schedProvisioned = false; sched = []; }

  const openSched = sched.filter(s => s.status === "scheduled");
  const pending = openSched.filter(s => new Date(s.scheduled_for).getTime() >= now);
  const overdue = openSched.filter(s => new Date(s.scheduled_for).getTime() < now);
  const daysBetween = (a: number, b: number) => Math.round((a - b) / 86400000);
  const pendingList = pending.slice(0, 8).map(s => ({ name: s.nurse?.full_name ?? "—", role: (s.nurse?.role ?? "").replace(/_/g, " "), assessment: ml(s.method), due: dayKey(new Date(s.scheduled_for)), daysLeft: daysBetween(new Date(s.scheduled_for).getTime(), now) }));
  const overdueList = overdue.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()).slice(0, 8).map(s => ({ name: s.nurse?.full_name ?? "—", role: (s.nurse?.role ?? "").replace(/_/g, " "), assessment: ml(s.method), due: dayKey(new Date(s.scheduled_for)), daysOverdue: daysBetween(now, new Date(s.scheduled_for).getTime()) }));
  const upcoming = pending.slice(0, 6).map(s => ({ name: s.nurse?.full_name ?? "—", method: ml(s.method), at: s.scheduled_for }));

  // 14-day calendar (method × day counts).
  const calDays: { label: string; key: string }[] = [];
  for (let i = 0; i < 14; i++) { const d = new Date(now + i * 86400000); calDays.push({ label: d.toLocaleDateString([], { day: "2-digit", month: "short" }), key: dayKey(d) }); }
  const calMethods = [...new Set(openSched.map(s => s.method))];
  const calendar = calMethods.map(m => ({ method: ml(m), counts: calDays.map(day => openSched.filter(s => s.method === m && dayKey(new Date(s.scheduled_for)) === day.key).length) }));

  // ── Assessment spine (completed / failed / by-method / trend / domain) ───────────────────────
  let asmtProvisioned = true;
  let asmts: any[] = [];
  try {
    let cycleIds: string[] = [];
    if (!isSuper) { const { data: cyc } = await admin.from("competency_cycles").select("id").eq("hospital_id", hid ?? NONE).limit(3000); cycleIds = (cyc ?? []).map((c: any) => c.id); }
    const base = admin.from("assessments").select("method, status, score, assessed_at, validated_at, created_at, competency_id");
    const q = isSuper ? base.limit(20000) : (cycleIds.length ? base.in("cycle_id", cycleIds).limit(20000) : null);
    if (q) { const { data, error } = await q; if (error) throw error; asmts = data ?? []; }
  } catch { asmtProvisioned = false; asmts = []; }

  const completed = asmts.filter(a => COMPLETED.has(a.status)).length;
  const failed = asmts.filter(a => COMPLETED.has(a.status) && a.score != null && a.score < PASS).length;
  const passed = asmts.filter(a => COMPLETED.has(a.status) && a.score != null && a.score >= PASS).length;

  // By-method overview grid (required = total instances; completed / pending / overdue / compliance).
  const methods = [...new Set([...asmts.map(a => a.method), ...openSched.map(s => s.method)])];
  const overview = methods.map(m => {
    const req = asmts.filter(a => a.method === m).length + openSched.filter(s => s.method === m).length;
    const comp = asmts.filter(a => a.method === m && COMPLETED.has(a.status)).length;
    const pend = openSched.filter(s => s.method === m && new Date(s.scheduled_for).getTime() >= now).length;
    const over = openSched.filter(s => s.method === m && new Date(s.scheduled_for).getTime() < now).length;
    return { method: ml(m), required: req, completed: comp, pending: pend, overdue: over, compliance: req ? Math.round((comp / req) * 100) : 0 };
  }).sort((a, b) => b.required - a.required);

  // 12-week trend (completed + failed by week — real; pending/overdue historical trend needs snapshots).
  const weekMs = 7 * 86400000;
  const start = now - 11 * weekMs;
  const weeks = Array.from({ length: 12 }, (_, i) => new Date(start + i * weekMs).toLocaleDateString([], { day: "2-digit", month: "short" }));
  const compByWeek = new Array(12).fill(0), failByWeek = new Array(12).fill(0);
  asmts.forEach(a => {
    const t = new Date(a.validated_at ?? a.assessed_at ?? a.created_at ?? 0).getTime();
    if (!t || t < start) return;
    const w = Math.min(11, Math.floor((t - start) / weekMs));
    if (COMPLETED.has(a.status)) compByWeek[w]++;
    if (COMPLETED.has(a.status) && a.score != null && a.score < PASS) failByWeek[w]++;
  });
  const trend = { weeks, completed: compByWeek, failed: failByWeek };

  // Readiness by competency domain (assessments → competency → domain, % passing).
  let domains: { name: string; pct: number }[] = [];
  const compIds = [...new Set(asmts.map(a => a.competency_id).filter(Boolean))];
  if (compIds.length) {
    try {
      const { data: comps } = await admin.from("framework_competencies").select("id, domain_id").in("id", compIds).limit(20000);
      const compDom = new Map<string, string>((comps ?? []).map((c: any) => [c.id, c.domain_id]));
      const domIds = [...new Set([...compDom.values()].filter(Boolean))];
      const domName = new Map<string, string>();
      if (domIds.length) { const { data: doms } = await admin.from("framework_domains").select("id, name").in("id", domIds).limit(5000); (doms ?? []).forEach((d: any) => domName.set(d.id, d.name)); }
      const byDom = new Map<string, { tot: number; pass: number }>();
      asmts.forEach(a => { if (!COMPLETED.has(a.status) || a.score == null) return; const dom = compDom.get(a.competency_id); if (!dom) return; const g = byDom.get(dom) ?? { tot: 0, pass: 0 }; g.tot++; if (a.score >= PASS) g.pass++; byDom.set(dom, g); });
      domains = [...byDom.entries()].map(([id, g]) => ({ name: domName.get(id) ?? "Domain", pct: g.tot ? Math.round((g.pass / g.tot) * 100) : 0 })).sort((a, b) => b.pct - a.pct).slice(0, 6);
    } catch { /* fail-soft */ }
  }

  // Reassessment due (competency rules → expiring competency decisions, 30d proxy).
  let reassessmentDue = 0;
  try {
    const T = new Date().toISOString().slice(0, 10); const d30 = new Date(now + 30 * 86400000).toISOString().slice(0, 10);
    const { data: decs, error } = await scopeH(admin.from("competency_decisions").select("nurse_id, competency_id, outcome, expiry_date, created_at").order("created_at", { ascending: false }).limit(20000));
    if (error) throw error;
    const seen = new Set<string>(); let due = 0;
    for (const d of decs ?? []) { const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k); if (d.expiry_date && d.expiry_date >= T && d.expiry_date <= d30 && ["competent", "competent_with_conditions", "provisionally_competent"].includes(d.outcome)) due++; }
    reassessmentDue = due;
  } catch { /* fail-soft */ }

  const readiness = (completed) ? Math.round((passed / Math.max(1, passed + failed + pending.length + overdue.length)) * 100) : 0;
  const kpis = { readiness, completed, pending: pending.length, overdue: overdue.length, failed, reassessmentDue };

  // Activity feed — recent assessment/scheduled events (audit_log). Fail-soft.
  let activity: any[] = [];
  try {
    const { data: au } = isSuper
      ? await admin.from("audit_log").select("id, action, created_at, actor:profiles!actor_id(full_name)").ilike("action", "%assess%").order("created_at", { ascending: false }).limit(12)
      : await admin.from("audit_log").select("id, action, created_at, actor:profiles!actor_id(full_name)").eq("hospital_id", hid ?? NONE).ilike("action", "%assess%").order("created_at", { ascending: false }).limit(12);
    activity = au ?? [];
  } catch { /* fail-soft */ }

  // Rule-based explainable AI insights.
  const ai: { text: string; why: string; priority: "high" | "medium" | "low" }[] = [];
  if (overdue.length) ai.push({ text: `Clear ${overdue.length} overdue assessment(s) — highest by ${overview.find(o => o.overdue)?.method ?? "method"}`, why: "Overdue assessments block competency currency", priority: "high" });
  if (failed) ai.push({ text: `${failed} failed assessment(s) — trigger remediation`, why: "Failed assessments require remediation (§5)", priority: "high" });
  if (reassessmentDue) ai.push({ text: `Schedule reassessment for ${reassessmentDue} competenc(ies) expiring ≤30 days`, why: "Reassessment intervals per competency framework", priority: "medium" });
  const worstMethod = [...overview].filter(o => o.required >= 3).sort((a, b) => a.compliance - b.compliance)[0];
  if (worstMethod && worstMethod.compliance < 80) ai.push({ text: `${worstMethod.method} completion is ${worstMethod.compliance}% — lowest method`, why: "Lowest-completion assessment method", priority: "low" });

  return {
    provisioned: schedProvisioned || asmtProvisioned,
    ready: schedProvisioned || asmtProvisioned,
    kpis, overview, trend, domains, pendingList, overdueList, upcoming, calendar, calDays, activity, ai,
    completionByMethod: overview.map(o => ({ name: o.method, pct: o.compliance })),
  };
}
