import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, METHOD_LABELS, type AssessmentMethod, type DecisionOutcome } from "@/lib/ckcm";

// Analytics & Reports Centre (assessor workspace). Hospital-scoped assessment
// intelligence — every figure computed live from real records, 30-day deltas
// against the previous 30 days, insights rule-derived and labeled. No
// invented composite scores: sections the data can't back (benchmarking,
// gap prediction, custom report builder, scheduled reports) are muted "soon".

export const dynamic = "force-dynamic";

const DIST_COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#3b82f6", "#a855f7", "#64748b"];

function delta(cur: number | null, prev: number | null): string | null {
  if (cur == null || prev == null || prev === 0) return null;
  const d = Math.round((cur - prev) / Math.abs(prev) * 100);
  if (d === 0) return "±0%";
  return `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%`;
}

export default async function ReportsCentrePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const myRoles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!myRoles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    redirect("/dashboard");
  }
  const hospitalId = me?.hospital_id ?? null;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  const d60 = new Date(now.getTime() - 60 * 86400000).toISOString();
  const d56 = new Date(now.getTime() - 8 * 7 * 86400000).toISOString();
  const in30 = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const in90 = new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10);

  const [{ data: nurses }, { data: assessRaw }, { data: logRaw }, { data: schedRaw }, { data: scoresRaw }, { data: credsRaw }] = await Promise.all([
    hospitalId
      ? admin.from("profiles").select("id, full_name, specialization").eq("hospital_id", hospitalId).eq("role", "nurse")
      : Promise.resolve({ data: [] }),
    admin.from("assessments")
      .select("score, method, assessed_at, assessor_id, competency_cycles!cycle_id(hospital_id, nurse_id)")
      .eq("status", "complete").not("score", "is", null).gte("assessed_at", d56)
      .order("assessed_at", { ascending: false }).limit(3000),
    hospitalId
      ? admin.from("skill_log_entries")
          .select("status, created_at, verified_at, profiles!nurse_id(hospital_id)")
          .order("created_at", { ascending: false }).limit(1500)
      : Promise.resolve({ data: [] }),
    hospitalId ? admin.from("scheduled_assessments").select("status, scheduled_for, nurse_id").eq("hospital_id", hospitalId).limit(1000) : Promise.resolve({ data: [] }),
    hospitalId ? admin.from("competency_scores").select("educator_validated, nurse_id").limit(3000) : Promise.resolve({ data: [] }),
    hospitalId ? admin.from("professional_credentials").select("expiry_date, nurse_id").not("expiry_date", "is", null).limit(2000) : Promise.resolve({ data: [] }),
  ]);

  const nurseIds = new Set((nurses ?? []).map(n => n.id));
  const { data: decisionsRaw } = nurseIds.size
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, outcome, validation_outcome, expiry_date, critical_failure, created_at, framework_competencies!competency_id(name)")
        .in("nurse_id", [...nurseIds]).order("created_at", { ascending: false }).limit(4000)
    : { data: [] };

  // ── Assessments (hospital-scoped) ──────────────────────────────────────────
  type A = { score: number; method: string; assessed_at: string; nurse_id: string; assessor_id: string | null };
  const assess: A[] = (assessRaw ?? [])
    .filter(a => {
      const c = a.competency_cycles as unknown as { hospital_id: string | null } | null;
      return !hospitalId || c?.hospital_id === hospitalId;
    })
    .map(a => ({
      score: a.score as number, method: a.method as string, assessed_at: a.assessed_at as string,
      nurse_id: (a.competency_cycles as unknown as { nurse_id: string }).nurse_id,
      assessor_id: a.assessor_id as string | null,
    }));
  const cur = assess.filter(a => a.assessed_at >= d30);
  const prev = assess.filter(a => a.assessed_at >= d60 && a.assessed_at < d30);
  const passOf = (xs: A[]) => xs.length ? Math.round(xs.filter(a => a.score >= 3).length / xs.length * 100) : null;
  const avgOf = (xs: A[]) => xs.length ? Math.round(xs.reduce((s, a) => s + a.score, 0) / xs.length * 10) / 10 : null;

  // ── Evidence pipeline ──────────────────────────────────────────────────────
  const entries = (logRaw ?? []).filter(e =>
    !hospitalId || (e.profiles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId);
  const ev30 = entries.filter(e => (e.created_at as string) >= d30);
  const evPrev = entries.filter(e => (e.created_at as string) >= d60 && (e.created_at as string) < d30);
  const rateOf = (xs: typeof entries) => {
    const v = xs.filter(e => e.status === "verified").length;
    const r = xs.filter(e => e.status === "rejected").length;
    return v + r ? Math.round(v / (v + r) * 100) : null;
  };
  const backlog = entries.filter(e => e.status === "pending").length;
  const reviewTimes = entries.filter(e => e.status === "verified" && e.verified_at && (e.verified_at as string) >= d30);
  const avgReviewH = reviewTimes.length
    ? Math.round(reviewTimes.reduce((s, e) => s + (new Date(e.verified_at as string).getTime() - new Date(e.created_at as string).getTime()), 0) / reviewTimes.length / 36e5)
    : null;

  // ── Scheduling ─────────────────────────────────────────────────────────────
  const sched = schedRaw ?? [];
  const overdue = sched.filter(s => s.status === "scheduled" && s.scheduled_for < now.toISOString()).length;

  // ── Decisions: risk, comps, expiry forecast ────────────────────────────────
  const seen = new Set<string>();
  const riskByNurse = new Map<string, "high" | "medium">();
  const compAgg = new Map<string, { pass: number; total: number }>();
  const expBuckets = [0, 0, 0]; // next 3 months
  let expiring30 = 0;
  for (const d of decisionsRaw ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    const expired = passing && d.expiry_date && d.expiry_date < today;
    if (d.critical_failure) riskByNurse.set(d.nurse_id, "high");
    else if ((!passing || expired) && riskByNurse.get(d.nurse_id) !== "high") riskByNurse.set(d.nurse_id, "medium");
    const name = (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency";
    const agg = compAgg.get(name) ?? { pass: 0, total: 0 };
    agg.total++;
    if (passing && !expired) agg.pass++;
    compAgg.set(name, agg);
    if (passing && d.expiry_date && d.expiry_date >= today && d.expiry_date <= in90) {
      const monthsAhead = Math.min(2, Math.floor((new Date(d.expiry_date).getTime() - now.getTime()) / (30 * 86400000)));
      expBuckets[monthsAhead]++;
      if (d.expiry_date <= in30) expiring30++;
    }
  }
  const highRisk = [...riskByNurse.values()].filter(v => v === "high").length;
  const medRisk = [...riskByNurse.values()].filter(v => v === "medium").length;
  const lowRisk = Math.max(0, nurseIds.size - highRisk - medRisk);
  const compRows = [...compAgg.entries()].filter(([, v]) => v.total >= 2)
    .map(([name, v]) => ({ name, pct: Math.round(v.pass / v.total * 100), n: v.total }));
  const weakest = [...compRows].sort((a, b) => a.pct - b.pct).slice(0, 4);
  const strongest = [...compRows].sort((a, b) => b.pct - a.pct).slice(0, 4);
  const credsExpiring90 = (credsRaw ?? []).filter(c => nurseIds.has(c.nurse_id) && c.expiry_date >= today && c.expiry_date <= in90).length;

  // ── Validation success ─────────────────────────────────────────────────────
  const hosScores = (scoresRaw ?? []).filter(s => nurseIds.has(s.nurse_id));
  const validationRate = hosScores.length
    ? Math.round(hosScores.filter(s => s.educator_validated).length / hosScores.length * 100) : null;

  // ── Trend (8 weeks) + distribution + heatmap ───────────────────────────────
  const weeks: { label: string; n: number; pct: number | null }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now.getTime() - (i + 1) * 7 * 86400000).toISOString();
    const end = new Date(now.getTime() - i * 7 * 86400000).toISOString();
    const inW = assess.filter(a => a.assessed_at >= start && a.assessed_at < end);
    weeks.push({ label: `W${8 - i}`, n: inW.length, pct: passOf(inW) });
  }
  const weekMax = Math.max(1, ...weeks.map(w => w.n));

  const byMethod = new Map<string, number>();
  for (const a of cur.length ? cur : assess) byMethod.set(a.method, (byMethod.get(a.method) ?? 0) + 1);
  const distTotal = [...byMethod.values()].reduce((a, b) => a + b, 0);
  const dist = [...byMethod.entries()].sort((a, b) => b[1] - a[1]).map(([m, n], i) => ({
    method: METHOD_LABELS[m as AssessmentMethod] ?? m, n,
    pct: Math.round(n / Math.max(1, distTotal) * 100), color: DIST_COLORS[i % DIST_COLORS.length],
  }));
  const gradient = dist.reduce<{ stops: string[]; acc: number }>((s, d) => ({
    stops: [...s.stops, `${d.color} ${s.acc}% ${s.acc + d.pct}%`], acc: s.acc + d.pct,
  }), { stops: [], acc: 0 }).stops.join(", ");

  const deptAgg = new Map<string, { nurses: string[]; }>();
  for (const n of nurses ?? []) {
    const dep = n.specialization ?? "General";
    const cur2 = deptAgg.get(dep) ?? { nurses: [] };
    cur2.nurses.push(n.id);
    deptAgg.set(dep, cur2);
  }
  const overdueByNurse = new Map<string, number>();
  for (const s of sched) {
    if (s.status === "scheduled" && s.scheduled_for < now.toISOString()) {
      overdueByNurse.set(s.nurse_id, (overdueByNurse.get(s.nurse_id) ?? 0) + 1);
    }
  }
  // Per-nurse pass profile from latest decisions (for the department table).
  const nursePassAgg = new Map<string, { pass: number; total: number }>();
  {
    const seen2 = new Set<string>();
    for (const d of decisionsRaw ?? []) {
      const key = `${d.nurse_id}:${d.competency_id}`;
      if (seen2.has(key)) continue;
      seen2.add(key);
      const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
      const expired = passing && d.expiry_date && d.expiry_date < today;
      const a = nursePassAgg.get(d.nurse_id) ?? { pass: 0, total: 0 };
      a.total++;
      if (passing && !expired) a.pass++;
      nursePassAgg.set(d.nurse_id, a);
    }
  }
  const heatRows = [...deptAgg.entries()].map(([dep, v]) => {
    const ids = new Set(v.nurses);
    const decided = v.nurses.map(id => nursePassAgg.get(id)).filter(Boolean) as { pass: number; total: number }[];
    const pass = decided.reduce((s, x) => s + x.pass, 0);
    const total = decided.reduce((s, x) => s + x.total, 0);
    const a30 = cur.filter(a => ids.has(a.nurse_id)).length;
    const od = v.nurses.reduce((s, id) => s + (overdueByNurse.get(id) ?? 0), 0);
    return { dep, nurses: v.nurses.length, passRate: total ? Math.round(pass / total * 100) : null, a30, overdue: od };
  }).sort((a, b) => b.nurses - a.nurses).slice(0, 8);

  const activeAssessors = new Set(cur.map(a => a.assessor_id).filter(Boolean)).size;
  const attention = highRisk + medRisk;

  // ── KPI row ────────────────────────────────────────────────────────────────
  const KPI: { label: string; value: string; d?: string | null; sub: string; alert?: boolean }[] = [
    { label: "Assessments Completed", value: String(cur.length), d: delta(cur.length, prev.length), sub: "last 30 days" },
    { label: "Pass Rate", value: passOf(cur) != null ? `${passOf(cur)}%` : "—", d: delta(passOf(cur), passOf(prev)), sub: "score ≥ 3, 30 days" },
    { label: "Average Score", value: avgOf(cur) != null ? `${avgOf(cur)}` : "—", d: delta(avgOf(cur), avgOf(prev)), sub: "Benner 0–6, 30 days" },
    { label: "Evidence Approved", value: rateOf(ev30) != null ? `${rateOf(ev30)}%` : "—", d: delta(rateOf(ev30), rateOf(evPrev)), sub: "verified ÷ decided, 30d" },
    { label: "Evidence Backlog", value: String(backlog), sub: "pending review now", alert: backlog > 10 },
    { label: "Overdue Assessments", value: String(overdue), sub: "past-due sessions", alert: overdue > 0 },
    { label: "Learners Needing Attention", value: String(attention), sub: "risk flags on record", alert: highRisk > 0 },
    { label: "Expiring in 30 Days", value: String(expiring30), sub: "competency expiries", alert: expiring30 > 0 },
  ];

  // ── Rule-derived insights ──────────────────────────────────────────────────
  const passDelta = delta(passOf(cur), passOf(prev));
  const insights: { icon: string; text: string }[] = [
    ...(passDelta && passOf(cur) != null ? [{ icon: passDelta.startsWith("▼") ? "🔻" : "📈", text: `Pass rate ${passOf(cur)}% (${passDelta} vs previous 30 days)` }] : []),
    ...(weakest.length ? [{ icon: "🎯", text: `Weakest competency: ${weakest[0].name} (${weakest[0].pct}% passing of ${weakest[0].n})` }] : []),
    ...(expiring30 ? [{ icon: "⏳", text: `${expiring30} competenc${expiring30 === 1 ? "y" : "ies"} expire within 30 days` }] : []),
    ...(highRisk ? [{ icon: "🚩", text: `${highRisk} learner${highRisk === 1 ? "" : "s"} carry critical-failure flags` }] : []),
    ...(backlog ? [{ icon: "🖊️", text: `${backlog} evidence item${backlog === 1 ? "" : "s"} awaiting validation` }] : []),
  ];
  const recommendations: { text: string; href: string }[] = [
    ...(weakest.length ? [{ text: `Plan focused assessment on ${weakest[0].name}`, href: "/assessor/assess" }] : []),
    ...(expiring30 ? [{ text: "Schedule reassessments for expiring competencies", href: "/assessor/calendar" }] : []),
    ...(backlog ? [{ text: "Clear the evidence validation backlog", href: "/assessor/logbook" }] : []),
    ...(highRisk ? [{ text: "Review high-risk learners in Risk & Remediation", href: "/assessor/remediation" }] : []),
  ];
  const copilotPrompt = `Summarise this hospital's assessment intelligence and suggest priorities: ${cur.length} assessments in 30 days (pass rate ${passOf(cur) ?? "n/a"}%), weakest competency ${weakest[0]?.name ?? "n/a"}, ${expiring30} expiring within 30 days, ${backlog} evidence items pending, ${highRisk} high-risk learners.`;

  const REPORTS = [
    { name: "Assessment History", href: "/api/reports/history", desc: "Every assessment with scores and methods" },
    { name: "Assessor Analytics", href: "/api/reports/analytics", desc: "Per-assessor volume and scoring profile" },
    { name: "Learners", href: "/api/reports/learners", desc: "Per-learner status, progress and risk" },
    { name: "Evidence Queue", href: "/api/reports/evidence", desc: "Validation queue with ages and status" },
    { name: "Passport Centre", href: "/api/reports/passports", desc: "Per-clinician passport health" },
    { name: "Quality Audits", href: "/api/reports/quality", desc: "All audits with compliance and CAPA" },
  ];

  const pct = (v: number | null) => v != null ? `${v}%` : "—";

  return (
    <div className="max-w-[1150px]">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">📊 Assessment Dashboard</h1>
          <p className="text-gray-400 text-sm mt-0.5">Analytics &amp; Reports landing — live, hospital-scoped intelligence with drill-down into every module. Deltas vs the previous 30 days.</p>
        </div>
        <a href="/api/reports/history" className="text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">⬇ Export Report</a>
      </div>

      {/* Module drill-down (Architecture spec: dashboard links to every module) */}
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        {[
          ["Learner Performance", "/assessor/reports/learners"],
          ["Competency Analytics", "/assessor/reports/competencies"],
          ["Assessment Quality", "/assessor/reports/quality"],
          ["Evidence Analytics", "/assessor/reports/evidence"],
          ["Productivity & Workload", "/assessor/reports/productivity"],
          ["Risk & Remediation", "/assessor/remediation"],
          ["Department Reports", "/assessor/reports/departments"],
          ["Benchmarking", "/assessor/reports/benchmarking"],
          ["Workforce Intelligence", "/assessor/reports/workforce"],
          ["Report Library", "/assessor/history"],
        ].map(([t, href]) => (
          <Link key={t} href={href} className="text-[11px] font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-indigo-300 transition-colors">{t}</Link>
        ))}
        {["Report Builder", "Scheduled Reports"].map(t => (
          <span key={t} className="text-[11px] text-gray-300 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 select-none" title="Not available yet — no backing store">
            {t} <span className="text-[8px] font-bold uppercase">soon</span>
          </span>
        ))}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 mb-4">
        {KPI.map(k => (
          <div key={k.label} className={`bg-white border rounded-xl px-3 py-2.5 ${k.alert ? "border-red-200 bg-red-50/40" : "border-gray-200"}`}>
            <div className="flex items-baseline gap-1.5">
              <p className={`text-lg font-bold ${k.alert ? "text-red-600" : "text-gray-900"}`}>{k.value}</p>
              {k.d && <span className={`text-[9px] font-bold ${k.d.startsWith("▼") ? "text-red-500" : k.d.startsWith("▲") ? "text-green-600" : "text-gray-400"}`}>{k.d}</span>}
            </div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-tight">{k.label}</p>
            <p className="text-[8px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-4 mb-4">
        <div className="space-y-4 min-w-0">
          {/* Trend + distribution */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-bold text-gray-900 mb-3">Assessment Trend <span className="text-[10px] font-normal text-gray-400">(8 weeks)</span></p>
              <div className="flex items-end gap-1.5 h-28">
                {weeks.map(w => (
                  <div key={w.label} className="flex-1 flex flex-col items-center gap-1" title={`${w.label}: ${w.n} assessments${w.pct != null ? `, ${w.pct}% pass` : ""}`}>
                    <span className="text-[8px] text-gray-400">{w.pct != null ? `${w.pct}%` : ""}</span>
                    <div className="w-full bg-gray-100 rounded-t flex items-end" style={{ height: "72px" }}>
                      <div className="w-full bg-indigo-500 rounded-t" style={{ height: `${Math.round(w.n / weekMax * 70)}px` }} />
                    </div>
                    <span className="text-[8px] text-gray-400">{w.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-gray-400 mt-2">Bars = completed assessments per week · labels = weekly pass rate.</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-bold text-gray-900 mb-3">Assessment Distribution <span className="text-[10px] font-normal text-gray-400">({cur.length ? "30 days" : "all records"})</span></p>
              {dist.length ? (
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-full shrink-0 relative" style={{ background: `conic-gradient(${gradient})` }}>
                    <div className="absolute inset-3 bg-white rounded-full flex flex-col items-center justify-center">
                      <span className="text-sm font-bold text-gray-900">{distTotal}</span>
                      <span className="text-[7px] text-gray-400 uppercase">total</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1">
                    {dist.slice(0, 6).map(d2 => (
                      <div key={d2.method} className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d2.color }} />
                        <span className="text-gray-600 flex-1 truncate">{d2.method}</span>
                        <span className="font-bold text-gray-800">{d2.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="text-xs text-gray-400">No assessments recorded yet.</p>}
            </div>
          </div>

          {/* Department heatmap + risk */}
          <div className="grid md:grid-cols-2 gap-4">
            <div id="departments" className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-bold text-gray-900 mb-3">Department Performance</p>
              {heatRows.length ? (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-[8px] text-gray-400 uppercase tracking-wider">
                      <th className="pb-1.5">Department</th><th className="pb-1.5 text-center">Pass</th>
                      <th className="pb-1.5 text-center">30d</th><th className="pb-1.5 text-center">Overdue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {heatRows.map(r => (
                      <tr key={r.dep}>
                        <td className="py-1.5 text-gray-700">{r.dep} <span className="text-gray-300">({r.nurses})</span></td>
                        <td className="py-1.5 text-center">
                          {r.passRate != null
                            ? <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${r.passRate >= 80 ? "bg-green-100 text-green-700" : r.passRate >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>{r.passRate}%</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-1.5 text-center text-gray-600">{r.a30}</td>
                        <td className="py-1.5 text-center">{r.overdue ? <span className="font-bold text-red-600">{r.overdue}</span> : <span className="text-gray-300">0</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-xs text-gray-400">No learners on record.</p>}
              <p className="text-[9px] text-gray-400 mt-2">Departments = clinician specialisations · pass from latest decisions.</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-bold text-gray-900 mb-3">Learner Risk <span className="text-[10px] font-normal text-gray-400">(from decision records)</span></p>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-red-50 border border-red-100 rounded-lg p-2.5 text-center">
                  <p className="text-xl font-bold text-red-600">{highRisk}</p><p className="text-[8px] font-bold text-red-400 uppercase">High risk</p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-2.5 text-center">
                  <p className="text-xl font-bold text-amber-600">{medRisk}</p><p className="text-[8px] font-bold text-amber-400 uppercase">Medium</p>
                </div>
                <div className="bg-green-50 border border-green-100 rounded-lg p-2.5 text-center">
                  <p className="text-xl font-bold text-green-600">{lowRisk}</p><p className="text-[8px] font-bold text-green-400 uppercase">Low</p>
                </div>
              </div>
              <p className="text-xs text-gray-600">{nurseIds.size} learners analysed — high = critical failure on record; medium = failed or expired competencies. No predictive scoring.</p>
              <Link href="/assessor/remediation" className="mt-2 inline-block text-[11px] font-semibold text-indigo-600 hover:underline">View Risk &amp; Remediation →</Link>
            </div>
          </div>

          {/* Competency analytics */}
          <div id="competency" className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-sm font-bold text-gray-900 mb-3">Competency Analytics</p>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1.5">Weakest</p>
                {weakest.length ? weakest.map(c => (
                  <div key={c.name} className="flex items-center gap-2 text-[11px] py-0.5">
                    <span className="text-gray-600 flex-1 truncate">{c.name}</span>
                    <span className="font-bold text-red-600">{c.pct}%</span>
                  </div>
                )) : <p className="text-xs text-gray-400">Needs ≥2 decisions per competency.</p>}
              </div>
              <div>
                <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest mb-1.5">Strongest</p>
                {strongest.length ? strongest.map(c => (
                  <div key={c.name} className="flex items-center gap-2 text-[11px] py-0.5">
                    <span className="text-gray-600 flex-1 truncate">{c.name}</span>
                    <span className="font-bold text-green-600">{c.pct}%</span>
                  </div>
                )) : <p className="text-xs text-gray-400">—</p>}
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Expiry forecast (90 days)</p>
                <div className="flex items-end gap-2 h-16 mb-1">
                  {expBuckets.map((n, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${n} expiring`}>
                      <span className="text-[9px] font-bold text-gray-700">{n}</span>
                      <div className="w-full bg-amber-400 rounded-t" style={{ height: `${Math.max(3, n / Math.max(1, ...expBuckets) * 40)}px` }} />
                      <span className="text-[8px] text-gray-400">M{i + 1}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-gray-400">Competency expiries by month ahead · plus {credsExpiring90} credential{credsExpiring90 === 1 ? "" : "s"} expiring in 90d. Real dates — no prediction.</p>
              </div>
            </div>
          </div>

          {/* Evidence + productivity */}
          <div className="grid md:grid-cols-2 gap-4">
            <div id="evidence" className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-bold text-gray-900 mb-3">Evidence Analytics <span className="text-[10px] font-normal text-gray-400">(30 days)</span></p>
              <div className="grid grid-cols-5 gap-1 text-center mb-3">
                {[
                  ["Submitted", ev30.length, "text-gray-900"],
                  ["Approved", ev30.filter(e => e.status === "verified").length, "text-green-600"],
                  ["Rejected", ev30.filter(e => e.status === "rejected").length, "text-red-600"],
                  ["Returned", ev30.filter(e => e.status === "changes_requested").length, "text-amber-600"],
                  ["Pending", backlog, "text-blue-600"],
                ].map(([l, n, cls]) => (
                  <div key={l as string}>
                    <p className={`text-base font-bold ${cls}`}>{n as number}</p>
                    <p className="text-[8px] font-bold text-gray-400 uppercase">{l}</p>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-gray-400">Approval rate {pct(rateOf(ev30))} · validation success (educator) {pct(validationRate)}. Rejection reasons aren&apos;t categorised — verifier comments are free-text (visible in the Evidence Centre).</p>
            </div>
            <div id="productivity" className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-bold text-gray-900 mb-3">Productivity Overview <span className="text-[10px] font-normal text-gray-400">(30 days)</span></p>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-lg font-bold text-gray-900">{(cur.length / 30).toFixed(1)}</p><p className="text-[9px] text-gray-400 uppercase font-bold">Assessments / day</p></div>
                <div><p className="text-lg font-bold text-gray-900">{activeAssessors}</p><p className="text-[9px] text-gray-400 uppercase font-bold">Active assessors</p></div>
                <div><p className="text-lg font-bold text-gray-900">{avgReviewH != null ? `${avgReviewH}h` : "—"}</p><p className="text-[9px] text-gray-400 uppercase font-bold">Evidence review time</p></div>
                <div><p className="text-lg font-bold text-gray-900">{pct(passOf(cur))}</p><p className="text-[9px] text-gray-400 uppercase font-bold">Pass rate</p></div>
              </div>
              <p className="text-[9px] text-gray-400 mt-2.5">Per-assessment duration isn&apos;t timed outside cockpit sessions, so no &quot;productivity score&quot; composite is shown.</p>
            </div>
          </div>
        </div>

        {/* Rail */}
        <div className="space-y-4">
          <div className="bg-[#1e1b4b] rounded-xl p-4 text-white">
            <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest mb-1">Assessment Intelligence</p>
            <p className="text-[9px] text-indigo-300/70 mb-2.5">Rule-derived from live records — no generative AI ran for these signals.</p>
            {insights.length ? (
              <ul className="space-y-1.5">
                {insights.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-[11px] text-indigo-100"><span>{s.icon}</span>{s.text}</li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-indigo-200">No notable signals this period.</p>}
            {recommendations.length > 0 && (
              <>
                <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest mt-3 mb-1.5">Recommendations</p>
                <ul className="space-y-1">
                  {recommendations.map((r2, i) => (
                    <li key={i}><Link href={r2.href} className="text-[11px] text-indigo-100 hover:text-white hover:underline">✓ {r2.text}</Link></li>
                  ))}
                </ul>
              </>
            )}
            <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(copilotPrompt)}`}
              className="mt-3 block text-center text-[11px] font-bold bg-indigo-500 hover:bg-indigo-400 rounded-lg px-3 py-2 transition-colors">
              ✨ Ask AI Copilot for a full readout
            </Link>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Quick Actions</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[["👩‍⚕️", "Learners", "/assessor/nurses"], ["🎯", "Remediation", "/assessor/remediation"], ["📐", "Indicators", "/assessor/quality/indicators"], ["📁", "Report Library", "#library"]].map(([i, l, h]) => (
                <Link key={l} href={h} className="border border-gray-100 rounded-lg px-2 py-2.5 text-center hover:border-indigo-200 transition-colors">
                  <p className="text-base">{i}</p>
                  <p className="text-[9px] font-semibold text-gray-600 leading-tight mt-0.5">{l}</p>
                </Link>
              ))}
            </div>
          </div>

          <div id="library" className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Report Library <span className="text-gray-300 normal-case">· live CSV</span></p>
            <div className="space-y-1.5">
              {REPORTS.map(r2 => (
                <a key={r2.name} href={r2.href} className="block border border-gray-100 rounded-lg px-3 py-2 hover:border-indigo-200 transition-colors">
                  <p className="text-[11px] font-semibold text-gray-800">⬇ {r2.name}</p>
                  <p className="text-[9px] text-gray-400">{r2.desc}</p>
                </a>
              ))}
            </div>
            <p className="text-[9px] text-gray-400 mt-2">Exports are CSV (Excel-compatible). PDF/PPT packs and scheduled email reports aren&apos;t built.</p>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-gray-400">
        Honest scope: all data is live and permission-scoped to your hospital. Benchmarking across organisations, competency-gap prediction,
        a custom report builder and scheduled reports have no backing yet and are marked soon. Inter-rater agreement needs overlapping
        multi-assessor data before it can be computed honestly.
      </p>
    </div>
  );
}
