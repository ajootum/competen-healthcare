import ConfigPlaceholder from "../ConfigPlaceholder";

export const dynamic = "force-dynamic";

// Analytics & Reports config (UMW-WFM-009 §18).
export default function AnalyticsConfig() {
  return <ConfigPlaceholder
    title="Configuration · Analytics & Reports"
    subtitle="Metric definitions, targets, thresholds, report schedules and benchmarks."
    banner="Metric + reporting configuration needs a metric-registry store. The metric catalogue is documented in Analytics & Reports (WFM-008 Metric Dictionary) and metrics compute today; configurable targets/thresholds/benchmarks + report schedules are next-phase (§18). Definitions execute in Platform Data Services; this module governs definitions + presentation policy."
    sections={[
      { heading: "Metric config (§18)", items: ["Metric ID / definition", "Formula type", "Numerator / denominator", "Unit + owner", "Aggregation (sum/avg/median/…)"] },
      { heading: "Targets & thresholds", items: ["Enterprise/hospital/unit targets", "Green/amber/red bands", "Benchmark (internal/peer/regulatory)", "Effective dates", "Time windows"] },
      { heading: "Delivery & privacy", items: ["Report schedule", "Recipients / format / channel", "Drill-down permissions", "Minimum cohort size", "Suppression", "Data-quality threshold"] },
    ]}
    footer="Analytics & Reports config (UMW-WFM-009 §18) — next-phase pending a metric-registry store. See the live Metric Dictionary in Analytics & Reports."
  />;
}
