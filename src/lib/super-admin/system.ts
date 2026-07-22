// System & Security Platform (SYS-001) root loader — module 1, the System
// Health Dashboard, doubling as the platform landing. Composes the REAL
// telemetry that exists: runtime probes (timed DB round-trip, region, version,
// release), the monitoring liveness probes (7 timed table checks), the job
// runner, live Supabase Auth directory data (auth.admin.listUsers → genuine
// last_sign_in_at and ban state — not stored locally), IdP/SSO configs and the
// audit stores. Everything the platform does NOT measure (uptime history,
// security score, CPU/memory, threat feeds) renders as an honest "—"
// (SYS-002 AC-02: real telemetry, never static placeholders). Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadRuntimeStatus } from "@/lib/platform/runtime";
import { loadMonitoring } from "@/lib/platform/monitoring";
import { loadJobs } from "@/lib/platform/jobs";

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const DAY = 86400000;
// Security-relevant audit actions (mirrors the platform's SECURITY_RE convention).
const SECURITY_RE = /login|logout|mfa|password|delete|suspend|ban|role|permission|access|invite|reset|revoke|approval/i;

export async function loadSystemPlatform(admin: any) {
  const [runtime, monitoring, jobs, profRows, idpRows, idpActive, auditRecent, aiReq24, apprPending] = await Promise.all([
    loadRuntimeStatus(admin),
    loadMonitoring(admin),
    loadJobs(admin),
    admin.from("profiles").select("role, roles, account_status").limit(20000),
    admin.from("plat_idp_configs").select("*", { count: "exact", head: true }),
    admin.from("plat_idp_configs").select("*", { count: "exact", head: true }).eq("is_active", true),
    admin.from("audit_log").select("action, created_at").order("created_at", { ascending: false }).limit(400),
    admin.from("plat_ai_requests").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - DAY).toISOString()),
    admin.from("plat_approval_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  // ── Live auth directory (Supabase Auth admin — real sign-in + ban state) ────
  let auth = { ready: false, total: null as number | null, active24h: null as number | null, active7d: null as number | null, banned: null as number | null };
  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (!error && data?.users) {
      const now = Date.now();
      const users = data.users as any[];
      auth = {
        ready: true,
        total: users.length,
        active24h: users.filter(u => u.last_sign_in_at && now - new Date(u.last_sign_in_at).getTime() <= DAY).length,
        active7d: users.filter(u => u.last_sign_in_at && now - new Date(u.last_sign_in_at).getTime() <= 7 * DAY).length,
        banned: users.filter(u => u.banned_until && new Date(u.banned_until).getTime() > now).length,
      };
    }
  } catch { /* auth admin unavailable — honest nulls */ }

  // ── Identity composition (profiles) ─────────────────────────────────────────
  const profiles = (profRows.error ? [] : profRows.data ?? []) as any[];
  const rolesOf = (p: any) => ((p.roles?.length ? p.roles : [p.role]) as string[]).filter(Boolean);
  const roleCounts: Record<string, number> = {};
  for (const p of profiles) for (const r of rolesOf(p)) roleCounts[r] = (roleCounts[r] ?? 0) + 1;
  const statusCounts: Record<string, number> = {};
  for (const p of profiles) { const s = p.account_status ?? "active"; statusCounts[s] = (statusCounts[s] ?? 0) + 1; }

  // ── Security events (24h) from the real audit trail ─────────────────────────
  const audits = (auditRecent.error ? [] : auditRecent.data ?? []) as any[];
  const since24 = Date.now() - DAY;
  const securityEvents24h = auditRecent.error ? null : audits.filter(a => new Date(a.created_at).getTime() >= since24 && SECURITY_RE.test(a.action ?? "")).length;

  const m = monitoring.kpis;
  // Numeric health = share of the timed liveness probes reporting operational.
  const svc = (monitoring.services ?? []) as any[];
  const platformHealth = svc.length ? Math.round((svc.filter((s: any) => s.status === "operational").length / svc.length) * 100) : null;
  const kpis = {
    platformHealth,                                 // % of monitored probes operational (real)
    healthLabel: m.health,                          // "Healthy" | "Attention" | "Degraded"
    securityScore: null as number | null,           // not scored yet — SOC module wires posture scoring
    activeUsers24h: auth.active24h,                 // real last_sign_in_at
    uptime: null as number | null,                  // no uptime history — honest
    openIncidents: m.openAlerts,                    // escalations + safety alerts (real)
    criticalAlerts: m.criticalAlerts,               // real
  };

  const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
  const modules = [
    { n: 1, name: "System Health Dashboard", desc: "Availability, performance and incidents", href: "/super-admin/system",
      kpis: [{ label: "Services Live", value: `${runtime.summary.live}/${runtime.summary.total}` }, { label: "DB Latency", value: runtime.environment.dbLatencyMs != null ? `${runtime.environment.dbLatencyMs}ms` : "—" }, { label: "Open Alerts", value: dash(m.openAlerts) }, { label: "Events 24h", value: dash(m.events24h) }] },
    { n: 2, name: "Identity & Access Management", desc: "Users, roles, SSO and sessions", href: "/super-admin/users",
      kpis: [{ label: "Identities", value: dash(auth.total) }, { label: "Active 24h", value: dash(auth.active24h) }, { label: "Suspended", value: dash(auth.banned) }, { label: "SSO Configs", value: dash(num(idpActive)) }] },
    { n: 3, name: "Security Operations Center", desc: "Threats, incidents and response", href: "/super-admin/audit",
      kpis: [{ label: "Security Events 24h", value: dash(securityEvents24h) }, { label: "Open Incidents", value: dash(m.openAlerts) }, { label: "Threats Blocked", value: "—" }, { label: "Vulnerabilities", value: "—" }] },
    { n: 4, name: "Infrastructure & Services", desc: "Environments, deployments and services", href: "/super-admin/platform-ops/control-plane",
      kpis: [{ label: "Region", value: runtime.slices.region?.value ?? "—" }, { label: "Version", value: runtime.slices.version?.value ?? "—" }, { label: "Release", value: runtime.slices.release?.value ?? "—" }, { label: "Jobs 24h", value: jobs.summary.ready ? String(jobs.summary.runs24h) : "—" }] },
    { n: 5, name: "Data Protection & Recovery", desc: "Backups, encryption and continuity", href: "/super-admin/platform-ops/monitoring",
      kpis: [{ label: "Database", value: runtime.summary.dbOk ? "Healthy" : "Degraded" }, { label: "Backups", value: "Supabase" }, { label: "RPO / RTO", value: "—" }, { label: "DR Tests", value: "—" }] },
    { n: 6, name: "Security Intelligence & Audit", desc: "Immutable trails and analytics", href: "/super-admin/audit",
      kpis: [{ label: "Audit Events 24h", value: dash(m.events24h) }, { label: "Security 24h", value: dash(securityEvents24h) }, { label: "AI Requests 24h", value: dash(num(aiReq24)) }, { label: "Pending Approvals", value: dash(num(apprPending)) }] },
  ];

  return {
    kpis,
    modules,
    runtime: { widgets: runtime.widgets, summary: runtime.summary, environment: runtime.environment },
    services: monitoring.services,
    servicesSummary: monitoring.servicesSummary,
    avgProbeMs: monitoring.avgLatencyMs,
    alerts: monitoring.alerts.slice(0, 6),
    events: monitoring.events.slice(0, 8),
    eventsReady: monitoring.eventsReady,
    jobs: jobs.summary,
    auth,
    identity: { roleCounts, statusCounts, profiles: profiles.length, idpConfigs: num(idpRows), idpActive: num(idpActive) },
    securityEvents24h,
    generatedAt: new Date().toISOString(),
  };
}
