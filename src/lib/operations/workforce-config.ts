// Workforce Configuration (UMW-WFM-009) loader — the governed configuration service that
// supplies rules to every WFM module. The live tenant configuration IS wps_config (migration
// 081, the Workforce Planning Studio store): planning parameters, ratios, leave, shift and cost
// settings that WFM-001..008 already consume. This surfaces the active policy profile + config
// health + recent changes over that store. The full governance model (change-sets, releases,
// approvals, inheritance, simulation, rollback) needs dedicated stores → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadPlanningConfig } from "@/lib/config/wps-config";

const NONE = "00000000-0000-0000-0000-000000000000";

// §5 configuration domains + which are backed by live config today
export const CONFIG_DOMAINS = [
  { name: "Organisation & Workforce Structure", status: "next-phase" },
  { name: "Establishment & Staffing Models", status: "configured" },
  { name: "Shift & Roster Rules", status: "partial" },
  { name: "Availability, Leave & Attendance", status: "partial" },
  { name: "Competency & Readiness", status: "next-phase" },
  { name: "Approvals & Escalations", status: "next-phase" },
  { name: "Alerts & Notifications", status: "next-phase" },
  { name: "Analytics & Reports", status: "partial" },
  { name: "AI & Optimisation", status: "next-phase" },
  { name: "Integrations & Data Mapping", status: "next-phase" },
  { name: "Security & Delegated Administration", status: "next-phase" },
];

// §2 consumer modules — all resolve the same published wps_config version
export const CONSUMERS = ["WFM-001 Planning", "WFM-002 Staffing Engine", "WFM-003 Team Assignments", "WFM-004 Roster Governance", "WFM-005 Availability & Attendance", "WFM-006 Exceptions & Approvals", "WFM-007 Development & Readiness", "WFM-008 Analytics & Reports"];

export async function loadWorkforceConfig(admin: any, hid: string | null, isSuper: boolean) {
  const cfg = await loadPlanningConfig(admin, hid, isSuper) as any;

  // Recent config changes (audit_log) — config publish events
  let recent: any[] = [];
  try {
    const q = admin.from("audit_log").select("actor_name, action, entity_name, created_at").in("action", ["publish_planning_config", "publish_roster", "archive_roster"]).order("created_at", { ascending: false }).limit(12);
    const { data } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
    recent = data ?? [];
  } catch { recent = []; }

  const configured = CONFIG_DOMAINS.filter(d => d.status === "configured").length;
  const partial = CONFIG_DOMAINS.filter(d => d.status === "partial").length;
  // Health score — configured (full) + half-credit partial, over all domains
  const health = Math.round(((configured + partial * 0.5) / CONFIG_DOMAINS.length) * 100);

  return {
    provisioned: cfg.provisioned,
    profile: { version: cfg.version, published: cfg.configured, updatedAt: cfg.updatedAt, updatedByName: cfg.updatedByName, currency: cfg.settings?.currency ?? "GBP" },
    settings: cfg.settings,
    domains: CONFIG_DOMAINS, configured, partial, health,
    consumers: CONSUMERS, recent,
  };
}
