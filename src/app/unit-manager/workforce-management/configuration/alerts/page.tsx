import ConfigPlaceholder from "../ConfigPlaceholder";

export const dynamic = "force-dynamic";

// Alerts & Notifications config (UMW-WFM-009 §16).
export default function AlertsConfig() {
  return <ConfigPlaceholder
    title="Configuration · Alerts & Notifications"
    subtitle="Alert catalogue, recipients, channels, timing, quiet hours and templates."
    banner="Alert + notification configuration needs an alert-config store. Alerts fire operationally across the WFM modules today (staffing shortage, unsafe ratio, exceptions); the configurable catalogue, channels, quiet hours and templates are next-phase (§16)."
    sections={[
      { heading: "Alert catalogue (§16)", items: ["Shortage", "Unsafe ratio", "Skill gap", "Fatigue", "Overtime", "Absence", "Unapproved change", "Agency threshold", "Budget variance"] },
      { heading: "Delivery", items: ["Severity (info→critical)", "Trigger (threshold/event/state/predictive)", "Recipients", "Channel (in-app/push/email/SMS)", "Timing + digest", "Quiet hours", "Acknowledgement", "Deduplication"] },
      { heading: "Templates", items: ["Tenant-approved message templates", "Safe variables only (no arbitrary script)", "Localisation", "Branding"] },
    ]}
    footer="Alerts & Notifications config (UMW-WFM-009 §16) — next-phase pending an alert-config store."
  />;
}
