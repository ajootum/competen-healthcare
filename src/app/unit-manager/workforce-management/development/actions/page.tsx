import DevPlaceholder from "../DevPlaceholder";

export const dynamic = "force-dynamic";

// Development Actions (UMW-WFM-007 §21).
export default function DevelopmentActions() {
  return <DevPlaceholder
    title="Development & Readiness · Development Actions"
    subtitle="A single operational action register for readiness gaps."
    banner="The development-action register needs a store. Every action links to a defined readiness gap (BR-WDR-007). Assessment requests integrate with the Assessor Workspace and learning with the Educator Workspace (next-phase)."
    sections={[
      { heading: "Action types (§21.1)", items: ["Assign learning", "Request assessment", "Schedule supervised shift", "Assign preceptor", "Initiate remediation", "Renew credential", "Upload evidence", "Manager sign-off", "Create cross-training plan", "Nominate for succession", "Development review", "Escalate readiness risk"] },
      { heading: "Action statuses (§21.3)", items: ["Not started", "Assigned", "In progress", "Awaiting staff", "Awaiting assessor", "Awaiting manager", "Awaiting evidence", "Overdue", "Completed", "Cancelled", "Escalated"] },
      { heading: "Register fields (§21.2)", items: ["Linked readiness gap", "Owner", "Assigned / due date", "Priority", "Progress", "Evidence", "Blocker", "Outcome", "Closure date"] },
    ]}
    footer="Development Actions (UMW-WFM-007 §21) — next-phase pending a development-action register."
  />;
}
