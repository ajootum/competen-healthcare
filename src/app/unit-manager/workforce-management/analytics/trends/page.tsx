import AnalyticsPlaceholder from "../AnalyticsPlaceholder";

export const dynamic = "force-dynamic";

// Trends & Forecasts (UMW-WFM-008 §6.7).
export default function TrendsForecasts() {
  return <AnalyticsPlaceholder
    title="Analytics · Trends & Forecasts"
    subtitle="Time-series, seasonality, forecast ranges and scenario comparison."
    banner="Trends and forecasts need a persisted metric-snapshot time-series (analytics_metric_snapshot) and registered forecast models. The current analytics are point-in-time; historical trend + forecasting are shown honestly as next-phase. Forecasts must display model version, horizon, confidence and limitations (§11); predictions are labelled forecasts, never actuals (§2)."
    sections={[
      { heading: "Time-series explorer (WA-TR-001)", items: ["Metric select", "Grain (shift/day/week/month)", "Comparison period", "Confidence interval"] },
      { heading: "Forecasts (WA-TR-003-005)", items: ["Forecast coverage", "Forecast absence", "Forecast overtime", "Budget risk", "Scenario comparison"] },
      { heading: "Intelligence (WA-TR-002/007/008)", items: ["Seasonality (day/month/holiday)", "Anomaly detection", "Intervention tracking", "Before/after trends"], note: "Anomaly prompts describe why unusual + allow dismiss/feedback; only claim causation when formally supported (§11)." },
    ]}
    footer="Trends & Forecasts (UMW-WFM-008 §6.7) — next-phase pending a metric-snapshot time-series + forecast models."
  />;
}
