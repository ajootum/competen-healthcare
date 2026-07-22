// Governance & Compliance (GOV-001) root loader — the executive governance
// dashboard (module 1). Platform-wide, fail-soft. Every figure is computed from
// real records: audits (compliance_pct/status), capa_actions, policies
// (review_date currency), governance_committees, the approval queues
// (plat_approval_requests + change_requests), EQOS quality frameworks/standards
// (JCI/SafeCare/MOH/internal) and operational risk indicators (safety alerts,
// escalations, high-priority CAPA). The Governance Score is the mean of the
// MEASURED dimensions only. Concepts with no store yet — risk register,
// controls library, obligations, regulatory feed — return null and render as
// honest "not modelled" states, never fabricated numbers.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const DAY = 86400000;
const CAPA_CLOSED = new Set(["completed", "verified", "closed"]);

export async function loadGovernance(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });
  const today = new Date();
  const soon = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);

  const [auditRows, findingRows, recentFindings, capaRows, policyRows, hospitals, committees, members, crOpen, crOpenCount, apprPending, apprRecent, fwRows, stdRows, safety, esc, activity, riskRows, controlRows, oblRows, assessRows] = await Promise.all([
    admin.from("audits").select("hospital_id, status, compliance_pct, audit_type, title, conducted_at").order("conducted_at", { ascending: false }).limit(5000),
    admin.from("audit_findings").select("result, is_critical").limit(20000),
    admin.from("audit_findings").select("item_text, result, is_critical, created_at").eq("result", "not_met").order("created_at", { ascending: false }).limit(6),
    admin.from("capa_actions").select("hospital_id, status, priority, due_date, closed_at, title, owner_name").limit(4000),
    admin.from("policies").select("title, review_date, is_active, policy_type").limit(4000),
    admin.from("hospitals").select("id, name").limit(2000),
    head("governance_committees"),
    head("committee_members"),
    admin.from("change_requests").select("id, entity_type, entity_name, requested_by_name, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(50),
    admin.from("change_requests").select("*", { count: "exact", head: true }).eq("status", "open"),
    admin.from("plat_approval_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("plat_approval_requests").select("id, workflow_key, entity_name, requested_by_name, current_step, total_steps, created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(50),
    admin.from("quality_frameworks").select("id, code, name, framework_type, is_active").limit(200),
    admin.from("quality_standards").select("framework_id").limit(20000),
    admin.from("op_safety_alerts").select("*", { count: "exact", head: true }).eq("active", true),
    admin.from("op_escalations").select("*", { count: "exact", head: true }).in("status", ["open", "acknowledged"]),
    admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").in("entity_type", ["policy", "framework", "approval", "change_request", "capa", "audit", "quality_object", "improvement"]).order("created_at", { ascending: false }).limit(8),
    // GRC registers (migrations 059–061) — wired in the deepening pass.
    admin.from("gov_risks").select("likelihood, impact, residual_likelihood, residual_impact, status, review_date").limit(2000),
    admin.from("gov_controls").select("effectiveness").limit(2000),
    admin.from("gov_obligations").select("domain, status, expiry_date").limit(2000),
    admin.from("gov_standard_assessments").select("framework_id, reference_code, status, assessed_at").order("assessed_at", { ascending: false }).limit(5000),
  ]);

  const audits = (auditRows.error ? [] : auditRows.data ?? []) as any[];
  const findings = (findingRows.error ? [] : findingRows.data ?? []) as any[];
  const capas = (capaRows.error ? [] : capaRows.data ?? []) as any[];
  const policies = (policyRows.error ? [] : policyRows.data ?? []) as any[];
  const hosp = (hospitals.error ? [] : hospitals.data ?? []) as any[];

  // ── Measured governance dimensions ──────────────────────────────────────────
  const compVals = audits.map(a => a.compliance_pct).filter((x: any) => x != null).map(Number);
  const complianceRate = compVals.length ? +(compVals.reduce((a, b) => a + b, 0) / compVals.length).toFixed(1) : null;
  // Audit completion is only a real measurement once audit PLANNING exists —
  // today the sole write path hardcodes status 'completed', which would make
  // this dim a constant 100 silently inflating the score. Honest null until
  // a non-completed audit appears.
  const auditCompletion = audits.some(a => a.status !== "completed") && audits.length ? Math.round((audits.filter(a => a.status === "completed").length / audits.length) * 100) : null;
  const activePolicies = policies.filter(p => p.is_active !== false);
  const datedPolicies = activePolicies.filter(p => p.review_date);
  const policyCurrency = datedPolicies.length ? Math.round((datedPolicies.filter(p => p.review_date >= today.toISOString().slice(0, 10)).length / datedPolicies.length) * 100) : null;
  const capaClosure = capas.length ? Math.round((capas.filter(c => CAPA_CLOSED.has(String(c.status ?? "").toLowerCase())).length / capas.length) * 100) : null;
  // Match the platform's canonical compliance definition: N/A findings are
  // excluded from the denominator (see /api/quality/audits).
  const applicableFindings = findings.filter(f => f.result !== "na");
  const findingsMet = applicableFindings.length ? Math.round((applicableFindings.filter(f => f.result === "met").length / applicableFindings.length) * 100) : null;

  // ── GRC registers (migrations 059–061; deepening pass) ─────────────────────
  const todayStr = today.toISOString().slice(0, 10);
  const regRisks = (riskRows.error ? [] : riskRows.data ?? []) as any[];
  const risksReady = !riskRows.error;
  const openRegRisks = regRisks.filter(r => r.status !== "closed");
  const scoreOfRisk = (r: any) => (r.residual_likelihood ?? r.likelihood ?? 3) * (r.residual_impact ?? r.impact ?? 3);
  const regHighCritical = openRegRisks.filter(r => scoreOfRisk(r) >= 10).length;
  const overdueRiskReviews = openRegRisks.filter(r => r.review_date && r.review_date < todayStr).length;

  const controls = (controlRows.error ? [] : controlRows.data ?? []) as any[];
  const controlsTested = controls.filter(ct => ct.effectiveness !== "not_tested");
  const controlsIneffective = controls.filter(ct => ct.effectiveness === "ineffective").length;
  const controlEffectiveness = controlsTested.length ? Math.round((controlsTested.filter(ct => ct.effectiveness === "effective").length / controlsTested.length) * 100) : null;

  const obls = (oblRows.error ? [] : oblRows.data ?? []) as any[];
  const oblNonCompliant = obls.filter(o => o.status === "non_compliant").length;
  // "Regulatory alerts" is now a REAL number derived from the obligations
  // register (not an external feed): regulatory/licence obligations that are
  // non-compliant, at risk, or expiring within 30 days.
  const regulatoryAlerts = oblRows.error ? null : obls.filter(o => ["regulatory", "licence"].includes(o.domain) && (["non_compliant", "at_risk"].includes(o.status) || (o.expiry_date && o.expiry_date <= soon))).length;

  const assess = (assessRows.error ? [] : assessRows.data ?? []) as any[];
  const latestStd = new Map<string, any>();
  for (const a of assess) { const key = `${a.framework_id}::${String(a.reference_code).toUpperCase()}`; if (!latestStd.has(key)) latestStd.set(key, a); }
  const latestStdList = [...latestStd.values()].filter(a => a.status !== "not_assessed");
  const STD_W: Record<string, number> = { met: 1, partially_met: 0.5, not_met: 0 };
  const accreditationReadiness = latestStdList.length ? Math.round((latestStdList.reduce((s, a) => s + (STD_W[a.status] ?? 0), 0) / latestStdList.length) * 100) : null;
  const accreditationGaps = latestStdList.filter(a => a.status === "not_met").length;

  const dims = [
    { label: "Compliance Rate", value: complianceRate == null ? null : Math.round(complianceRate) },
    { label: "Audit Completion", value: auditCompletion },
    { label: "Policy Currency", value: policyCurrency },
    { label: "CAPA Closure", value: capaClosure },
    { label: "Findings Met", value: findingsMet },
    { label: "Control Effectiveness", value: controlEffectiveness },
    { label: "Accreditation Readiness", value: accreditationReadiness },
  ];
  const measured = dims.map(d => d.value).filter((v): v is number => v != null);
  const governanceScore = mean(measured);

  // ── Derived risk indicators (no risk register yet — honest labelling) ───────
  const openHighCapa = capas.filter(c => String(c.priority) === "high" && !CAPA_CLOSED.has(String(c.status ?? "").toLowerCase())).length;
  const overdueCapa = capas.filter(c => c.due_date && c.due_date < today.toISOString().slice(0, 10) && !CAPA_CLOSED.has(String(c.status ?? "").toLowerCase())).length;
  const openRisks = openHighCapa + (num(safety) ?? 0) + (num(esc) ?? 0);

  const policiesDue = activePolicies.filter(p => p.review_date && p.review_date <= soon).length;

  // ── Compliance by organisation (facilities bucketed by avg audit compliance) ─
  const byHosp = new Map<string, number[]>();
  for (const a of audits) if (a.hospital_id && a.compliance_pct != null) { const arr = byHosp.get(a.hospital_id) ?? []; arr.push(Number(a.compliance_pct)); byHosp.set(a.hospital_id, arr); }
  const hospName = new Map<string, string>(hosp.map(h => [h.id, h.name]));
  const avgByHosp = new Map<string, number>();
  let compliant = 0, partial = 0, non = 0;
  const perOrg: { id: string; name: string; avg: number; audits: number }[] = [];
  for (const [id, vals] of byHosp) {
    const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    avgByHosp.set(id, avg);
    perOrg.push({ id, name: hospName.get(id) ?? "—", avg, audits: vals.length });
    if (avg >= 90) compliant++; else if (avg >= 70) partial++; else non++;
  }
  const notAssessed = Math.max(0, hosp.length - byHosp.size);
  const orgCompliance = { compliant, partial, non, notAssessed, total: hosp.length };

  // High-risk organisations: open high-priority CAPA per facility ∪ low avg compliance.
  const capaByHosp = new Map<string, number>();
  for (const c of capas) if (c.hospital_id && String(c.priority) === "high" && !CAPA_CLOSED.has(String(c.status ?? "").toLowerCase())) capaByHosp.set(c.hospital_id, (capaByHosp.get(c.hospital_id) ?? 0) + 1);
  const riskIds = new Set<string>([...capaByHosp.keys(), ...perOrg.filter(o => o.avg < 70).map(o => o.id)]);
  const highRiskOrgs = [...riskIds]
    .map(id => ({ id, name: hospName.get(id) ?? "—", highCapa: capaByHosp.get(id) ?? 0, avg: avgByHosp.get(id) ?? null }))
    .sort((a, b) => (b.highCapa - a.highCapa) || ((a.avg ?? 101) - (b.avg ?? 101))).slice(0, 5);

  // ── Approval queue (engine + content change requests) — carries id/source so
  // the dashboard can decide in place via PATCH /api/platform/approvals.
  const queue = [
    ...(apprRecent.error ? [] : apprRecent.data ?? []).map((r: any) => ({ id: r.id, source: "approval", title: r.entity_name ?? r.workflow_key, sub: (r.workflow_key ?? "").replace(/_/g, " "), step: r.total_steps > 1 ? `step ${r.current_step + 1}/${r.total_steps}` : null, by: r.requested_by_name, at: r.created_at })),
    ...(crOpen.error ? [] : crOpen.data ?? []).map((r: any) => ({ id: r.id, source: "change_request", title: r.entity_name ?? "Change request", sub: (r.entity_type ?? "").replace(/_/g, " "), step: null, by: r.requested_by_name, at: r.created_at })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5);

  // ── Executive alerts (spec §D) — each derived from a live register/signal ───
  const executiveAlerts = [
    { label: "High/critical open risks", n: risksReady ? regHighCritical : null, href: "/super-admin/governance/risk" },
    { label: "Risk reviews overdue", n: risksReady ? overdueRiskReviews : null, href: "/super-admin/governance/risk" },
    { label: "Ineffective controls", n: controlRows.error ? null : controlsIneffective, href: "/super-admin/governance/risk" },
    { label: "Non-compliant obligations", n: oblRows.error ? null : oblNonCompliant, href: "/super-admin/governance/compliance" },
    { label: "Regulatory deadlines (30d)", n: regulatoryAlerts, href: "/super-admin/governance/compliance" },
    { label: "Accreditation gaps (not met)", n: assessRows.error ? null : accreditationGaps, href: "/super-admin/governance/accreditation" },
    { label: "Overdue corrective actions", n: capaRows.error ? null : overdueCapa, href: "/super-admin/governance/audit" },
    { label: "Active safety alerts", n: num(safety), href: "/super-admin/platform-ops/monitoring" },
    { label: "Policies past review", n: policyRows.error ? null : datedPolicies.filter(p => p.review_date < todayStr).length, href: "/super-admin/governance/policies" },
  ].filter(a => (a.n ?? 0) > 0);

  // ── Accreditation frameworks (EQOS: JCI / SafeCare / MOH / internal) ────────
  const stdByFw = bucket(stdRows.error ? [] : stdRows.data ?? [], "framework_id");
  const frameworks = (fwRows.error ? [] : fwRows.data ?? []).map((f: any) => ({ code: f.code, name: f.name, type: f.framework_type, active: f.is_active, standards: stdByFw[f.id] ?? 0 }));

  const capaProgress = bucket(capas, "status");

  // The risk KPI prefers the REAL register (060); pre-migration it falls back
  // to the derived indicator sum when any component source resolved.
  const riskMeasurable = !capaRows.error || num(safety) != null || num(esc) != null;

  return {
    kpis: {
      governanceScore, complianceRate,
      openRisks: risksReady ? openRegRisks.length : riskMeasurable ? openRisks : null,
      auditCompletion, policiesDue,
      regulatoryAlerts, // real: derived from the obligations register (059)
    },
    dims,
    riskIndicators: {
      openHighCapa, overdueCapa, safetyAlerts: num(safety), escalations: num(esc),
      registeredOpen: risksReady ? openRegRisks.length : null,
      registeredHighCritical: risksReady ? regHighCritical : null,
    },
    executiveAlerts,
    registers: { risksReady, controlsReady: !controlRows.error, obligationsReady: !oblRows.error, assessmentsReady: !assessRows.error },
    orgCompliance,
    perOrg: perOrg.sort((a, b) => a.avg - b.avg).slice(0, 6),
    highRiskOrgs,
    capaProgress, capaTotal: capas.length,
    queue, pendingApprovals: (num(apprPending) ?? 0) + (num(crOpenCount) ?? 0),
    recentFindings: recentFindings.error ? [] : recentFindings.data ?? [],
    recentAudits: audits.slice(0, 5).map(a => ({ title: a.title, type: a.audit_type, status: a.status, pct: a.compliance_pct, at: a.conducted_at, org: hospName.get(a.hospital_id) ?? null })),
    frameworks,
    committees: { count: num(committees), members: num(members) }, // null = table unreadable → page shows "—", not a hard 0
    activity: activity.error ? [] : activity.data ?? [],
    policyStats: { total: activePolicies.length, byType: bucket(activePolicies, "policy_type"), overdue: datedPolicies.filter(p => p.review_date < today.toISOString().slice(0, 10)).length },
    generatedAt: new Date().toISOString(),
  };
}
