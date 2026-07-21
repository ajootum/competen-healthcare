// Executive Command Centre loader (MC-004) — the platform-wide executive
// situation room. Aggregates a heartbeat, executive-attention items, per-platform
// health, a decision queue, cross-platform intelligence, growth over a time
// window and key metrics. Everything is live platform data; capabilities with no
// backing (security events, AI serving, deploy pipeline, uptime) are surfaced as
// honest "not monitored/provisioned" states rather than fabricated numbers.
// Drift-risk / optional tables are probed fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DAY = 86400000;

function cumulative(dates: (string | null | undefined)[], days: number): number[] {
  const buckets = Math.min(Math.max(days, 2), 30);
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const step = Math.ceil(days / buckets);
  const start = midnight.getTime() - (days - 1) * DAY;
  const daily = Array(buckets).fill(0) as number[];
  let before = 0;
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d).getTime(); if (Number.isNaN(t)) continue;
    if (t < start) { before++; continue; }
    const idx = Math.min(buckets - 1, Math.floor((t - start) / (step * DAY)));
    if (idx >= 0) daily[idx]++;
  }
  let run = before;
  return daily.map(v => (run += v));
}

export async function loadExecutiveCommand(admin: any, rangeDays: number) {
  const since = Date.now() - rangeDays * DAY;
  const inWindow = (d: any) => d && new Date(d).getTime() >= since;

  const [entRes, orgRes, hospRes, profRes, fwRes, asmRes, scoreRes] = await Promise.all([
    admin.from("enterprises").select("id, is_active, created_at").limit(2000),
    admin.from("organisations").select("id, status, is_active, enterprise_id, created_at").limit(4000),
    admin.from("hospitals").select("id, admin_id, organisation_id, status, created_at").limit(6000),
    admin.from("profiles").select("id, role, roles, organisation_id, account_status, created_at").limit(60000),
    admin.from("frameworks").select("id, pub_status, created_at").limit(4000),
    admin.from("assessments").select("id, status, created_at").limit(60000),
    admin.from("competency_scores").select("is_passing").limit(60000),
  ]);
  const enterprises = (entRes.data ?? []) as any[];
  const orgs = (orgRes.data ?? []) as any[];
  const hospitals = (hospRes.data ?? []) as any[];
  const profiles = (profRes.data ?? []) as any[];
  const frameworks = (fwRes.data ?? []) as any[];
  const assessments = (asmRes.data ?? []) as any[];
  const scores = (scoreRes.data ?? []) as any[];

  // Fail-soft signal tables.
  const [escRes, apprRes, chgRes, cpuRes] = await Promise.all([
    admin.from("op_escalations").select("level, severity, status, created_at, resolved_at").neq("status", "resolved").limit(2000),
    admin.from("content_approvals").select("status").eq("status", "pending"),
    admin.from("change_requests").select("status, change_kind").eq("status", "open"),
    admin.from("clinical_practice_units").select("id, pub_status, created_at").limit(4000),
  ]);
  const escalations = escRes.error ? [] : ((escRes.data ?? []) as any[]);
  const escReady = !escRes.error;
  const pendingContent = apprRes.error ? null : (apprRes.data ?? []).length;
  const changeReqs = chgRes.error ? null : (chgRes.data ?? []) as any[];
  const cpus = cpuRes.error ? null : ((cpuRes.data ?? []) as any[]);

  const rolesOf = (p: any) => (p.roles?.length ? p.roles : [p.role]).filter(Boolean);
  const orgStatus = (o: any) => o.status ?? (o.is_active === false ? "draft" : "active");

  // ── Executive attention ──────────────────────────────────────────────────
  // op_escalations.level is numeric (1–5); severity is text. A critical incident
  // is a high numeric level (≥3) or an emergency/critical severity.
  const criticalIncidents = escReady ? escalations.filter(e => Number(e.level) >= 3 || ["emergency", "critical", "high"].includes(String(e.severity ?? "").toLowerCase())).length : null;
  const openChange = changeReqs?.length ?? null;
  const pendingApprovals = (pendingContent ?? 0) + (openChange ?? 0);
  const govEscalations = changeReqs ? changeReqs.filter(x => x.change_kind === "major").length : null;
  const attention = [
    { key: "incidents", label: "Critical Incidents", n: criticalIncidents, sub: "Require immediate action", tone: "red", href: "/super-admin/command-centre" },
    { key: "approvals", label: "Pending Approvals", n: pendingApprovals, sub: "Awaiting your decision", tone: "amber", href: "/super-admin/workflows" },
    { key: "security", label: "Security Events", n: null, sub: "Not monitored", tone: "orange", href: "/super-admin/audit" },
    { key: "gov", label: "Governance Escalations", n: govEscalations, sub: "Escalated to executive", tone: "violet", href: "/super-admin/governance/committees" },
  ];

  // ── Platform health (7 platforms; derived from real probes) ──────────────
  const govAlerts = (pendingContent ?? 0) + (openChange ?? 0) + frameworks.filter(f => f.pub_status === "in_review").length;
  const health = [
    { name: "Enterprise Administration", desc: "Organisations, tenants & hierarchy", status: orgRes.error ? "degraded" : "healthy", alerts: 0, href: "/super-admin/enterprise" },
    { name: "Platform Operations", desc: "Infrastructure, deployments & services", status: "not_monitored", alerts: 0, href: "/platform/control-plane" },
    { name: "Clinical Knowledge Platform", desc: "Frameworks, CPUs & content lifecycle", status: fwRes.error ? "degraded" : "healthy", alerts: 0, href: "/super-admin/content" },
    { name: "AI & Intelligence Platform", desc: "AI models, services & automation", status: "not_monitored", alerts: 0, href: "/super-admin/assistant" },
    { name: "Governance & Compliance", desc: "Policies, risks, audits & compliance", status: govAlerts > 0 ? "warning" : "healthy", alerts: govAlerts, href: "/super-admin/workflows" },
    { name: "System & Security", desc: "Security, identity & system resilience", status: "not_monitored", alerts: 0, href: "/super-admin/settings" },
    { name: "Developer Center", desc: "APIs, integrations & sandbox", status: "not_monitored", alerts: 0, href: "/super-admin/enterprise" },
  ];

  // ── Status banner (heartbeat) — status DERIVED from the monitored platforms
  // (never a hardcoded green), so it can never contradict the health panel below.
  const monitoredPlatforms = health.filter(h => h.status !== "not_monitored");
  const degradedN = monitoredPlatforms.filter(h => h.status === "degraded").length;
  const warningN = monitoredPlatforms.filter(h => h.status === "warning").length;
  const healthyN = monitoredPlatforms.filter(h => h.status === "healthy").length;
  const banner = {
    health: degradedN ? "Degraded" : warningN ? "Attention" : "Operational",
    note: `${healthyN}/${monitoredPlatforms.length} monitored platforms healthy · ${health.length - monitoredPlatforms.length} not yet monitored`,
    uptime: null as number | null, // no uptime probe
    enterprises: enterprises.length, organisations: orgs.length, facilities: hospitals.length, users: profiles.length,
  };

  // ── Executive decision queue ─────────────────────────────────────────────
  const enterpriseApprovals = orgs.filter(o => ["draft", "onboarding"].includes(orgStatus(o))).length;
  const cpuPublications = cpus ? cpus.filter(u => ["in_review", "review", "ready", "submitted"].includes((u.pub_status ?? "").toLowerCase())).length : null;
  const governanceReviews = (openChange ?? 0) + (pendingContent ?? 0);
  const decisionQueue = [
    { key: "ent", label: "Enterprise Approval", desc: "New enterprise registrations awaiting approval", n: enterpriseApprovals, href: "/super-admin/enterprise/organisations" },
    { key: "cpu", label: "CPU Publications", desc: "Clinical Practice Units ready for publication", n: cpuPublications, href: "/super-admin/studio" },
    { key: "rel", label: "Platform Releases", desc: "Releases awaiting deployment approval", n: null, href: "/platform/control-plane" },
    { key: "gov", label: "Governance Reviews", desc: "Policies and frameworks awaiting review", n: governanceReviews, href: "/super-admin/workflows" },
    { key: "ai", label: "AI Model Approvals", desc: "AI models awaiting deployment approval", n: null, href: "/super-admin/assistant" },
    { key: "sec", label: "Security Approvals", desc: "Security exceptions awaiting approval", n: null, href: "/super-admin/audit" },
  ];

  // ── Cross-platform intelligence (real signals + honest predictive note) ──
  const orgAdminIds = new Set(profiles.filter(p => p.organisation_id && (rolesOf(p).includes("hospital_admin") || rolesOf(p).includes("super_admin"))).map(p => p.organisation_id));
  const orgHasHospAdmin = new Set(hospitals.filter(h => h.admin_id && h.organisation_id).map(h => h.organisation_id));
  const orgsNoAdmin = orgs.filter(o => !orgAdminIds.has(o.id) && !orgHasHospAdmin.has(o.id)).length;
  const facilitiesPending = hospitals.filter(h => !h.admin_id).length;
  const newUsersWin = profiles.filter(p => inWindow(p.created_at)).length;
  const passRate = scores.length ? Math.round((scores.filter(s => s.is_passing).length / scores.length) * 100) : null;
  const intelligence = [
    orgsNoAdmin > 0 && { icon: "⚖️", text: `${orgsNoAdmin} organisation${orgsNoAdmin > 1 ? "s" : ""} have no administrator and may need targeted governance support.`, tag: "High impact", tone: "amber", real: true },
    facilitiesPending > 0 && { icon: "🏥", text: `${facilitiesPending} facilit${facilitiesPending > 1 ? "ies" : "y"} are awaiting activation across the platform.`, tag: "Medium impact", tone: "sky", real: true },
    newUsersWin > 0 && { icon: "📈", text: `User adoption grew by ${newUsersWin} new user${newUsersWin > 1 ? "s" : ""} over the last ${rangeDays} days.`, tag: "Positive trend", tone: "green", real: true },
    passRate != null && { icon: "🎯", text: `Competency completion is running at ${passRate}% across recorded scores.`, tag: passRate >= 70 ? "Positive trend" : "Watch", tone: passRate >= 70 ? "green" : "amber", real: true },
  ].filter(Boolean) as any[];

  // ── Enterprise growth (over the window) ──────────────────────────────────
  const growth = [
    { label: "New Enterprises", icon: "🏢", n: enterprises.filter(e => inWindow(e.created_at)).length },
    { label: "New Organisations", icon: "🏛️", n: orgs.filter(o => inWindow(o.created_at)).length },
    { label: "New Users", icon: "👥", n: newUsersWin },
    { label: "CPUs Published", icon: "🧩", n: cpus ? cpus.filter(u => inWindow(u.created_at)).length : null },
    { label: "Frameworks", icon: "📐", n: frameworks.filter(f => inWindow(f.created_at)).length },
    { label: "Assessments", icon: "📋", n: assessments.filter(a => inWindow(a.created_at)).length },
  ];

  // ── Key platform metrics ─────────────────────────────────────────────────
  const asmWin = assessments.filter(a => inWindow(a.created_at)).length;
  // Real incident MTTR from resolved escalations (probe-independent).
  const resProbe = await admin.from("op_escalations").select("created_at, resolved_at").not("resolved_at", "is", null).order("resolved_at", { ascending: false }).limit(200);
  let mttrHours: number | null = null;
  if (!resProbe.error) {
    const done = (resProbe.data ?? []) as any[];
    if (done.length) { const hrs = done.map(d => (new Date(d.resolved_at).getTime() - new Date(d.created_at).getTime()) / 3.6e6).filter(h => h >= 0); if (hrs.length) mttrHours = +(hrs.reduce((s, x) => s + x, 0) / hrs.length).toFixed(1); }
  }
  const metrics = [
    { label: "Competency Completion", value: passRate != null ? `${passRate}%` : "—", real: passRate != null },
    { label: "Assessment Volume", value: asmWin.toLocaleString(), real: true },
    { label: "AI Requests Processed", value: "—", real: false },
    { label: "Platform Uptime", value: "—", real: false },
    { label: "Deployment Success", value: "—", real: false },
    { label: "Incident Resolution", value: mttrHours != null ? `${mttrHours}h` : "—", real: mttrHours != null },
  ];

  const spark = {
    users: cumulative(profiles.map(p => p.created_at), rangeDays),
    assessments: cumulative(assessments.map(a => a.created_at), rangeDays),
    orgs: cumulative(orgs.map(o => o.created_at), rangeDays),
  };

  return {
    rangeDays, banner, attention, health, decisionQueue, intelligence, growth, metrics, spark,
    attentionTotal: attention.filter(a => a.n).length,
    generatedAt: new Date().toISOString(),
  };
}
