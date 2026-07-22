// Security Intelligence & Audit (SYS-001.6) loader — the trusted, searchable
// record of security-relevant activity. The strongest-data SYS module: it reads
// the real immutable trails (audit_log = the app-wide write log, plat_audit_events
// = the landlord-plane trail with actor/ip/reason, plat_platform_events = system
// telemetry) and turns them into KPIs, category analytics, top actors and a
// critical/high stream. Retention config and tamper-evidence have no store yet →
// honest states; AI insights are rule-derived and clearly labelled, never faked
// (SYS-002 AC-02). Fail-soft throughout.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };
const DAY = 86400000;

// Event categorisation (mockup: Authentication / Authorization / Admin / System).
const CATEGORY_RULES: [RegExp, string][] = [
  [/login|logout|sign_in|password|mfa|reset|session|invite|credential/i, "Authentication"],
  [/role|permission|privilege|elevat|access|approval|approve|reject|revoke/i, "Authorization"],
  [/export|download|data_/i, "Data Access"],
  [/create|update|delete|suspend|ban|reactivat|deactivat|publish|archive|config|deploy|obligation|risk|survey|policy|standard|recovery|control/i, "Admin Actions"],
];
const categorize = (action: string) => { for (const [re, label] of CATEGORY_RULES) if (re.test(action)) return label; return "System"; };
const HIGH_RE = /delete|destroy|purge|suspend|ban|privilege|elevat|role|permission|export|revoke|reject|deploy/i;

export async function loadSecurityAudit(admin: any) {
  const since24 = new Date(Date.now() - DAY).toISOString();
  const since7 = new Date(Date.now() - 7 * DAY).toISOString();

  const [auditRows, auditTotal, landlordRows, eventRows, aiTotal] = await Promise.all([
    admin.from("audit_log").select("action, actor_name, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(4000),
    admin.from("audit_log").select("*", { count: "exact", head: true }),
    admin.from("plat_audit_events").select("action, actor_name, actor_plane, entity_name, ip, reason, created_at").order("created_at", { ascending: false }).limit(500),
    admin.from("plat_platform_events").select("event_type, severity, created_at").order("created_at", { ascending: false }).limit(500),
    admin.from("plat_ai_requests").select("*", { count: "exact", head: true }),
  ]);

  const audits = (auditRows.error ? [] : auditRows.data ?? []) as any[];
  const events24 = audits.filter(a => a.created_at >= since24);
  const events7 = audits.filter(a => a.created_at >= since7);

  // ── Category analytics (24h + all recent for share) ─────────────────────────
  const withCat = audits.map(a => ({ ...a, cat: categorize(a.action ?? "") }));
  const catCounts = bucket(withCat, "cat");
  const catTotal = withCat.length || 1;
  const categories = Object.entries(catCounts).map(([label, n]) => ({ label, n, pct: Math.round((n as number / catTotal) * 100) })).sort((a, b) => (b.n as number) - (a.n as number));

  // ── Top actors by activity ──────────────────────────────────────────────────
  const actorCounts = bucket(audits.filter(a => a.actor_name), "actor_name");
  const topActors = Object.entries(actorCounts).map(([name, n]) => ({ name, n })).sort((a, b) => (b.n as number) - (a.n as number)).slice(0, 6);

  // ── Critical / high-risk stream ─────────────────────────────────────────────
  const highRisk = withCat.filter(a => HIGH_RE.test(a.action ?? "")).slice(0, 8).map(a => ({
    action: a.action, category: a.cat, actor: a.actor_name, entity: a.entity_name, at: a.created_at,
  }));
  const highRisk24 = events24.filter(a => HIGH_RE.test(a.action ?? "")).length;

  // ── Landlord-plane trail (has actor/ip/reason) ──────────────────────────────
  const landlord = (landlordRows.error ? [] : landlordRows.data ?? []) as any[];
  const landlordHasIp = landlord.some(l => l.ip);

  // ── Platform events by severity (critical is never emitted → honestly 0) ────
  const platEvents = (eventRows.error ? [] : eventRows.data ?? []) as any[];
  const sevCounts = bucket(platEvents, "severity");

  // ── Recent events for the log explorer (client-side filter) ─────────────────
  const explorer = withCat.slice(0, 60).map(a => ({
    action: a.action ?? "", category: a.cat, actor: a.actor_name ?? "system", entity: a.entity_name ?? "", type: a.entity_type ?? "", at: a.created_at,
  }));

  // ── AI-assisted insights (rule-derived from real counts; clearly labelled) ──
  const insights: string[] = [];
  const topActor = topActors[0];
  if (topActor && topActor.n > catTotal * 0.4) insights.push(`${topActor.name} accounts for ${Math.round((topActor.n as number / catTotal) * 100)}% of recent activity — review for concentration of privilege.`);
  if (highRisk24 > 0) insights.push(`${highRisk24} high-risk action${highRisk24 === 1 ? "" : "s"} in the last 24h (deletions, privilege or export events).`);
  const authShare = categories.find(c => c.label === "Authentication");
  if (authShare && authShare.pct > 60) insights.push(`Authentication events dominate (${authShare.pct}%) — expected for an active platform.`);
  if (!landlordHasIp && landlord.length) insights.push("Landlord audit events carry no source IP yet — IP/device capture would strengthen attribution.");
  if (insights.length === 0) insights.push("No anomalies surfaced by the current rule set. Behavioural anomaly detection is a later phase.");

  return {
    kpis: {
      totalEvents: num(auditTotal),
      events24h: auditRows.error ? null : events24.length,
      events7d: auditRows.error ? null : events7.length,
      highRisk24,
      landlordEvents: landlordRows.error ? null : landlord.length,
      aiEvents: num(aiTotal),
    },
    categories, topActors,
    highRisk, explorer,
    landlord: landlord.slice(0, 6), landlordHasIp, landlordReady: !landlordRows.error,
    severity: { info: sevCounts.info ?? 0, warning: sevCounts.warning ?? 0, critical: sevCounts.critical ?? 0 },
    insights,
    // Honest integrity / retention posture (no store).
    integrity: [
      { label: "Append-only writes", value: "App flows insert only", on: true },
      { label: "Actor attribution", value: "Every write carries actor + timestamp", on: true },
      { label: "Landlord IP/device capture", value: landlordHasIp ? "Captured" : "Columns present — not populated", on: landlordHasIp },
      { label: "Tamper-evidence (hash chain)", value: "Not implemented", on: false },
      { label: "Retention policy", value: "Not configured — logs retained indefinitely", on: false },
      { label: "Evidence export packages", value: "Manual — no packaged export yet", on: false },
    ],
    generatedAt: new Date().toISOString(),
  };
}
