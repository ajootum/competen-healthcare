// Background Job Runner (POS-001F). The job CATALOGUE lives in code (like the
// workspace catalogue); plat_job_runs stores execution history. Handler-backed
// jobs do real, safe, idempotent work and emit platform events; runs can be
// triggered manually (super-admin) or on a schedule (Vercel cron). Fail-soft:
// with no plat_job_runs table the loader reports "not ready" and the widgets
// show honest states, so everything works before RUN-ME-054 is applied.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { emitPlatformEvent } from "./events";
import { loadKnowledgeIntelligence } from "@/lib/super-admin/ckp-intelligence";
import { runTaskAutomation } from "@/lib/operations/task-automation";

export type JobDef = { key: string; name: string; description: string; category: string; schedule: string; runnable: boolean };

// Registered platform jobs. `runnable` jobs have a handler here and can be run
// on demand or by /api/cron/jobs; non-runnable jobs execute via their own cron
// (e.g. scheduled reports) and appear for visibility.
export const JOB_REGISTRY: JobDef[] = [
  { key: "platform_metrics_snapshot", name: "Platform Metrics Snapshot", description: "Snapshot tenant, user and open-alert counts to the platform event log.", category: "analytics", schedule: "0 * * * *", runnable: true },
  { key: "subscription_renewal_scan", name: "Subscription Renewal Scan", description: "Flag active subscriptions renewing within the next 30 days.", category: "licensing", schedule: "0 7 * * *", runnable: true },
  { key: "knowledge_intelligence_scan", name: "Knowledge Intelligence Scan", description: "Recompute knowledge health, coverage, gaps and duplicates; snapshot to the platform event log.", category: "knowledge", schedule: "0 5 * * *", runnable: true },
  { key: "scheduled_reports", name: "Scheduled Reports", description: "Deliver due report schedules to recipients.", category: "reports", schedule: "0 6 * * *", runnable: false },
  { key: "task_automation", name: "Task Automation", description: "Fire recurring & event-triggered tasks from active task templates across all tenants.", category: "operations", schedule: "0 * * * *", runnable: true },
];

const HANDLERS: Record<string, (admin: any) => Promise<string>> = {
  platform_metrics_snapshot: async (admin) => {
    const [t, u, e] = await Promise.all([
      admin.from("tenants").select("*", { count: "exact", head: true }),
      admin.from("profiles").select("*", { count: "exact", head: true }),
      admin.from("op_escalations").select("*", { count: "exact", head: true }).in("status", ["open", "acknowledged"]),
    ]);
    const payload = { tenants: t.count ?? 0, users: u.count ?? 0, open_alerts: e.error ? null : e.count ?? 0 };
    await emitPlatformEvent(admin, { event_type: "metrics.snapshot", severity: "info", payload });
    return `tenants=${payload.tenants} · users=${payload.users} · open_alerts=${payload.open_alerts ?? "n/a"}`;
  },
  subscription_renewal_scan: async (admin) => {
    const now = new Date().toISOString();
    const soon = new Date(Date.now() + 30 * 864e5).toISOString();
    const { data, error } = await admin.from("plat_subscriptions").select("id, renews_at")
      .in("status", ["active", "trialing"]).not("renews_at", "is", null).gte("renews_at", now).lte("renews_at", soon);
    if (error) throw new Error(error.message);
    const n = (data ?? []).length;
    if (n) await emitPlatformEvent(admin, { event_type: "licensing.renewals_due", severity: n > 5 ? "warning" : "info", payload: { count: n } });
    return `${n} subscription(s) renewing within 30 days`;
  },
  knowledge_intelligence_scan: async (admin) => {
    // Recompute the CKP intelligence composite and snapshot it to the event log,
    // so knowledge health is trended over time and visible in Monitoring.
    const q = await loadKnowledgeIntelligence(admin);
    const k = q.kpis;
    const written = await emitPlatformEvent(admin, {
      event_type: "knowledge.intelligence_scan",
      severity: k.health != null && k.health < 50 ? "warning" : "info",
      payload: { health: k.health, coverage: k.coverage, duplicates: k.duplicates, gaps: k.gaps, missing_competencies: k.missingCompetencies, recommendations: k.recommendations },
    });
    const pct = (n: number | null) => (n == null ? "n/a" : `${n}%`);
    return `health=${pct(k.health)} · coverage=${pct(k.coverage)} · ${k.duplicates} duplicate(s) · ${k.gaps} gap(s) · ${k.missingCompetencies} unmapped · snapshot ${written ? "recorded" : "skipped"}`;
  },
  task_automation: async (admin) => {
    const r = await runTaskAutomation(admin, null);
    if (!r.ok) throw new Error(r.error ?? "automation failed");
    if (r.generated) await emitPlatformEvent(admin, { event_type: "tasks.automation_fired", severity: "info", payload: { generated: r.generated, templates: r.details.length } });
    return `${r.generated} task(s) generated from ${r.details.length} template(s)${r.details.length ? ` · ${r.details.slice(0, 4).join(", ")}` : ""}`;
  },
};

