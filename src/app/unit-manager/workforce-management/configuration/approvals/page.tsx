import ConfigPlaceholder from "../ConfigPlaceholder";

export const dynamic = "force-dynamic";

// Approvals & Escalations config (UMW-WFM-009 §15).
export default function ApprovalsConfig() {
  return <ConfigPlaceholder
    title="Configuration · Approvals & Escalations"
    subtitle="Workflow designer, delegates, service levels and escalation routing."
    banner="The visual workflow designer needs a workflow-definition store producing validated machine-readable workflow definitions. Approval workflows run today via Exceptions & Approvals (WFM-006, approval_requests) with a fixed chain; the configurable no-code designer + delegated routing are next-phase (§15)."
    sections={[
      { heading: "Workflow elements (§15)", items: ["Trigger (change/amount/risk/…)", "Step (single/parallel/consensus)", "Assignee (user/role/manager lookup)", "Conditions (risk/cost/safety)", "Evidence requirement", "Service level", "Delegation", "Escalation", "Outcome"] },
      { heading: "Widget (CFG-WFL-01)", items: ["Workflow designer", "Validation panel", "Create", "Validate", "Test", "Publish"] },
      { heading: "Segregation of duties (§4.1)", items: ["Author ≠ sole approver", "High-risk needs independent approval", "Rollback needs secondary approval"] },
    ]}
    footer="Approvals & Escalations config (UMW-WFM-009 §15) — next-phase pending a workflow-definition store."
  />;
}
