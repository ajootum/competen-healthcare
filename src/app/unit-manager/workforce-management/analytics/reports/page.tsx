import AnalyticsPlaceholder from "../AnalyticsPlaceholder";

export const dynamic = "force-dynamic";

// Report Centre (UMW-WFM-008 §7).
export default function ReportCentre() {
  return <AnalyticsPlaceholder
    title="Analytics · Report Centre"
    subtitle="Report catalogue, builder, schedules, subscriptions and exports."
    banner="The Report Centre needs report-definition + report-run stores (analytics_report_definition / analytics_report_run) plus a governed export + scheduling service. The standard report catalogue is shown as reference; report building, certification, scheduled distribution and PDF/XLSX/CSV export are next-phase. Reports must be reproducible from snapshot/version metadata + checksum (§14)."
    sections={[
      { heading: "Standard reports (§7.2)", items: ["Daily Workforce Position", "Weekly Staffing & Coverage", "Monthly Workforce Performance", "Roster Governance", "Attendance & Absence", "Leave Position", "Overtime & Premium", "Temporary Workforce Use", "Competency & Readiness", "Workforce Exceptions", "Cost & Utilisation", "Vacancy & Establishment", "Executive Workforce Summary", "Audit & Data Quality"] },
      { heading: "Report lifecycle (§7.3)", items: ["Draft", "Validated", "Certified", "Published", "Superseded", "Archived"] },
      { heading: "Centre components (§7.1)", items: ["Report builder", "Saved reports", "Schedules & subscriptions", "Run history", "Distribution lists", "Exports (PDF/DOCX/XLSX/CSV)", "Certification", "Annotations", "Archive & retention"], note: "No free-text external recipient unless policy allows; exports watermarked + expiring (§13)." },
    ]}
    footer="Report Centre (UMW-WFM-008 §7) — next-phase pending report-definition/run stores + export service."
  />;
}
