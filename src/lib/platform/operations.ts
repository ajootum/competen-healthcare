// Platform Operations Services (POS-001). The operational aggregation layer that
// feeds the Super Admin Mission Control widgets from a single source of truth,
// so dashboards consume standardized data instead of querying modules directly.
// Reuses the monitoring service for health/alerts; counts tenants, users,
// today's deployments and open change-requests (approvals). AI request volume
// and background-job runs aren't metered in this deployment → honest "na".
// Maps 1:1 to the POS-001 Mission Control Widget table.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadMonitoring } from "./monitoring";

export type OpsStatus = "ok" | "warn" | "down" | "na";
export type OpsWidget = { key: string; label: string; value: string; status: OpsStatus; detail: string; service: string };

const num = (r: any) => (r?.error ? null : r?.count ?? 0);

export async function loadPlatformOperations(admin: any) {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  const [mon, tenRes, userRes, depRes, apprRes, jobRes, jobFailRes, aiRes, aiErrRes] = await Promise.all([
    loadMonitoring(admin),
    admin.from("tenants").select("*", { count: "exact", head: true }),
    admin.from("profiles").select("*", { count: "exact", head: true }),
    admin.from("plat_deployments").select("*", { count: "exact", head: true }).gte("created_at", dayStart.toISOString()),
    admin.from("change_requests").select("*", { count: "exact", head: true }).eq("status", "open"),
    admin.from("plat_job_runs").select("*", { count: "exact", head: true }).gte("started_at", dayAgo),
    admin.from("plat_job_runs").select("*", { count: "exact", head: true }).gte("started_at", dayAgo).eq("status", "failed"),
    admin.from("plat_ai_requests").select("*", { count: "exact", head: true }).gte("created_at", dayAgo),
    admin.from("plat_ai_requests").select("*", { count: "exact", head: true }).gte("created_at", dayAgo).in("status", ["error", "refusal"]),
  ]);

  const health = mon.kpis.health;
  const crit = mon.kpis.criticalAlerts ?? 0;
  const open = mon.kpis.openAlerts;
  const tenants = num(tenRes), users = num(userRes), depToday = num(depRes), approvals = num(apprRes);
  const jobRuns = num(jobRes), jobFails = num(jobFailRes);
  const aiReqs = num(aiRes), aiErrs = num(aiErrRes);
  const healthStatus: OpsStatus = health === "Healthy" ? "ok" : health === "Attention" ? "warn" : "down";

  const widgets: OpsWidget[] = [
    { key: "health", label: "Platform Health", value: health, status: healthStatus, detail: `${mon.servicesSummary.operational}/${mon.servicesSummary.total} subsystems up`, service: "Platform Monitoring Service" },
    { key: "alerts", label: "Critical Alerts", value: String(crit), status: crit > 0 ? "down" : open ? "warn" : "ok", detail: open == null ? "alert sources unavailable" : `${open} open total`, service: "Platform Alert Engine" },
    { key: "tenants", label: "Enterprise Tenants", value: tenants == null ? "—" : String(tenants), status: tenants == null ? "na" : "ok", detail: "registered tenants", service: "Platform Analytics Service" },
    { key: "users", label: "Active Users", value: users == null ? "—" : String(users), status: users == null ? "na" : "ok", detail: "platform accounts", service: "Platform Analytics Service" },
    { key: "ai", label: "AI Operations", value: aiReqs == null ? "—" : String(aiReqs), status: aiReqs == null ? "na" : aiErrs ? "warn" : "ok", detail: aiReqs == null ? "gateway telemetry unavailable" : `requests 24h${aiErrs ? ` · ${aiErrs} failed` : ""}`, service: "AI Runtime Gateway" },
    { key: "approvals", label: "Pending Approvals", value: approvals == null ? "—" : String(approvals), status: approvals == null ? "na" : approvals > 0 ? "warn" : "ok", detail: approvals == null ? "aggregation pending" : "open change requests", service: "Workflow & Approval Service" },
    { key: "deployments", label: "Deployments Today", value: depToday == null ? "—" : String(depToday), status: depToday == null ? "na" : "ok", detail: "recorded since midnight", service: "Deployment Management Service" },
    { key: "jobs", label: "Background Jobs", value: jobRuns == null ? "—" : String(jobRuns), status: jobRuns == null ? "na" : jobFails ? "warn" : "ok", detail: jobRuns == null ? "run history unavailable" : `runs 24h${jobFails ? ` · ${jobFails} failed` : ""}`, service: "Background Job Scheduler" },
  ];

  return {
    widgets,
    summary: { live: widgets.filter(w => w.status !== "na").length, total: widgets.length, health },
    generatedAt: new Date().toISOString(),
  };
}
