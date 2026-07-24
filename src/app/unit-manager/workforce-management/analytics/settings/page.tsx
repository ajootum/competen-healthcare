import AnalyticsPlaceholder from "../AnalyticsPlaceholder";

export const dynamic = "force-dynamic";

// Analytics Settings (UMW-WFM-008 §4/§13).
export default function AnalyticsSettings() {
  return <AnalyticsPlaceholder
    title="Analytics · Settings"
    subtitle="Thresholds, report permissions, display defaults and tenant configuration."
    banner="Analytics configuration needs a settings store (thresholds, metric visibility, report catalogue permissions, workweek/shift/fiscal calendar). Working-hour + planning parameters are configured today in the Workforce Planning Studio (WPS-001); alert thresholds, masking rules and small-number suppression config are next-phase. Aggregate by default; person-level data only for a legitimate operational purpose (§3.1)."
    sections={[
      { heading: "Thresholds & alerts (§11)", items: ["Coverage", "Absence", "Readiness", "Overtime", "Vacancy", "Exception ageing", "Data quality"], note: "Threshold version + responsible owner visible; trend alerts need minimum data volume." },
      { heading: "Privacy & governance (§13)", items: ["Row-level security", "Column masking", "Small-number suppression", "Export controls", "Audit logging", "Data retention", "Metric owner/steward"] },
      { heading: "Display & config (§14)", items: ["Saved views", "Display defaults", "Subscriptions", "Workweek", "Shift definitions", "Fiscal calendar", "Timezone/locale"] },
    ]}
    footer="Analytics Settings (UMW-WFM-008 §4/§13) — next-phase pending an analytics-config store."
  />;
}
