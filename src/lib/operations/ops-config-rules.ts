// UMW-OPC-010 Operations Configuration & Rules loader. There is no dedicated operational-rules store yet, so this is
// an HONEST configuration surface: real counts over the WCE workspace_config_overrides (the no-code config engine),
// grouped by the operational config areas, plus the built-in operational thresholds the OPC modules actually apply
// (surfaced read-only). The advanced rules engine (workflow rules, automations, conflict detection, approvals) is
// flagged next-phase rather than fabricated. Read-only manager lens; authoring lives in the WCE Designer / UMW-CFG.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadConfigOverrides } from "@/lib/config/workspace-config";

const AREAS: { label: string; prefix: string }[] = [
  { label: "Unit Command", prefix: "unit-manager.unit-command" },
  { label: "Workforce & Staffing", prefix: "unit-manager.workforce" },
  { label: "Patient Operations", prefix: "unit-manager.patient-operations" },
  { label: "Quality & Safety", prefix: "unit-manager.quality" },
  { label: "Operations & Capacity", prefix: "unit-manager.operations-capacity" },
  { label: "Learning & Development", prefix: "unit-manager.learning" },
  { label: "Analytics", prefix: "unit-manager.analytics" },
  { label: "AI & Intelligence", prefix: "unit-manager.ai" },
];

export async function loadConfigRules(admin: any) {
  const { provisioned, rows } = await loadConfigOverrides(admin).catch(() => ({ provisioned: false, rows: [] as any[] }));

  const umwRows = rows.filter((r: any) => String(r.config_path ?? "").startsWith("unit-manager"));
  const published = rows.filter((r: any) => r.published != null);
  const draft = rows.filter((r: any) => r.draft != null && r.published == null);

  const byScope = rows.reduce((acc: Record<string, number>, r: any) => { acc[r.scope_type] = (acc[r.scope_type] ?? 0) + 1; return acc; }, {});

  const configAreas = AREAS.map(a => {
    const n = rows.filter((r: any) => String(r.config_path ?? "").startsWith(a.prefix)).length;
    return { label: a.label, overrides: n, active: n > 0 };
  });

  // The real registry rows (what is actually configured).
  const registry = rows.slice(0, 10).map((r: any) => ({ path: r.config_path, scope: r.scope_type, state: r.published != null ? "published" : "draft" }));

  // Built-in operational thresholds the OPC modules apply today (read-only constants, surfaced honestly).
  const thresholds = [
    { metric: "Bed occupancy", amber: "≥ 88%", red: "≥ 95%", applied: "OPC-001/002/003" },
    { metric: "ICU occupancy", amber: "—", red: "≥ 90%", applied: "OPC-009" },
    { metric: "Staffing coverage", amber: "< 90%", red: "< 80%", applied: "OPC-002/004" },
    { metric: "Escalation rate", amber: "≥ 3/day", red: "≥ 5/day", applied: "OPC-006/009" },
    { metric: "Cleaning backlog", amber: "≥ 2 beds", red: "—", applied: "OPC-003" },
    { metric: "Bed availability", amber: "≤ 5% of beds", red: "—", applied: "OPC-003" },
  ];

  return {
    provisioned,
    kpis: { total: rows.length, published: published.length, draft: draft.length, umw: umwRows.length, scopes: Object.keys(byScope).length, areas: configAreas.filter(a => a.active).length },
    byScope, configAreas, registry, thresholds,
  };
}
