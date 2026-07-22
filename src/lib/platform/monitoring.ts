// Monitoring & Operations (POP-001 §6) loader — live platform health probes,
// active alerts, the event/audit stream and operational job states. Health is
// REAL: each subsystem is probed with a lightweight head-count query and timed,
// so "operational/slow/down" reflects the database actually responding. Infra
// telemetry the platform does not collect (CPU/memory, uptime history, backup
// runs) is surfaced as honest "not connected" states, never fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DAY = 86400000;

// Subsystems probed for liveness. Each maps to a representative table (all
// confirmed to exist) whose reachability stands in for the subsystem responding.
const PROBES = [
  { key: "tenancy", label: "Tenancy & Identity", table: "tenants", core: true },
  { key: "directory", label: "User Directory", table: "profiles", core: true },
  { key: "licensing", label: "Licensing & Plans", table: "plat_plans", core: true },
  { key: "subscriptions", label: "Subscriptions", table: "plat_subscriptions", core: true },
  { key: "services", label: "Service Registry", table: "plat_products", core: true },
  { key: "operations", label: "Patient Operations", table: "op_patients", core: false },
  { key: "audit", label: "Audit & Events", table: "audit_log", core: false },
] as const;

// Escalation (routine→critical) + safety (low→high) severities collapse to one
// four-tier scale so both alert sources sort and colour consistently.
const TIER: Record<string, { rank: number; tier: "critical" | "high" | "medium" | "low" }> = {
  critical: { rank: 4, tier: "critical" }, emergency: { rank: 4, tier: "critical" },
  high: { rank: 3, tier: "high" },
  urgent: { rank: 2, tier: "medium" }, medium: { rank: 2, tier: "medium" },
  routine: { rank: 1, tier: "low" }, low: { rank: 1, tier: "low" },
};
const tierOf = (sev?: string | null) => TIER[String(sev ?? "").toLowerCase()] ?? { rank: 1, tier: "low" as const };

export async function loadMonitoring(admin: any) {
  // ── Live health probes (timed reachability of each subsystem) ──────────────
  const probe = async (p: (typeof PROBES)[number]) => {
    const t0 = Date.now();
    const { error } = await admin.from(p.table).select("*", { count: "exact", head: true });
    const ms = Date.now() - t0;
    const status = error ? "down" : ms < 400 ? "operational" : ms < 1500 ? "slow" : "degraded";
    return { key: p.key, label: p.label, core: p.core, status, latencyMs: error ? null : ms, error: error?.message ?? null };
  };
  const services = await Promise.all(PROBES.map(probe));
  const servicesSummary = {
    total: services.length,
    operational: services.filter(s => s.status === "operational").length,
    slow: services.filter(s => s.status === "slow").length,
    down: services.filter(s => s.status === "down" || s.status === "degraded").length,
  };
  const okLat = services.filter(s => s.latencyMs != null).map(s => s.latencyMs as number);
  const avgLatencyMs = okLat.length ? Math.round(okLat.reduce((a, b) => a + b, 0) / okLat.length) : null;

  // ── Alerts, event stream, 24h event volume ─────────────────────────────────
  const since = new Date(Date.now() - DAY).toISOString();
  const [escRes, safeRes, platEvRes, auditRes, vol24Res] = await Promise.all([
    admin.from("op_escalations").select("id, escalation_type, level, severity, summary, status, created_at").in("status", ["open", "acknowledged"]).order("created_at", { ascending: false }).limit(200),
    admin.from("op_safety_alerts").select("id, category, severity, note, created_at").eq("active", true).order("created_at", { ascending: false }).limit(200),
    admin.from("plat_audit_events").select("actor_name, actor_plane, action, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(40),
    admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(40),
    admin.from("audit_log").select("*", { count: "exact", head: true }).gte("created_at", since),
  ]);

  const escalations = (escRes.error ? [] : escRes.data ?? []) as any[];
  const safety = (safeRes.error ? [] : safeRes.data ?? []) as any[];
  const alerts = [
    ...escalations.map(e => ({ source: "Escalation", kind: (e.escalation_type ?? "clinical"), title: e.summary || "Escalation", severity: e.severity, ...tierOf(e.severity), meta: `L${e.level}`, at: e.created_at })),
    ...safety.map(s => ({ source: "Safety", kind: s.category, title: s.note || String(s.category ?? "").replace(/_/g, " "), severity: s.severity, ...tierOf(s.severity), meta: String(s.category ?? "").replace(/_/g, " "), at: s.created_at })),
  ].sort((a, b) => b.rank - a.rank || new Date(b.at).getTime() - new Date(a.at).getTime());
  const alertsSummary = {
    total: alerts.length,
    critical: alerts.filter(a => a.tier === "critical").length,
    high: alerts.filter(a => a.tier === "high").length,
    escalations: escalations.length, safety: safety.length,
    ready: !escRes.error || !safeRes.error,
  };

  // ── Event stream: landlord-plane events preferred, merged with the audit log ─
  const ICON: Record<string, string> = { tenant: "🏢", plan: "🧾", organisation: "🏛️", hospital: "🏥", framework: "📐", profile: "👤", template: "📦", enterprise: "🌐", subscription: "💳" };
  const platEvents = (platEvRes.error ? [] : platEvRes.data ?? []) as any[];
  const auditEvents = (auditRes.error ? [] : auditRes.data ?? []) as any[];
  const events = [
    ...platEvents.map(e => ({ plane: e.actor_plane === "tenant" ? "Tenant" : "Platform", icon: ICON[e.entity_type ?? ""] ?? "•", action: String(e.action ?? "").replace(/_/g, " "), subject: e.entity_name ?? "", actor: e.actor_name ?? "", at: e.created_at })),
    ...auditEvents.map(a => ({ plane: a.entity_type === "tenant" || a.entity_type === "plan" ? "Platform" : "Tenant", icon: ICON[a.entity_type ?? ""] ?? "•", action: String(a.action ?? "").replace(/_/g, " "), subject: a.entity_name ?? "", actor: a.actor_name ?? "", at: a.created_at })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 30);
  const eventsReady = !platEvRes.error || !auditRes.error;
  const events24h = vol24Res.error ? null : vol24Res.count ?? 0;

  // ── Overall health: core probe down → Degraded; any degradation or a critical
  //    alert → Attention; otherwise Healthy. ──────────────────────────────────
  const coreDown = services.some(s => s.core && (s.status === "down" || s.status === "degraded"));
  const anyDegraded = servicesSummary.down > 0 || servicesSummary.slow > 0;
  const health = coreDown ? "Degraded" : anyDegraded || alertsSummary.critical > 0 ? "Attention" : "Healthy";

  return {
    kpis: { health, openAlerts: alertsSummary.ready ? alertsSummary.total : null, criticalAlerts: alertsSummary.critical, events24h, avgLatencyMs },
    services, servicesSummary, avgLatencyMs,
    alerts, alertsSummary,
    events, eventsReady,
    generatedAt: new Date().toISOString(),
  };
}
