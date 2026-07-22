// Platform Control Plane (POP-001 §1) loader — the super-admin's operational
// window onto the control plane: environment & runtime, release/deployments,
// regions, feature flags, identity & provisioning, plus a live platform map.
// Composes real plat_* data (reusing loadFeatureFlags) with honest states where
// infrastructure isn't recorded yet (no deployments, no regions). Ties into the
// granular /platform/control-plane sections rather than duplicating them.
/* eslint-disable @typescript-eslint/no-explicit-any */

import pkg from "../../../package.json";
import { loadFeatureFlags } from "./feature-flags";
import { workspaceCatalogue } from "./workspaces";

const DAY = 86400000;
const count = (r: any) => (r?.error ? null : r?.count ?? 0);

export async function loadControlPlane(admin: any) {
  // DB reachability probe (timed round-trip to a tiny control-plane table).
  const t0 = Date.now();
  const probe = await admin.from("plat_regions").select("code", { count: "exact", head: true });
  const dbLatencyMs = Date.now() - t0;
  const dbOk = !probe.error;

  const [regionsRes, deployRes, deployCountRes, tmplRes, idpRes, prodRes, evRes, ev24Res, tenRes, orgRes, hospRes, profRes, planRes] = await Promise.all([
    admin.from("plat_regions").select("code, name, hosting_provider, residency_policy, is_active").order("code"),
    admin.from("plat_deployments").select("version, channel, status, notes, released_at, created_at").order("created_at", { ascending: false }).limit(5),
    admin.from("plat_deployments").select("*", { count: "exact", head: true }),
    admin.from("plat_org_templates").select("*", { count: "exact", head: true }).eq("is_active", true),
    admin.from("plat_idp_configs").select("*", { count: "exact", head: true }).eq("is_active", true),
    admin.from("plat_products").select("code, name, is_core, default_on").order("sort"),
    admin.from("plat_platform_events").select("event_type, severity, created_at").order("created_at", { ascending: false }).limit(20),
    admin.from("plat_platform_events").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - DAY).toISOString()),
    admin.from("tenants").select("*", { count: "exact", head: true }),
    admin.from("organisations").select("*", { count: "exact", head: true }),
    admin.from("hospitals").select("*", { count: "exact", head: true }),
    admin.from("profiles").select("*", { count: "exact", head: true }),
    admin.from("plat_plans").select("*", { count: "exact", head: true }),
  ]);

  const flags = await loadFeatureFlags(admin);
  const flagAssignments = flags.ready ? flags.flags.reduce((n: number, f: any) => n + (f.assignments?.length ?? 0), 0) : 0;

  const products = (prodRes.error ? [] : prodRes.data ?? []) as any[];
  const regions = (regionsRes.error ? [] : regionsRes.data ?? []) as any[];
  const deployments = (deployRes.error ? [] : deployRes.data ?? []) as any[];
  const events = (evRes.error ? [] : evRes.data ?? []) as any[];

  let supabaseHost: string | null = null;
  try { supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null; } catch { supabaseHost = null; }

  const environment = {
    appVersion: (pkg as any).version ?? "—",
    runtime: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    vercelRegion: process.env.VERCEL_REGION ?? null,
    supabaseHost,
    dbOk, dbLatencyMs,
  };

  const release = {
    latest: deployments[0] ?? null,
    channel: deployments[0]?.channel ?? "stable",
    count: count(deployCountRes),
    recorded: !deployCountRes.error && (count(deployCountRes) ?? 0) > 0,
    recent: deployments,
  };

  const map = {
    tenants: count(tenRes), organisations: count(orgRes), facilities: count(hospRes),
    users: count(profRes), plans: count(planRes), products: products.length,
    workspaces: workspaceCatalogue().length, featureFlags: flags.ready ? flags.flags.length : null,
  };

  const health = !dbOk ? "Degraded" : "Operational";

  return {
    environment, release, map,
    regions, regionsReady: !regionsRes.error,
    products, productsSummary: { total: products.length, core: products.filter(p => p.is_core).length },
    featureFlags: { ready: flags.ready, total: flags.ready ? flags.flags.length : 0, onByDefault: flags.ready ? flags.flags.filter((f: any) => f.default_on).length : 0, assignments: flagAssignments },
    identity: { idpConfigs: count(idpRes), templates: count(tmplRes) },
    events, events24h: count(ev24Res), eventsReady: !evRes.error,
    health,
    generatedAt: new Date().toISOString(),
  };
}
