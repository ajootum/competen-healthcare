// Platform Infrastructure & Runtime Services (POS-002). The single source of
// truth for the Mission Control Infrastructure Status Bar: region, version,
// release, deployments, backups, database/cache/queue/search health and uptime.
// Real where the stack provides it (version, region, DB reachability, releases,
// regions), honest "not provisioned / not connected" where it doesn't (this
// deployment runs on Supabase + Vercel, not self-managed Redis/queue/search).
// Exposed verbatim through /api/runtime/* so dashboards never touch the DB.
/* eslint-disable @typescript-eslint/no-explicit-any */

import pkg from "../../../package.json";

export type RuntimeStatus = "ok" | "warn" | "down" | "na";
export type RuntimeWidget = { key: string; label: string; value: string; status: RuntimeStatus; detail: string };

const na = (key: string, label: string, detail: string): RuntimeWidget => ({ key, label, value: "—", status: "na", detail });

export async function loadRuntimeStatus(admin: any) {
  // Database reachability probe (timed round-trip).
  const t0 = Date.now();
  const probe = await admin.from("plat_regions").select("code", { count: "exact", head: true });
  const dbLatencyMs = Date.now() - t0;
  const dbOk = !probe.error;

  const [regionsRes, deployRes] = await Promise.all([
    admin.from("plat_regions").select("code, name, is_active, hosting_provider").eq("is_active", true).order("code"),
    admin.from("plat_deployments").select("version, channel, status, released_at, created_at").order("created_at", { ascending: false }).limit(1),
  ]);
  const regions = (regionsRes.error ? [] : regionsRes.data ?? []) as any[];
  const latestDeploy = (deployRes.error ? [] : deployRes.data ?? [])[0] ?? null;

  const version = (pkg as any).version ?? "0.0.0";
  const runtimeEnv = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
  const vercelRegion = process.env.VERCEL_REGION ?? null;
  const regionLabel = vercelRegion ?? (regions.find(r => r.is_active)?.name ?? (regions[0]?.name ?? null));

  // Structured slices — each maps to one Infrastructure Status Bar widget and
  // one /api/runtime/* endpoint.
  const region: RuntimeWidget = regionLabel
    ? { key: "region", label: "Operations Region", value: regionLabel, status: "ok", detail: `${runtimeEnv}${regions.length ? ` · ${regions.length} configured regions` : ""}` }
    : na("region", "Operations Region", "No region configured");

  const versionW: RuntimeWidget = { key: "version", label: "Platform Version", value: `v${version}`, status: "ok", detail: `runtime ${runtimeEnv}` };
  const release: RuntimeWidget = { key: "release", label: "Release Channel", value: (latestDeploy?.channel ?? "stable"), status: "ok", detail: latestDeploy ? "from latest deployment" : "default channel" };

  const deployment: RuntimeWidget = latestDeploy
    ? { key: "deployment", label: "Last Deployment", value: `v${latestDeploy.version}`, status: latestDeploy.status === "rolled_back" ? "warn" : "ok", detail: `${latestDeploy.status} · ${latestDeploy.channel}` }
    : na("deployment", "Last Deployment", "No deployments recorded");

  const backup = na("backup", "Last Backup", "Managed by Supabase — run history not surfaced");

  const database: RuntimeWidget = dbOk
    ? { key: "database", label: "Database Health", value: `${dbLatencyMs} ms`, status: dbLatencyMs < 800 ? "ok" : "warn", detail: "PostgreSQL round-trip" }
    : { key: "database", label: "Database Health", value: "down", status: "down", detail: probe.error?.message ?? "unreachable" };

  const cache = na("cache", "Redis Health", "No managed cache in this deployment");
  const queues = na("queues", "Queue Health", "No queue runtime provisioned");
  const search = na("search", "Search Health", "Full-text search served by PostgreSQL");
  const uptime = na("uptime", "Uptime", "Uptime history not monitored");

  const widgets = [region, versionW, release, deployment, backup, database, cache, queues, search, uptime];
  const live = widgets.filter(w => w.status !== "na").length;

  return {
    widgets,
    slices: { region, version: versionW, release, deployment, backup, database, cache, queues, search, uptime },
    summary: { live, total: widgets.length, dbOk, health: !dbOk ? "Degraded" : "Operational" },
    environment: { version, runtimeEnv, vercelRegion, dbLatencyMs, dbOk, regions: regions.map(r => ({ code: r.code, name: r.name, provider: r.hosting_provider ?? null })) },
    generatedAt: new Date().toISOString(),
  };
}
