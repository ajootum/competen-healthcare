import ConfigPlaceholder from "../ConfigPlaceholder";

export const dynamic = "force-dynamic";

// Integrations & Data Mapping config (UMW-WFM-009 §20).
export default function IntegrationsConfig() {
  return <ConfigPlaceholder
    title="Configuration · Integrations & Data Mapping"
    subtitle="Connectors, source authority, field mapping, synchronisation and error policies."
    banner="Integration configuration needs a connector/mapping store + secrets-vault linkage. Connector secrets are referenced by secret ID and never rendered or copied into the configuration database (§20.1 / §21). HRIS, payroll, IAM, competency, learning, attendance, census, calendar and finance connectors are next-phase."
    sections={[
      { heading: "Integrations (§20)", items: ["HRIS", "Payroll", "Identity & Access", "Competency Platform", "Learning Platform", "Attendance / Biometric", "Patient Census / Bed", "Enterprise Calendar", "Messaging", "Finance / Budget", "Data warehouse / BI"] },
      { heading: "Connector fields (§20.1)", items: ["Endpoint / secrets reference", "Direction (in/out)", "Source-of-truth by element", "Field mapping + transforms", "Schedule / event trigger", "Delta/full load", "Validation + quarantine", "Retry / dead-letter", "Reconciliation / drift"] },
      { heading: "Widget (CFG-INT-01)", items: ["Integration health & mapping", "Connector status", "Mapping completeness", "Errors", "Test connection", "View quarantine"] },
    ]}
    footer="Integrations & Data Mapping config (UMW-WFM-009 §20) — next-phase pending a connector/mapping store + secrets-vault linkage."
  />;
}
