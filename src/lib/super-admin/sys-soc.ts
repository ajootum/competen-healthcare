// Security Operations Center (SYS-001.3) loader — detect, triage and respond.
// Built on the REAL signals that exist: the security-relevant slice of the
// audit trail (audit_log, classified by action), open incidents (escalations
// + active safety alerts), the security-category risk register (gov_risks) as
// the vulnerability/exposure view, and a security-posture score computed only
// from measurable facts. Threat map, IDS, geo and CVE feeds have no source →
// honest "not monitored" (SYS-002 AC-02). Fail-soft throughout.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };
const DAY = 86400000;

// Classify a security-relevant audit action into an attack/activity category.
const CATEGORY_RULES: [RegExp, string][] = [
  [/suspend|ban|reactivate|lock/i, "Account containment"],
  [/login|logout|sign_in|session|revoke/i, "Authentication"],
  [/password|reset|mfa|credential/i, "Credential management"],
  [/role|permission|privilege|elevat/i, "Privilege change"],
  [/invite|create_user|delete_user|deactivat/i, "Account lifecycle"],
  [/export|download|data_/i, "Data access / export"],
  [/approval|approve|reject/i, "Approval decision"],
  [/delete|destroy|purge/i, "Deletion"],
];
const categorize = (action: string) => { for (const [re, label] of CATEGORY_RULES) if (re.test(action)) return label; return "Other security event"; };
const SECURITY_RE = /login|logout|mfa|password|delete|suspend|ban|reactivate|role|permission|privilege|elevat|access|invite|reset|revoke|approval|export|credential|session|deactivat/i;

