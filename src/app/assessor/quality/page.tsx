import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// Live Quality Monitor (Quality & Governance hub). Every figure is computed
// from live records — decisions, assessments, audits, CAPA actions, logbook
// backlog. The Quality Score is an equal-weighted mean of the computable
// indicators and is labeled as such; nothing here is a placeholder number.

export const dynamic = "force-dynamic";

export default async function QualityMonitorPage() {
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
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekAhead = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const w12 = new Date(now.getTime() - 12 * 7 * 86400000).toISOString();

  const [{ data: nurses }, { data: auditsRaw }, { data: capaRaw }, { data: assessRaw }, { data: schedRaw }, { data: pendingLog }, { data: activityRaw }, { data: tplComps }] = await Promise.all([
    hospitalId
      ? admin.from("profiles").select("id").eq("hospital_id", hospitalId).eq("role", "nurse")
      : Promise.resolve({ data: [] }),
    hospitalId ? admin.from("audits").select("audit_type, compliance_pct, conducted_at").eq("hospital_id", hospitalId).order("conducted_at", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
    hospitalId ? admin.from("capa_actions").select("status, priority, due_date, created_at, closed_at").eq("hospital_id", hospitalId).limit(500) : Promise.resolve({ data: [] }),
    admin.from("assessments")
      .select("score, assessed_at, competency_cycles!cycle_id(hospital_id)")
      .eq("status", "complete").not("score", "is", null).gte("assessed_at", w12)
      .order("assessed_at", { ascending: false }).limit(1000),
    hospitalId ? admin.from("scheduled_assessments").select("status, scheduled_for").eq("hospital_id", hospitalId).limit(500) : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("skill_log_entries").select("id, profiles!nurse_id(hospital_id)").eq("status", "pending").limit(500)
      : Promise.resolve({ data: [] }),
    admin.from("audit_log")
      .select("actor_name, action, entity_name, created_at")
      .in("action", ["conduct_audit", "create_capa", "update_capa", "conduct_assessment", "complete_osce"])
      .order("created_at", { ascending: false }).limit(7),
    admin.from("competency_skills")
      .select("competency_id, framework_competencies!competency_id(name), skill_checklists(checklist_items(id))")
      .eq("is_active", true).limit(300),
  ]);

  const nurseIds = (nurses ?? []).map(n => n.id);
  const { data: decisionsRaw } = nurseIds.length
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, outcome, validation_outcome, expiry_date, created_at, framework_competencies!competency_id(framework_domains(name))")
        .in("nurse_id", nurseIds).order("created_at", { ascending: false }).limit(2000)
    : { data: [] };

  // ── Latest decision per nurse+competency → compliance + domains ────────────
  const seen = new Set<string>();
  let latestTotal = 0, latestCompliant = 0, expired = 0;
  const domainAgg = new Map<string, { pass: number; total: number }>();
  for (const d of decisionsRaw ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latestTotal++;
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    const isExpired = passing && d.expiry_date && d.expiry_date < today;
    if (isExpired) expired++;
    const compliant = passing && d.validation_outcome === "validated" && !isExpired;
    if (compliant) latestCompliant++;
    const domain = (d.framework_competencies as unknown as { framework_domains: { name: string } | null } | null)?.framework_domains?.name ?? "Other";
    const agg = domainAgg.get(domain) ?? { pass: 0, total: 0 };
    agg.total++;
    if (passing && !isExpired) agg.pass++;
    domainAgg.set(domain, agg);
  }
  const domains = [...domainAgg.entries()]
    .sort((a, b) => b[1].total - a[1].total).slice(0, 7)
    .map(([name, v]) => ({ name, pct: Math.round(v.pass / v.total * 100), n: v.total }));
  const competencyCompliance = latestTotal ? Math.round(latestCompliant / latestTotal * 100) : null;

  // ── Audits ─────────────────────────────────────────────────────────────────
  const audits = auditsRaw ?? [];
  const auditsMonth = audits.filter(a => (a.conducted_at ?? "") >= monthStart);
  const withCompliance = audits.filter(a => a.compliance_pct != null);
  const auditCompliance = withCompliance.length
    ? Math.round(withCompliance.reduce((s, a) => s + Number(a.compliance_pct), 0) / withCompliance.length)
    : null;
  const byType = ["concurrent", "retrospective", "clinical"].map(t => ({
    type: t, n: auditsMonth.filter(a => a.audit_type === t).length,
  }));

  // ── CAPA ───────────────────────────────────────────────────────────────────
  const capa = capaRaw ?? [];
  const openStates = ["open", "in_progress"];
  const capaOpen = capa.filter(c => openStates.includes(c.status));
  const capaOverdue = capaOpen.filter(c => c.due_date && c.due_date < today);
  const capaDueWeek = capaOpen.filter(c => c.due_date && c.due_date >= today && c.due_date <= weekAhead);
  const capaInProgress = capa.filter(c => c.status === "in_progress");
  const capaDoneMonth = capa.filter(c => ["completed", "verified", "closed"].includes(c.status) && (c.closed_at ?? c.created_at ?? "") >= monthStart);
  const highRisk = capaOpen.filter(c => c.priority === "high");

  // ── Scheduling completion + backlog ────────────────────────────────────────
  const sched = schedRaw ?? [];
  const pastSched = sched.filter(s => s.scheduled_for < now.toISOString() && s.status !== "cancelled");
  const schedCompletion = pastSched.length
    ? Math.round(pastSched.filter(s => s.status === "completed").length / pastSched.length * 100)
    : null;
  const backlog = (pendingLog ?? []).filter(e =>
    !hospitalId || (e.profiles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId).length;

  // ── Quality Score: equal-weighted mean of computable indicators ────────────
  const parts = [competencyCompliance, auditCompliance, schedCompletion].filter((v): v is number => v != null);
  const qualityScore = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;

  // ── 12-week assessment pass trend (this hospital) ──────────────────────────
  const hosAssess = (assessRaw ?? []).filter(a =>
    !hospitalId || (a.competency_cycles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId);
  const weeks: { label: string; pct: number | null; n: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now.getTime() - (i + 1) * 7 * 86400000);
    const end = new Date(now.getTime() - i * 7 * 86400000);
    const inWeek = hosAssess.filter(a => a.assessed_at && a.assessed_at >= start.toISOString() && a.assessed_at < end.toISOString());
    weeks.push({
      label: `W${12 - i}`,
      pct: inWeek.length ? Math.round(inWeek.filter(a => a.score >= 3).length / inWeek.length * 100) : null,
      n: inWeek.length,
    });
  }

  // ── Audit templates library: competencies with governed checklists ─────────
  const tplAgg = new Map<string, { name: string; items: number }>();
  for (const cs of tplComps ?? []) {
    const items = (cs.skill_checklists ?? []).reduce((n: number, cl: { checklist_items: { id: string }[] }) => n + (cl.checklist_items?.length ?? 0), 0);
    if (!items) continue;
    const name = (cs.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency";
    const cur = tplAgg.get(cs.competency_id) ?? { name, items: 0 };
    cur.items += items;
    tplAgg.set(cs.competency_id, cur);
  }
  const templates = [...tplAgg.entries()].slice(0, 8).map(([id, v]) => ({ id, ...v }));

  const alerts: { icon: string; text: string; href: string; danger?: boolean }[] = [
    ...(capaOverdue.length ? [{ icon: "🔴", text: `${capaOverdue.length} improvement action${capaOverdue.length === 1 ? "" : "s"} overdue`, href: "/assessor/quality/capa", danger: true }] : []),
    ...(highRisk.length ? [{ icon: "⚠️", text: `${highRisk.length} high-priority CAPA open`, href: "/assessor/quality/capa", danger: true }] : []),
    ...(backlog ? [{ icon: "🖊️", text: `${backlog} logbook entr${backlog === 1 ? "y" : "ies"} awaiting evidence validation`, href: "/assessor/logbook" }] : []),
    ...(expired ? [{ icon: "⏳", text: `${expired} expired competenc${expired === 1 ? "y" : "ies"} need reassessment`, href: "/assessor/passports" }] : []),
  ];

  const ACT_LABEL: Record<string, string> = {
    conduct_audit: "completed an audit", create_capa: "created a CAPA action", update_capa: "updated a CAPA action",
    conduct_assessment: "conducted an assessment", complete_osce: "completed an OSCE",
  };

  const KPI = [
    { label: "Live Quality Score", value: qualityScore != null ? `${qualityScore}%` : "—", sub: qualityScore != null ? `mean of ${parts.length} live indicators` : "no data yet" },
    { label: "Audits This Month", value: String(auditsMonth.length), sub: `${audits.length} all-time` },
    { label: "Compliance Rate", value: auditCompliance != null ? `${auditCompliance}%` : "—", sub: "avg audit compliance" },
    { label: "Actions Open", value: String(capaOpen.length), sub: capaOverdue.length ? `${capaOverdue.length} overdue` : "none overdue", alert: capaOverdue.length > 0 },
    { label: "High Risk Issues", value: String(highRisk.length), sub: "open high-priority CAPA", alert: highRisk.length > 0 },
  ];

  const QUICK = [
    { icon: "📋", label: "Start Concurrent Review", href: "/assessor/quality/concurrent" },
    { icon: "🗂️", label: "Start Retrospective Review", href: "/assessor/quality/retrospective" },
    { icon: "🩹", label: "Start Clinical Audit", href: "/assessor/quality/clinical" },
    { icon: "🛠️", label: "Create CAPA Action", href: "/assessor/quality/capa?new=1" },
    { icon: "📐", label: "View Indicators", href: "/assessor/quality/indicators" },
    { icon: "⬇️", label: "Export Audits CSV", href: "/api/reports/quality" },
  ];

  const FLOW = [
    ["🗂️", "Competency Framework", "Define the standard"],
    ["📋", "Assessment & Checklist", "Evidence is collected"],
    ["✅", "Validation", "Assessor & educator validate"],
    ["🛂", "Competency Passport", "Validated evidence stored"],
    ["📈", "Quality Engine", "Analyzes & monitors"],
    ["🏛️", "Governance & Reporting", "Insights drive improvement"],
  ];

  return (
    <div className="max-w-[1150px]">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">🛡️ Quality &amp; Governance</h1>
        <p className="text-gray-400 text-sm mt-0.5">Live quality monitoring, audits, compliance and improvement — computed from validated competency evidence.</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
        {KPI.map(k => (
          <div key={k.label} className={`bg-white border rounded-xl px-4 py-3 ${k.alert ? "border-red-200 bg-red-50/40" : "border-gray-200"}`}>
            <p className={`text-xl font-bold ${k.alert ? "text-red-600" : "text-gray-900"}`}>{k.value}</p>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-tight">{k.label}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-4 mb-4">
        <div className="space-y-4 min-w-0">
          {/* Live Quality Monitor */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-sm font-bold text-gray-900 mb-3">Live Quality Monitor</p>
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Quality Domains — competency pass rate</p>
                {domains.length ? (
                  <div className="space-y-2">
                    {domains.map(d => (
                      <div key={d.name}>
                        <div className="flex items-center justify-between text-[11px] mb-0.5">
                          <span className="text-gray-700">{d.name}</span>
                          <span className="font-bold text-gray-900">{d.pct}% <span className="font-normal text-gray-300">({d.n})</span></span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${d.pct >= 80 ? "bg-green-500" : d.pct >= 60 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${d.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-gray-400">No competency decisions on record yet.</p>}
                <p className="text-[9px] text-gray-400 mt-2">From each clinician&apos;s latest decision per competency, grouped by framework domain.</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Assessment pass trend (12 weeks)</p>
                <div className="flex items-end gap-1 h-28">
                  {weeks.map(w => (
                    <div key={w.label} className="flex-1 flex flex-col items-center gap-1" title={w.pct != null ? `${w.label}: ${w.pct}% of ${w.n}` : `${w.label}: no assessments`}>
                      <div className="w-full bg-gray-100 rounded-t flex items-end" style={{ height: "88px" }}>
                        {w.pct != null && <div className="w-full bg-indigo-400 rounded-t" style={{ height: `${Math.max(4, w.pct * 0.88)}px` }} />}
                      </div>
                      <span className="text-[8px] text-gray-400">{w.label}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-gray-400 mt-2">% of completed assessments scoring ≥3 (Benner passing) per week; empty bars = no assessments that week.</p>
              </div>
            </div>
          </div>

          {/* Audit overview + CAPA */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-bold text-gray-900 mb-3">Audit Overview (This Month)</p>
              {auditsMonth.length ? (
                <div className="space-y-2">
                  {byType.map(t => (
                    <div key={t.type} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 capitalize">{t.type} audits</span>
                      <span className="font-bold text-gray-900">{t.n}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-50">
                    <span className="text-gray-600">Average compliance</span>
                    <span className="font-bold text-gray-900">{auditCompliance != null ? `${auditCompliance}%` : "—"}</span>
                  </div>
                </div>
              ) : <p className="text-xs text-gray-400">No audits conducted this month — start one from Quick Actions.</p>}
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-gray-900">Improvement Actions (CAPA)</p>
                <Link href="/assessor/quality/capa" className="text-[10px] text-indigo-600 font-semibold hover:underline">View all →</Link>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between"><span className="text-red-600">🔴 Overdue</span><span className="font-bold">{capaOverdue.length}</span></div>
                <div className="flex items-center justify-between"><span className="text-amber-600">🟠 Due this week</span><span className="font-bold">{capaDueWeek.length}</span></div>
                <div className="flex items-center justify-between"><span className="text-blue-600">🔵 In progress</span><span className="font-bold">{capaInProgress.length}</span></div>
                <div className="flex items-center justify-between"><span className="text-green-600">🟢 Completed (month)</span><span className="font-bold">{capaDoneMonth.length}</span></div>
              </div>
            </div>
          </div>

          {/* Flow strip */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-sm font-bold text-gray-900 mb-3">How Quality is Generated in Competen</p>
            <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
              {FLOW.map(([icon, t, sub], i) => (
                <div key={t} className="flex items-center gap-1.5 shrink-0">
                  <div className={`rounded-lg border px-2.5 py-2 w-[120px] ${t === "Quality Engine" ? "border-indigo-300 bg-indigo-50" : "border-gray-100 bg-gray-50/60"}`}>
                    <p className="text-sm">{icon}</p>
                    <p className="text-[10px] font-bold text-gray-800 leading-tight">{t}</p>
                    <p className="text-[8px] text-gray-400 leading-tight mt-0.5">{sub}</p>
                  </div>
                  {i < FLOW.length - 1 && <span className="text-gray-300 text-xs">→</span>}
                </div>
              ))}
            </div>
            <p className="text-[9px] text-gray-400 mt-2">Quality is not an isolated activity — it is generated automatically from competency assessments, evidence and validation.</p>
          </div>
        </div>

        {/* Rail */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Quick Actions</p>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK.map(q => (
                <Link key={q.label} href={q.href}
                  className="border border-gray-100 rounded-lg px-2 py-2.5 text-center hover:border-indigo-200 transition-colors">
                  <p className="text-base">{q.icon}</p>
                  <p className="text-[9px] font-semibold text-gray-600 leading-tight mt-0.5">{q.label}</p>
                </Link>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Audit Templates Library</p>
            {templates.length ? (
              <div className="space-y-1">
                {templates.map(t => (
                  <Link key={t.id} href={`/assessor/quality/clinical?c=${t.id}`}
                    className="flex items-center gap-2 text-[11px] text-gray-600 hover:text-indigo-700 py-0.5">
                    <span>📋</span><span className="flex-1 truncate">{t.name}</span>
                    <span className="text-[9px] text-gray-300">{t.items} items</span>
                  </Link>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400">No competencies have governed checklists yet.</p>}
            <p className="text-[9px] text-gray-400 mt-2">Templates are the competencies&apos; own checklists — audits reference them dynamically, never copies.</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Alerts</p>
            {alerts.length ? (
              <div className="space-y-1.5">
                {alerts.map((a, i) => (
                  <Link key={i} href={a.href} className={`flex items-start gap-2 text-[11px] hover:underline ${a.danger ? "text-red-600" : "text-gray-600"}`}>
                    <span>{a.icon}</span><span>{a.text}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400">No active quality alerts. ✅</p>}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Recent Activity</p>
            {(activityRaw ?? []).length ? (
              <ul className="space-y-1.5">
                {(activityRaw ?? []).map((a, i) => (
                  <li key={i} className="text-[11px] text-gray-600">
                    <span className="font-medium text-gray-800">{a.actor_name ?? "—"}</span> {ACT_LABEL[a.action] ?? a.action}
                    {a.entity_name ? <span className="text-gray-400"> · {a.entity_name}</span> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-gray-400">No quality activity yet.</p>}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-gray-400">
        Honest scope: the Quality Score is an equal-weighted mean of the computable indicators (labeled on each tile) — not a clinically weighted index.
        Quality domains map to framework domains from real decisions. Executive/board reporting packs are not built yet.
      </p>
    </div>
  );
}
