// Infrastructure & Services (SYS-001.4) loader — controlled visibility of the
// environments, deployments and shared services that power Competen. Built on
// the REAL runtime facts: loadRuntimeStatus (timed DB probe, region, version,
// release, na widgets), the monitoring liveness probes (services), the job
// runner (automations = the real background jobs), plat_deployments (release
// ledger — unseeded until a release is logged) and plat_regions (seeded).
// Cluster/container/CPU/memory telemetry isn't provisioned → honest states
// (SYS-002 AC-02). Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadRuntimeStatus } from "@/lib/platform/runtime";
import { loadMonitoring } from "@/lib/platform/monitoring";
import { loadJobs, JOB_REGISTRY } from "@/lib/platform/jobs";

export async function loadInfrastructure(admin: any) {
  const [runtime, monitoring, jobs, deployRows, regionRows] = await Promise.all([
    loadRuntimeStatus(admin),
    loadMonitoring(admin),
    loadJobs(admin),
    admin.from("plat_deployments").select("version, channel, status, notes, released_at, created_at").order("created_at", { ascending: false }).limit(8),
    admin.from("plat_regions").select("code, name, hosting_provider, residency_policy, is_active").order("code").limit(50),
  ]);

  const deployments = (deployRows.error ? [] : deployRows.data ?? []) as any[];
  const regions = (regionRows.error ? [] : regionRows.data ?? []) as any[];
  const activeRegions = regions.filter(r => r.is_active).length;

  // Shared platform services (real liveness probes + honest not-provisioned).
  const services = monitoring.services;
  const svcOperational = services.filter((s: any) => s.status === "operational").length;

  // Runtime slices → an environment/facts view.
  const env = runtime.environment;
  const naWidgets = runtime.widgets.filter((w: any) => w.status === "na").map((w: any) => ({ label: w.label, detail: w.detail }));

  return {
    kpis: {
      services: services.length,
      servicesOperational: svcOperational,
      regions: activeRegions,
      deployments: deployRows.error ? null : deployments.length,
      jobs: jobs.summary.ready ? JOB_REGISTRY.length : null,
      dbLatencyMs: env.dbLatencyMs,
    },
    runtime: {
      version: runtime.slices.version?.value ?? null,
      region: runtime.slices.region?.value ?? null,
      release: runtime.slices.release?.value ?? null,
      runtimeEnv: env.runtimeEnv,
      dbOk: runtime.summary.dbOk,
      dbLatencyMs: env.dbLatencyMs,
      widgets: runtime.widgets,
    },
    services, svcOperational, avgProbeMs: monitoring.avgLatencyMs,
    deployments, deployReady: !deployRows.error,
    regions, activeRegions,
    jobs: { list: jobs.jobs, recent: jobs.recent, summary: jobs.summary },
    naWidgets,
    // No source for these — honest "not provisioned" cards (mockup: clusters,
    // containers, load balancers, CPU/memory utilisation).
    notProvisioned: ["Kubernetes clusters", "Containers", "Load balancers", "CPU / memory utilisation", "Cache & queue runtime"],
    generatedAt: new Date().toISOString(),
  };
}