export async function loadSoc(admin: any) {
  const since24 = new Date(Date.now() - DAY).toISOString();
  const since7 = new Date(Date.now() - 7 * DAY).toISOString();

  const [auditRows, landlordRows, escRows, safetyRows, riskRows, aiErr24, profRows] = await Promise.all([
    admin.from("audit_log").select("action, actor_name, entity_name, created_at").order("created_at", { ascending: false }).limit(2000),
    admin.from("plat_audit_events").select("action, actor_name, actor_plane, ip, created_at").order("created_at", { ascending: false }).limit(500),
    admin.from("op_escalations").select("id, escalation_type, level, severity, summary, status, created_at").in("status", ["open", "acknowledged"]).order("created_at", { ascending: false }).limit(200),
    admin.from("op_safety_alerts").select("id, category, severity, note, created_at").eq("active", true).order("created_at", { ascending: false }).limit(200),
    admin.from("gov_risks").select("id, title, category, status, likelihood, impact, residual_likelihood, residual_impact, review_date").eq("category", "cybersecurity").limit(500),
    admin.from("plat_ai_requests").select("*", { count: "exact", head: true }).eq("status", "error").gte("created_at", since24),
    admin.from("profiles").select("id, full_name, email, account_status").limit(20000),
  ]);

  // ── Security event analytics (audit trail) ──────────────────────────────────
  const audits = (auditRows.error ? [] : auditRows.data ?? []) as any[];
  const secEvents = audits.filter(a => SECURITY_RE.test(a.action ?? ""));
  const sec24 = secEvents.filter(a => a.created_at >= since24);
  const sec7 = secEvents.filter(a => a.created_at >= since7);
  const byCategory = bucket(sec24.map(a => ({ cat: categorize(a.action ?? "") })), "cat");
  const categories = Object.entries(byCategory).map(([label, n]) => ({ label, n })).sort((a, b) => (b.n as number) - (a.n as number));
  const containment24h = sec24.filter(a => /suspend|ban|revoke|lock/i.test(a.action ?? "")).length;

  // 7-day event trend (daily counts).
  const trend: { day: string; n: number }[] = [];
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const t0 = midnight.getTime() - i * DAY, t1 = t0 + DAY;
    const n = secEvents.filter(a => { const t = new Date(a.created_at).getTime(); return t >= t0 && t < t1; }).length;
    trend.push({ day: new Date(t0).toLocaleDateString([], { month: "short", day: "numeric" }), n });
  }
  const trendMax = Math.max(1, ...trend.map(t => t.n));

  // ── Active incidents (escalations + safety alerts, unified) ─────────────────
  const esc = (escRows.error ? [] : escRows.data ?? []) as any[];
  const safety = (safetyRows.error ? [] : safetyRows.data ?? []) as any[];
  const sevRank = (s: string) => ({ critical: 3, emergency: 3, high: 2, medium: 1, low: 0 } as any)[String(s ?? "").toLowerCase()] ?? 0;
  const incidents = [
    ...esc.map(e => ({ id: e.id, title: e.summary || e.escalation_type || "Escalation", kind: e.escalation_type ?? "escalation", severity: e.severity ?? (Number(e.level) >= 3 ? "high" : "medium"), at: e.created_at })),
    ...safety.map(s => ({ id: s.id, title: s.note || s.category || "Safety alert", kind: s.category ?? "safety", severity: s.severity ?? "medium", at: s.created_at })),
  ].sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || new Date(b.at).getTime() - new Date(a.at).getTime());
  const criticalIncidents = incidents.filter(i => sevRank(i.severity) >= 3).length;

  // ── Vulnerability view = security-category risk register (real) ─────────────
  const risks = (riskRows.error ? [] : riskRows.data ?? []) as any[];
  const openRisks = risks.filter(r => r.status !== "closed");
  const scoreOf = (r: any) => (r.residual_likelihood ?? r.likelihood ?? 3) * (r.residual_impact ?? r.impact ?? 3);
  const vulnerabilities = openRisks.map(r => ({ id: r.id, title: r.title, status: r.status, score: scoreOf(r), band: scoreOf(r) >= 16 ? "critical" : scoreOf(r) >= 10 ? "high" : scoreOf(r) >= 5 ? "medium" : "low" }))
    .sort((a, b) => b.score - a.score).slice(0, 6);
  const highVulns = openRisks.filter(r => scoreOf(r) >= 10).length;
  const risksReady = !riskRows.error;

  // ── Suspended accounts (containment state) ──────────────────────────────────
  const profiles = (profRows.error ? [] : profRows.data ?? []) as any[];
  const suspendedProfiles = profiles.filter(p => ["suspended", "deactivated"].includes(p.account_status ?? "active")).length;

  // ── Security posture score — mean of measurable factors, honest null if none.
  const factors: number[] = [];
  if (!escRows.error) factors.push(criticalIncidents === 0 ? 100 : Math.max(0, 100 - criticalIncidents * 25));
  if (!aiErr24?.error) factors.push((num(aiErr24) ?? 0) === 0 ? 100 : Math.max(40, 100 - (num(aiErr24) ?? 0) * 10));
  if (risksReady) factors.push(highVulns === 0 ? 100 : Math.max(0, 100 - highVulns * 20));
  const postureScore = factors.length ? Math.round(factors.reduce((a, b) => a + b, 0) / factors.length) : null;
  const threatLevel = postureScore == null ? "Unknown" : postureScore >= 85 ? "Low" : postureScore >= 60 ? "Elevated" : "High";

  // Recent security event feed with categories.
  const recent = sec7.slice(0, 10).map(a => ({ action: a.action, category: categorize(a.action ?? ""), actor: a.actor_name, entity: a.entity_name, at: a.created_at }));

  return {
    kpis: {
      postureScore, threatLevel,
      openIncidents: escRows.error && safetyRows.error ? null : incidents.length,
      criticalIncidents: escRows.error && safetyRows.error ? null : criticalIncidents,
      securityEvents24h: auditRows.error ? null : sec24.length,
      containment24h: auditRows.error ? null : containment24h,
      highVulns: risksReady ? highVulns : null,
      aiErrors24h: num(aiErr24),
    },
    categories, trend, trendMax,
    incidents: incidents.slice(0, 6),
    vulnerabilities, risksReady, openVulnCount: openRisks.length,
    recent,
    landlord: { events: landlordRows.error ? [] : (landlordRows.data ?? []).slice(0, 6), hasIp: !landlordRows.error && (landlordRows.data ?? []).some((r: any) => r.ip) },
    suspendedProfiles,
    // Honest "not monitored" surfaces (no data source).
    notMonitored: ["Threat map / geolocation", "Intrusion detection (IDS)", "Malware / DDoS signals", "Brute-force analytics", "SIEM integration"],
    pickers: {
      users: profiles
        .slice().sort((a, b) => String(a.full_name ?? a.email ?? "").localeCompare(String(b.full_name ?? b.email ?? "")))
        .slice(0, 500)
        .map(p => ({ id: p.id, label: `${p.full_name ?? p.email ?? p.id}${["suspended", "deactivated"].includes(p.account_status ?? "") ? " · suspended" : ""}` })),
    },
    generatedAt: new Date().toISOString(),
  };
}
