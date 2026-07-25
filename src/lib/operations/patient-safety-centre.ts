// Patient Safety Centre (UMG-QS-007) — the Unit Manager's proactive patient-safety command centre. Per the
// high-fidelity spec this is a manager LENS/consolidation over the operational safety stores; it does not fork
// them. Real (all derived from the records' own fields — no new store): the KPI ribbon, the real-time Safety
// Surveillance tiles (op_safety_alerts + op_observations + op_escalations + op_patients), the Safety Events
// donut + 6-month severity trend + Never Events (op_incidents), High-Risk Patient Monitoring (op_patients +
// latest observation EWS), Safety Improvement Projects (op_quality_actions), rule-based AI insights and
// Learning From Events (closed incidents with a corrective action). Panels with no store yet — IPSG goal
// compliance, external Alerts & Bulletins, Safety Huddles, Clinical Safety Rounds, Restraint/Lab-critical
// tiles, harm-rate denominators — are surfaced as honest next-phase, never fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

const TYPE_LABEL: Record<string, string> = { medication: "Medication Related", falls: "Patient Falls", equipment: "Equipment / Device", pressure_injury: "Pressure Injury", infection: "Infection Control", behaviour: "Behaviour", documentation: "Documentation / ID", sentinel: "Sentinel Event", other: "Other" };
const TYPE_COLOR: Record<string, string> = { medication: "#f97316", falls: "#ef4444", equipment: "#14b8a6", pressure_injury: "#f59e0b", infection: "#22c55e", behaviour: "#ec4899", documentation: "#3b82f6", sentinel: "#991b1b", other: "#94a3b8" };
const TYPES = ["medication", "falls", "equipment", "pressure_injury", "infection", "behaviour", "documentation", "sentinel", "other"];
const ACUITY_SCORE: Record<string, number> = { critical: 8.5, high: 7, moderate: 5, stable: 3 };

