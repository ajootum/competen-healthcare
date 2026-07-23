import DevPlaceholder from "../DevPlaceholder";

export const dynamic = "force-dynamic";

// Supervision & Supported Practice (UMW-WFM-007 §16).
export default function Supervision() {
  return <DevPlaceholder
    title="Development & Readiness · Supervision & Supported Practice"
    subtitle="Staff requiring supervision before full independent deployment."
    banner="Supervision plans, supervisor capacity and supported-practice logging need a supervision-plan store. Staff requiring supervision must only be rostered where a qualified supervisor is available (BR-WDR-005); a supervision plan applies a constraint to Roster Governance + Team Assignments. Temporary supervision must have an expiry/review date (BR-WDR-019)."
    sections={[
      { heading: "Supervision levels (§16.1)", items: ["Direct continuous", "Direct intermittent", "Indirect", "Available on request", "Preceptorship", "Mentorship", "Enhanced review", "Competency-specific", "Temporary restriction"] },
      { heading: "Plan fields (§16.2)", items: ["Reason", "Supervision level", "Scope permitted / excluded", "Named supervisor", "Start / review date", "End condition", "Required supervised shifts", "Required assessments", "Escalation rule"] },
      { heading: "Supervisor capacity (§16.3)", items: ["Qualified supervisors", "Current supervisee load", "Max supervisees", "Shift coverage", "Competency match", "Conflicts", "Supervision risk"] },
    ]}
    footer="Supervision & Supported Practice (UMW-WFM-007 §16) — next-phase pending a supervision-plan store."
  />;
}
