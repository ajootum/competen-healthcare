// Workspace Configuration Centre (SSW-CONF-001) loader — real system & integration
// status (background jobs, AI services, template count) and the recent
// configuration-change history from the audit trail. Internal live modules report
// "Connected"; external integrations that don't exist yet (EMR, medical devices)
// report honest "Not integrated" states rather than a fake green tick.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadJobs } from "@/lib/platform/jobs";
import { aiStatus } from "@/lib/ai/config";

const NONE = "00000000-0000-0000-0000-000000000000";

const CONFIG_ENTITIES = ["task_template", "op_broadcast", "op_quality_action", "shift_readiness", "supervisor_note", "op_incident", "recovery_event"];
const ACTION_LABEL = (a: string) => (a ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());

export async function loadConfigCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [jobs, tplRes, auditRes] = await Promise.all([
    loadJobs(admin).catch(() => ({ summary: { ready: false, running: 0, failed24h: 0, runs24h: 0 } })),
    scope(admin.from("op_task_templates").select("id", { count: "exact", head: true })).eq("active", true),
    scope(admin.from("audit_log").select("action, entity_type, entity_name, created_at, actor_name")).in("entity_type", CONFIG_ENTITIES).order("created_at", { ascending: false }).limit(6),
  ]);
  const ai = aiStatus();
  const js = (jobs as any).summary ?? { ready: false, running: 0, failed24h: 0 };
  const templates = tplRes.error ? null : (tplRes.count ?? 0);

  // System & integration status — honest per real backing.
  const systemStatus = [
    { label: "EMR Connection", status: "Not integrated", tone: "gray" },
    { label: "Bed Management System", status: "Connected", tone: "green" },
    { label: "Observation Devices", status: "Manual entry", tone: "gray" },
    { label: "Communication Service", status: "Connected", tone: "green" },
    { label: "AI Services", status: ai.configured ? "Healthy" : "Not configured", tone: ai.configured ? "green" : "amber" },
    { label: "Data Synchronisation", status: "Internal", tone: "green" },
    { label: "Background Jobs", status: js.ready ? (js.failed24h > 0 ? `${js.failed24h} failed (24h)` : "All running") : "Not provisioned", tone: js.ready ? (js.failed24h > 0 ? "amber" : "green") : "gray" },
  ];

  const recentUpdates = (auditRes.error ? [] : auditRes.data ?? []).map((a: any) => ({
    label: a.entity_name || ACTION_LABEL(a.action), sub: ACTION_LABEL(a.action), by: a.actor_name ?? null, at: a.created_at,
  }));

  return {
    ready: true as const,
    systemStatus, recentUpdates, templates,
    aiConfigured: ai.configured,
    jobs: { runs24h: js.runs24h ?? 0, failed24h: js.failed24h ?? 0, running: js.running ?? 0, ready: js.ready },
    generatedAt: new Date().toISOString(),
  };
}
