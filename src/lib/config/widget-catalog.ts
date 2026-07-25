// Module & Widget Configuration Catalogue (WCE-005) — the code-defined catalogue of the platform's real
// widget primitives with their configuration CONTRACTS (§12): category, layout constraints, data source,
// filters, thresholds, display modes, actions and safety classification. Like WORKSPACE_CATALOG (WCE-001),
// this is code-defined so the contract never drifts from the running components; WCE-005 registers these as
// WIDGET objects in the WCE-002 registry and WCE-003 exposes them. It stores no tenant values (§2/§135).
export type WidgetContract = {
  key: string; name: string; description: string; category: string;
  safety: "non_clinical" | "operational" | "clinical_safety_relevant";
  dataSource: string | null;          // authoritative source service (null = composed/derived)
  layout: { w: number; h: number; minW: number; maxW: number };
  filters: string[];                  // available filter keys (§15)
  thresholds?: boolean;               // supports warning/critical thresholds (§16)
  displayModes: string[];             // §14
  actions: string[];                  // §17
  mandatory?: boolean;
};

// The real widget primitives used across the workspaces (QS/UMW/CMO/LDS command centres).
export const WIDGET_CATALOG: WidgetContract[] = [
  { key: "kpi_metric_card", name: "KPI Metric Card", description: "Single headline metric with icon, sub-metric, optional sparkline and prior-period delta.", category: "KPI Card", safety: "operational", dataSource: null, layout: { w: 2, h: 1, minW: 2, maxW: 4 }, filters: ["date_range", "unit", "period"], displayModes: ["count", "percentage", "compact", "mobile"], actions: ["drill_down"] },
  { key: "status_card", name: "Status Card", description: "State indicator with tone (healthy/attention/at-risk) and text label.", category: "Status Card", safety: "operational", dataSource: null, layout: { w: 2, h: 1, minW: 2, maxW: 3 }, filters: ["unit"], displayModes: ["compact", "expanded"], actions: [] },
  { key: "segmented_donut", name: "Segmented Donut", description: "Multi-segment donut with a centre total and legend (status / category distribution).", category: "Distribution Chart", safety: "operational", dataSource: null, layout: { w: 3, h: 2, minW: 2, maxW: 4 }, filters: ["date_range", "unit", "category"], displayModes: ["chart", "compact"], actions: ["view_breakdown", "export_summary"] },
  { key: "multi_line_trend", name: "Multi-line Trend", description: "Time-series line chart with multiple series and an optional target line.", category: "Trend Chart", safety: "operational", dataSource: null, layout: { w: 4, h: 2, minW: 3, maxW: 6 }, filters: ["date_range", "unit", "period"], displayModes: ["trend", "expanded", "wallboard"], actions: ["view_analytics", "export_chart"] },
  { key: "stacked_bar_trend", name: "Stacked Bar Trend", description: "Monthly stacked bars by band (e.g. incident severity) with a totals legend.", category: "Trend Chart", safety: "operational", dataSource: null, layout: { w: 4, h: 2, minW: 3, maxW: 6 }, filters: ["date_range", "unit", "severity", "category"], displayModes: ["trend", "chart"], actions: ["view_analytics"] },
  { key: "sparkline", name: "Sparkline", description: "Compact inline trend line embedded within a KPI or table row.", category: "Trend Chart", safety: "non_clinical", dataSource: null, layout: { w: 1, h: 1, minW: 1, maxW: 2 }, filters: ["date_range"], displayModes: ["compact", "mobile"], actions: [] },
  { key: "risk_heatmap", name: "Risk Heat Map (5×5)", description: "Likelihood × consequence matrix with cell counts, named axes and level legend.", category: "Risk Matrix", safety: "clinical_safety_relevant", dataSource: "service.risk_register", layout: { w: 4, h: 3, minW: 3, maxW: 5 }, filters: ["unit", "category", "risk_rating"], displayModes: ["chart", "expanded"], actions: ["view_matrix", "open_risk"] },
  { key: "coverage_heatmap", name: "Coverage Heat Map", description: "Domain × maturity-band coverage grid (competency coverage) with intensity colouring.", category: "Heat Map", safety: "clinical_safety_relevant", dataSource: "service.competency", layout: { w: 4, h: 3, minW: 3, maxW: 6 }, filters: ["unit", "role", "competency"], displayModes: ["chart"], actions: ["view_detail"] },
  { key: "gauge", name: "Gauge / Readiness Ring", description: "Single-value progress ring or gauge (readiness, controls effectiveness, compliance).", category: "Gauge", safety: "operational", dataSource: null, thresholds: true, layout: { w: 2, h: 2, minW: 2, maxW: 3 }, filters: ["unit", "date_range"], displayModes: ["percentage", "compact"], actions: ["view_detail"] },
  { key: "capability_radar", name: "Capability Radar", description: "Radar chart across capability pillars (0–100 axes) — learning effectiveness / readiness.", category: "Comparison Chart", safety: "operational", dataSource: null, layout: { w: 3, h: 3, minW: 3, maxW: 4 }, filters: ["unit", "role"], displayModes: ["chart", "expanded"], actions: [] },
  { key: "data_table", name: "Data Table / Work Queue", description: "Sortable, paginated register/work-queue table with per-row actions and drill-down.", category: "Table", safety: "operational", dataSource: null, layout: { w: 6, h: 3, minW: 4, maxW: 12 }, filters: ["date_range", "unit", "status", "priority", "category"], displayModes: ["table", "compact", "printable"], actions: ["open_record", "export_table", "bulk_action"] },
  { key: "pipeline_bars", name: "Pipeline Bars", description: "Horizontal stage bars (CAPA / treatment / investigation pipeline) with per-stage counts.", category: "Distribution Chart", safety: "operational", dataSource: null, layout: { w: 3, h: 2, minW: 2, maxW: 4 }, filters: ["unit", "status"], displayModes: ["chart", "compact"], actions: ["view_stage"] },
  { key: "alert_list", name: "Alerts & Notifications Panel", description: "Prioritised list of derived alerts with severity dots and detail; acknowledge/escalate.", category: "Alert Card", safety: "clinical_safety_relevant", dataSource: "service.alerts", layout: { w: 3, h: 3, minW: 2, maxW: 4 }, filters: ["unit", "severity", "status"], displayModes: ["expanded", "compact", "wallboard"], actions: ["acknowledge", "escalate", "open_source"] },
  { key: "ai_insight_panel", name: "AI Insight Panel", description: "Explainable rule-based recommendations with confidence, rationale and a deep-link action.", category: "AI Recommendation Panel", safety: "operational", dataSource: "service.ai_intelligence", layout: { w: 4, h: 3, minW: 3, maxW: 6 }, filters: ["unit", "audience"], displayModes: ["expanded", "compact"], actions: ["view_insight", "feedback"] },
  { key: "calendar_list", name: "Calendar / Schedule List", description: "Date-ordered list of upcoming items (surveys, milestones, reviews) with status.", category: "Calendar", safety: "non_clinical", dataSource: null, layout: { w: 3, h: 3, minW: 2, maxW: 4 }, filters: ["date_range", "unit", "type"], displayModes: ["expanded", "compact"], actions: ["open_item"] },
  { key: "quick_access_tiles", name: "Quick Access Tiles", description: "Grid of navigation tiles linking to related surfaces and actions.", category: "Action Launcher", safety: "non_clinical", dataSource: null, layout: { w: 4, h: 2, minW: 2, maxW: 8 }, filters: [], displayModes: ["compact"], actions: ["navigate"] },
];

export const WIDGET_CATEGORIES = [...new Set(WIDGET_CATALOG.map(w => w.category))].sort();
export const findWidget = (key: string) => WIDGET_CATALOG.find(w => w.key === key);
// Registry object key for a catalogued widget (registered under the shared widget library).
export const widgetObjectKey = (key: string) => `shared.widget_library.${key}`;
