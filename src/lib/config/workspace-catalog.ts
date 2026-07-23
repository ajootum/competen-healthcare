// Workspace Configuration Engine (WCE-001) — the CATALOGUE of configurable
// objects, defined in CODE so routes/labels never drift from the running app.
// The DB (workspace_config_overrides) carries only sparse OVERRIDES to this tree,
// resolved along the Platform→Tenant→Hospital→Unit→Role→User hierarchy at runtime.
// `path` is the stable config key ('<workspace>.<section>[.<module>]'); overrides
// and the runtime resolver key off it.

export type CatalogModule = { key: string; label: string; path: string; route?: string; canDisable?: boolean; note?: string };
export type CatalogSection = { key: string; label: string; path: string; canDisable?: boolean; modules: CatalogModule[] };
export type CatalogWorkspace = { key: string; label: string; route: string; wired: boolean; sections: CatalogSection[] };

const m = (wsSec: string, key: string, label: string, extra: Partial<CatalogModule> = {}): CatalogModule =>
  ({ key, label, path: `${wsSec}.${key}`, canDisable: true, ...extra });

// Unit Manager — FULLY WIRED: the sidebar consults the engine, so disabling a
// section/module here removes it from the live nav.
const UNIT_MANAGER: CatalogWorkspace = {
  key: "unit-manager", label: "Unit Manager Workspace", route: "/unit-manager", wired: true,
  sections: [
    { key: "unit-command", label: "Unit Command", path: "unit-manager.unit-command", canDisable: false, modules: [
      m("unit-manager.unit-command", "unit-dashboard", "Overview Dashboard", { canDisable: false }),
      m("unit-manager.unit-command", "operations-centre", "Unit Operations Centre"),
      m("unit-manager.unit-command", "shift-intelligence", "Shift Intelligence"),
      m("unit-manager.unit-command", "action-centre", "Executive Actions"),
    ] },
    { key: "workforce", label: "Workforce Management", path: "unit-manager.workforce", canDisable: true, modules: [] },
    { key: "patient-operations", label: "Patient Operations", path: "unit-manager.patient-operations", canDisable: true, modules: [] },
    { key: "competency", label: "Competency Management", path: "unit-manager.competency", canDisable: true, modules: [] },
    { key: "learning", label: "Learning & Development", path: "unit-manager.learning", canDisable: true, modules: [] },
    { key: "quality", label: "Quality & Improvement", path: "unit-manager.quality", canDisable: true, modules: [] },
    { key: "operations-capacity", label: "Operations & Capacity", path: "unit-manager.operations-capacity", canDisable: true, modules: [] },
    { key: "analytics", label: "Performance Analytics", path: "unit-manager.analytics", canDisable: true, modules: [] },
    { key: "ai", label: "AI & Intelligence", path: "unit-manager.ai", canDisable: true, modules: [] },
    { key: "admin", label: "Administration & Tools", path: "unit-manager.admin", canDisable: true, modules: [] },
  ],
};

// Shift Supervisor — catalogued for the Designer. Runtime enforcement rolls out
// per workspace (see `wired`); config set here is stored & versioned now and takes
// effect once the supervisor layout consults the engine.
const SUPERVISOR: CatalogWorkspace = {
  key: "supervisor", label: "Shift Supervisor Workspace", route: "/supervisor", wired: false,
  sections: [
    { key: "shift-command", label: "Shift Command", path: "supervisor.shift-command", modules: [] },
    { key: "patient-operations", label: "Patient Operations", path: "supervisor.patient-operations", modules: [
      m("supervisor.patient-operations", "sbar-builder", "SBAR Builder", { note: "Handover module — alternative SOAP/ISBAR can be enabled instead (WCE-001 example)." }),
      m("supervisor.patient-operations", "patient-ops-center", "Patient Operations Centre"),
      m("supervisor.patient-operations", "clinical-safety", "Clinical Safety"),
    ] },
    { key: "workforce-operations", label: "Workforce Operations", path: "supervisor.workforce-operations", modules: [] },
    { key: "task-centre", label: "Task Centre", path: "supervisor.task-centre", modules: [] },
    { key: "communication", label: "Communication Centre", path: "supervisor.communication", modules: [] },
    { key: "quality-safety", label: "Quality, Safety & Escalation", path: "supervisor.quality-safety", modules: [] },
    { key: "operational-intelligence", label: "Operational Intelligence", path: "supervisor.operational-intelligence", modules: [] },
    { key: "ai-copilot", label: "AI Operational Copilot", path: "supervisor.ai-copilot", modules: [] },
    { key: "config-centre", label: "Workspace Configuration Centre", path: "supervisor.config-centre", modules: [] },
  ],
};

export const WORKSPACE_CATALOG: CatalogWorkspace[] = [UNIT_MANAGER, SUPERVISOR];

export function findWorkspace(key: string) { return WORKSPACE_CATALOG.find(w => w.key === key); }

// Flatten every configurable path (sections + modules) — used to seed the designer
// and to validate override paths.
export function catalogPaths(): { path: string; label: string; kind: "section" | "module"; canDisable: boolean }[] {
  const out: { path: string; label: string; kind: "section" | "module"; canDisable: boolean }[] = [];
  for (const ws of WORKSPACE_CATALOG) {
    for (const s of ws.sections) {
      out.push({ path: s.path, label: `${ws.label} › ${s.label}`, kind: "section", canDisable: s.canDisable !== false });
      for (const mod of s.modules) out.push({ path: mod.path, label: `${ws.label} › ${s.label} › ${mod.label}`, kind: "module", canDisable: mod.canDisable !== false });
    }
  }
  return out;
}
