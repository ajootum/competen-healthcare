// QAW-013 Quality Configuration, Rules & Administration — no-code admin substrate for the workspace.
// Grounded in the real configuration layer: adm_config_items / adm_changes / adm_automations / adm_forms
// (110) + the platform configuration_registry_objects catalogue (092). No new store needed; authoring
// (rule / workflow / form designers) runs through the Configuration Engine (WCE) — flagged next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const CFG_TONE = ["teal", "blue", "indigo", "violet", "amber", "rose", "emerald", "slate"];

export async function loadAdministration(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const { data: cfgRows, error } = await scope(admin.from("adm_config_items").select("name, config_type, status, source, runs").limit(4000));
  if (error) return { provisioned: false as const };
  const config = (cfgRows ?? []) as any[];

  const { data: chgRows } = await scope(admin.from("adm_changes").select("change_code, title, change_type, status, risk, version, created_at").order("created_at", { ascending: false }).limit(3000));
  const changes = (chgRows ?? []) as any[];
  const { data: autoRows } = await scope(admin.from("adm_automations").select("name, automation_type, status, runs").limit(2000));
  const automations = (autoRows ?? []) as any[];
  const { data: formRows } = await scope(admin.from("adm_forms").select("name, form_type, status, submissions").limit(2000));
  const forms = (formRows ?? []) as any[];

  // Platform configurable-object catalogue (global registry).
  let registryTotal = 0; let registryByClass: { label: string; value: number; tone: string }[] = [];
  try {
    const { data } = await admin.from("configuration_registry_objects").select("configurability_class").limit(20000);
    const rows = (data ?? []) as any[];
    registryTotal = rows.length;
    const m = new Map<string, number>();
    rows.forEach(r => m.set(r.configurability_class, (m.get(r.configurability_class) ?? 0) + 1));
    registryByClass = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value], i) => ({ label: label.replace(/_/g, " "), value, tone: CFG_TONE[i % CFG_TONE.length] }));
  } catch { /* optional */ }

  const chg = (s: string) => changes.filter(c => c.status === s).length;
  const pending = changes.filter(c => ["draft", "in_review", "pending_approval"].includes(c.status)).length;
  const published = changes.filter(c => ["approved", "published"].includes(c.status)).length;

  const typeMap = new Map<string, number>();
  config.forEach(c => typeMap.set(c.config_type, (typeMap.get(c.config_type) ?? 0) + 1));
  const byType = [...typeMap.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label: label.replace(/_/g, " "), value, tone: CFG_TONE[i % CFG_TONE.length] }));

  return {
    provisioned: true as const,
    kpis: {
      configItems: config.length, activeConfig: config.filter(c => c.status === "active").length,
      forms: forms.length, automations: automations.filter(a => a.status === "active").length,
      pending, published, registryTotal,
    },
    byType,
    changeStatus: [
      { label: "Draft", value: chg("draft"), tone: "slate" },
      { label: "In review", value: chg("in_review"), tone: "amber" },
      { label: "Pending approval", value: chg("pending_approval"), tone: "violet" },
      { label: "Approved", value: chg("approved"), tone: "blue" },
      { label: "Published", value: chg("published"), tone: "emerald" },
      { label: "Rolled back", value: chg("rolled_back"), tone: "rose" },
    ],
    changeRisk: ["high", "medium", "low"].map(r => ({ label: r[0].toUpperCase() + r.slice(1), value: changes.filter(c => c.risk === r).length, tone: r === "high" ? "rose" : r === "medium" ? "amber" : "emerald" })),
    registryByClass, registryTotal,
    recentChanges: changes.slice(0, 8).map(c => ({ code: c.change_code, title: c.title, type: c.change_type, risk: c.risk, status: c.status, version: c.version })),
    automations: automations.slice(0, 6).map(a => ({ name: a.name, type: a.automation_type, status: a.status, runs: a.runs })),
  };
}