export const isRunnable = (key: string) => !!HANDLERS[key];

// Execute one job: record a 'running' row, run the handler, then mark
// success/failed with duration. Returns migration_required if the table is absent.
export async function runJob(admin: any, key: string, trigger: "manual" | "cron" | "system" = "manual", createdBy: string | null = null) {
  const def = JOB_REGISTRY.find(j => j.key === key);
  if (!def || !HANDLERS[key]) return { ok: false, error: "Unknown or non-runnable job" };
  const started = Date.now();
  const ins = await admin.from("plat_job_runs").insert({ job_key: key, status: "running", trigger, created_by: createdBy }).select("id").single();
  if (ins.error) return { ok: false, error: /does not exist|schema cache/i.test(ins.error.message) ? "migration_required" : ins.error.message };
  const runId = ins.data.id;
  try {
    const detail = await HANDLERS[key](admin);
    await admin.from("plat_job_runs").update({ status: "success", detail, finished_at: new Date().toISOString(), duration_ms: Date.now() - started }).eq("id", runId);
    return { ok: true, status: "success", detail, duration_ms: Date.now() - started };
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 500);
    await admin.from("plat_job_runs").update({ status: "failed", error: msg, finished_at: new Date().toISOString(), duration_ms: Date.now() - started }).eq("id", runId);
    return { ok: false, status: "failed", error: msg };
  }
}

// A job is due when its cron hour matches now (UTC). "0 * * * *" → every hour;
// "0 5 * * *" → 05:00 only. The cron entry fires hourly, so honouring the hour
// field makes each registry schedule real instead of cosmetic.
const isDueNow = (schedule: string) => {
  const hour = (schedule ?? "").split(/\s+/)[1];
  return hour === "*" || Number(hour) === new Date().getUTCHours();
};

// Run every runnable job whose schedule is due (used by the hourly cron).
// Best-effort; collects per-job results.
export async function runDueJobs(admin: any) {
  const results: any[] = [];
  for (const j of JOB_REGISTRY.filter(j => j.runnable && isDueNow(j.schedule))) results.push({ key: j.key, ...(await runJob(admin, j.key, "cron")) });
  return results;
}

// Registry + recent runs + summary for the widgets. Fail-soft when the table is absent.
export async function loadJobs(admin: any) {
  const runsRes = await admin.from("plat_job_runs").select("job_key, status, trigger, detail, error, started_at, finished_at, duration_ms").order("started_at", { ascending: false }).limit(200);
  const ready = !runsRes.error;
  const runs = (ready ? runsRes.data ?? [] : []) as any[];
  const lastByJob = new Map<string, any>();
  for (const r of runs) if (!lastByJob.has(r.job_key)) lastByJob.set(r.job_key, r);
  const jobs = JOB_REGISTRY.map(j => ({ ...j, last: lastByJob.get(j.key) ?? null }));
  const dayAgo = Date.now() - 864e5;
  const runs24 = runs.filter(r => new Date(r.started_at).getTime() >= dayAgo);
  const summary = {
    ready, jobs: JOB_REGISTRY.length, runnable: JOB_REGISTRY.filter(j => j.runnable).length,
    runs24h: runs24.length, failed24h: runs24.filter(r => r.status === "failed").length,
    running: runs.filter(r => r.status === "running").length,
  };
  return { jobs, recent: runs.slice(0, 12), summary };
}