export async function loadPatientSafetyCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const safe = async (q: any) => { const res = await q; return res.error ? [] : (res.data ?? []); };

  const incRes = await scope(admin.from("op_incidents")
    .select("id, incident_type, severity, near_miss, status, description, corrective_action, reported_by_name, created_at, closed_at, op_patients!patient_id(label)"))
    .order("created_at", { ascending: false }).limit(5000);
  if (incRes.error && missing(incRes.error)) return { provisioned: false as const };
  const incidents = (incRes.error ? [] : incRes.data ?? []) as any[];

  const [alerts, obs, esc, patients, actions] = await Promise.all([
    safe(scope(admin.from("op_safety_alerts").select("id, category, severity, note, active, created_at")).limit(3000)),
    safe(scope(admin.from("op_observations").select("id, status, concern, ews_score, escalation_triggered, patient_id, recorded_at, created_at")).limit(6000)),
    safe(scope(admin.from("op_escalations").select("id, status, severity, level, created_at")).limit(3000)),
    safe(scope(admin.from("op_patients").select("id, label, acuity_level, dependency_level, isolation_status, risk_level, operational_status")).limit(2000)),
    safe(scope(admin.from("op_quality_actions").select("id, action_type, title, status, priority, owner_name, due_at, created_at")).limit(2000)),
  ]);

  const now = new Date();
  const ageDays = (iso: string) => (now.getTime() - new Date(iso).getTime()) / 864e5;
  const isSerious = (i: any) => !i.near_miss && (i.severity === "critical" || i.severity === "high");

  // ── KPI ribbon (rolling 30-day window for the "this period" counts) ──────────────────────────
  const recent = incidents.filter(i => i.created_at && ageDays(i.created_at) <= 30);
  const rc = (t: string) => recent.filter(i => i.incident_type === t).length;
  const harmFree = recent.filter(i => i.near_miss || i.severity === "low").length;
  const concernObs = obs.filter((o: any) => o.concern);
  const detected = concernObs.filter((o: any) => o.escalation_triggered).length;
  const ribbon = {
    safetyScore: recent.length ? r0((harmFree / recent.length) * 100) : null, // harm-free proportion (no-harm/near-miss + low severity)
    events: recent.length,
    serious: recent.filter(isSerious).length,
    nearMisses: recent.filter(i => i.near_miss).length,
    falls: rc("falls"),
    medErrors: rc("medication"),
    hai: rc("infection"),
    pressure: rc("pressure_injury"),
    idCompliance: null as number | null,                                       // needs an ID-check store — next-phase
    deterioration: concernObs.length ? r0((detected / concernObs.length) * 100) : null,
  };

  // ── Safety Surveillance tiles (real-time) ────────────────────────────────────────────────────
  const active = alerts.filter((a: any) => a.active !== false);
  const cat = (c: string) => active.filter((a: any) => a.category === c).length;
  const highRisk = (p: any) => p.risk_level === "high" || p.acuity_level === "high" || p.acuity_level === "critical";
  const surveillance = [
    { label: "High Risk Patients", n: patients.filter(highRisk).length, icon: "🔴", tint: "bg-rose-50 text-rose-600" },
    { label: "Deteriorating Patients", n: cat("deterioration") || concernObs.length, icon: "📉", tint: "bg-orange-50 text-orange-600" },
    { label: "Observation Overdue", n: obs.filter((o: any) => ["overdue", "missed"].includes(o.status)).length, icon: "⏱️", tint: "bg-amber-50 text-amber-600" },
    { label: "Escalations Pending", n: esc.filter((e: any) => ["open", "acknowledged"].includes(e.status)).length, icon: "🔔", tint: "bg-rose-50 text-rose-600" },
    { label: "High Risk Medications", n: cat("medication"), icon: "💊", tint: "bg-orange-50 text-orange-600" },
    { label: "Isolation Patients", n: patients.filter((p: any) => p.isolation_status && p.isolation_status !== "none").length, icon: "🚸", tint: "bg-violet-50 text-violet-600" },
    { label: "Infection Alerts", n: cat("infection"), icon: "🦠", tint: "bg-emerald-50 text-emerald-600" },
    { label: "Fall Risks", n: cat("fall_risk"), icon: "🤕", tint: "bg-amber-50 text-amber-600" },
    { label: "Pressure Injury Risks", n: cat("pressure_injury"), icon: "🩹", tint: "bg-amber-50 text-amber-600" },
    { label: "Restraint Use", n: null, icon: "🔒", tint: "bg-gray-50 text-gray-400" },        // no store — next-phase
    { label: "Device Alerts", n: cat("device"), icon: "🩺", tint: "bg-teal-50 text-teal-600" },
    { label: "Lab Critical Alerts", n: null, icon: "🧪", tint: "bg-gray-50 text-gray-400" },   // no store — next-phase
  ];

  // ── Safety Events donut (by category) ────────────────────────────────────────────────────────
  const total = incidents.length;
  const donut = TYPES.map(t => ({ label: TYPE_LABEL[t], n: incidents.filter(i => i.incident_type === t).length, color: TYPE_COLOR[t] }))
    .filter(c => c.n > 0).map(c => ({ ...c, pct: total ? r0((c.n / total) * 100) : 0 })).sort((a, b) => b.n - a.n);

  // ── High-Risk Patient Monitoring (op_patients + latest observation EWS) ──────────────────────
  const latestEws = new Map<string, number>();
  for (const o of obs) { if (o.ews_score == null || !o.patient_id) continue; if (!latestEws.has(o.patient_id)) latestEws.set(o.patient_id, o.ews_score); }
  const riskList = patients.filter(highRisk).map((p: any) => {
    const ews = latestEws.get(p.id);
    const riskType = p.isolation_status && p.isolation_status !== "none" ? "Infection Risk"
      : p.acuity_level === "critical" ? "Deterioration Risk"
      : p.dependency_level === "level_3" ? "High Dependency"
      : "High Acuity";
    const score = ews != null ? r1(Math.min(9.9, ews)) : (ACUITY_SCORE[p.acuity_level] ?? 5);
    return { label: p.label, riskType, score };
  }).sort((a: any, b: any) => b.score - a.score).slice(0, 6);

  // ── 6-month severity trend (mutually-exclusive bands) ────────────────────────────────────────
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short" }) }); }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  const bandMeta = [{ key: "serious", label: "Serious Events", color: "#ef4444" }, { key: "nearMiss", label: "Near Misses", color: "#3b82f6" }, { key: "other", label: "Other Events", color: "#f59e0b" }];
  const series: Record<string, number[]> = { serious: new Array(6).fill(0), nearMiss: new Array(6).fill(0), other: new Array(6).fill(0) };
  const totals: Record<string, number> = { serious: 0, nearMiss: 0, other: 0 };
  incidents.forEach(i => { const b = i.near_miss ? "nearMiss" : isSerious(i) ? "serious" : "other"; totals[b]++; const mi = idx.get(String(i.created_at ?? "").slice(0, 7)); if (mi != null) series[b][mi]++; });

  // ── Safety Improvement Projects (op_quality_actions) ─────────────────────────────────────────
  const PROGRESS: Record<string, number> = { completed: 100, in_progress: 60, overdue: 40, open: 20 };
  const projects = actions.filter((a: any) => ["improvement_project", "pdsa", "capa", "audit_action"].includes(a.action_type))
    .slice(0, 6).map((a: any) => ({
      title: a.title, owner: a.owner_name ?? "—",
      due: a.due_at ? String(a.due_at).slice(0, 10) : null,
      status: a.status, progress: PROGRESS[a.status] ?? 0,
      tone: (a.status === "overdue" ? "red" : a.status === "completed" ? "green" : "amber") as "red" | "green" | "amber",
    }));

  // ── Never Events (sentinel incidents, this calendar year) ────────────────────────────────────
  const yr = now.getFullYear();
  const sentinels = incidents.filter(i => i.incident_type === "sentinel");
  const neverEvents = {
    thisYear: sentinels.filter(i => String(i.created_at ?? "").slice(0, 4) === String(yr)).length,
    list: sentinels.slice(0, 5).map(i => ({ title: i.description ?? "Sentinel event", status: i.status, at: String(i.created_at ?? "").slice(0, 10) })),
  };

  // ── Learning From Events (closed incidents with a corrective action) ─────────────────────────
  const learning = incidents.filter(i => i.status === "closed" && i.corrective_action)
    .slice(0, 5).map(i => ({ title: i.description ?? "Incident", lesson: i.corrective_action, at: String(i.closed_at ?? i.created_at ?? "").slice(0, 10) }));

  // ── Rule-based AI safety insights (explainable, from real signals — no fabricated ML score) ──
  const ai: { text: string; tone: "red" | "amber" | "purple"; basis: string }[] = [];
  if (ribbon.falls >= 2) ai.push({ text: `Elevated fall activity — ${ribbon.falls} fall incident(s) in the last 30 days`, tone: "red", basis: "op_incidents · falls" });
  if (cat("infection") >= 2) ai.push({ text: `Rising infection signal — ${cat("infection")} active infection alert(s) on the unit`, tone: "amber", basis: "op_safety_alerts · infection" });
  const detRisk = Number(surveillance[1].n ?? 0);
  if (detRisk >= 3) ai.push({ text: `${detRisk} patient(s) flagged at risk of deterioration — prioritise observation rounds`, tone: "red", basis: "op_observations · concern" });
  const obsOverdue = Number(surveillance[2].n ?? 0);
  if (obsOverdue >= 3) ai.push({ text: `Observation delays detected — ${obsOverdue} overdue/missed observation(s)`, tone: "amber", basis: "op_observations · status" });
  if (ribbon.medErrors >= 2) ai.push({ text: `Medication-safety watch — ${ribbon.medErrors} medication incident(s) in 30 days`, tone: "purple", basis: "op_incidents · medication" });

  return {
    provisioned: true as const,
    hasData: incidents.length + alerts.length + patients.length > 0,
    ribbon, surveillance, donut, riskList,
    trend: { months: months.map(m => m.label), series, meta: bandMeta, totals },
    projects, neverEvents, learning, ai,
    counts: { incidents: incidents.length, patients: patients.length, alerts: active.length },
  };
}
