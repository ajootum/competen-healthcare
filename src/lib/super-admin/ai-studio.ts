// AI Studio & Automation (AIP-001.5) loader — the governed low-code environment
// for building copilots, agents, prompts, workflows and automations. There is no
// dedicated builder-persistence layer yet, so the Studio inventories the REAL
// automation primitives already in the platform: the copilot catalogue (agents),
// the job registry (automations), the workflow/approval catalogue (workflows),
// the attributed AI operations (prompts) and the connector engines agents may
// use — each enriched with live counts. Test-run history, draft agents and
// published versions have no store yet → honest "not tracked". Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadAiGovernance } from "@/lib/ai/gateway";
import { loadJobs, JOB_REGISTRY } from "@/lib/platform/jobs";
import { loadApprovalOps, WORKFLOW_CATALOGUE } from "@/lib/platform/approvals";
import { COPILOTS } from "@/lib/super-admin/ai";

const num = (r: any) => (r?.error ? null : r?.count ?? 0);

// Governed publishing lifecycle for any AI asset (from spec).
export const PUBLISHING_STAGES = ["Draft", "Test", "Safety Review", "Clinical / Operational Review", "Governance Approval", "Pilot", "Publish", "Monitor", "Revise / Retire"];

export async function loadAiStudio(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });
  const [gov, jobs, appr, ko, assessments, learning, workforce, patients, notifs] = await Promise.all([
    loadAiGovernance(admin),
    loadJobs(admin),
    loadApprovalOps(admin),
    head("knowledge_objects"),
    head("assessments"),
    head("learning_resources"),
    head("workforce_assignments"),
    head("op_patients"),
    head("notifications"),
  ]);

  const runnable = JOB_REGISTRY.filter(j => j.runnable).length;

  // Tool & connector registry — the real engines agents may be permitted to use.
  const connectors = [
    { name: "Clinical Knowledge Platform", desc: "Frameworks, CPUs, CKOs, evidence", count: num(ko), href: "/super-admin/ckp" },
    { name: "Assessment Engine", desc: "Blueprints, assessments, scoring", count: num(assessments), href: "/super-admin/ckp/assessment" },
    { name: "Learning Engine", desc: "Resources, pathways, courses", count: num(learning), href: "/super-admin/ckp/studio" },
    { name: "Workforce Assignment Engine", desc: "Assignments, rosters, positions", count: num(workforce), href: "/super-admin/ai/workforce" },
    { name: "Patient Operations", desc: "Patients, beds, escalations", count: num(patients), href: "/super-admin/platform-ops/monitoring" },
    { name: "Notification Service", desc: "In-app, email, SMS, webhook", count: num(notifs), href: "/super-admin/platform-ops/notifications" },
    { name: "Workflow & Approval Service", desc: "Human-in-the-loop sign-off", count: WORKFLOW_CATALOGUE.length, href: "/super-admin/platform-ops/approvals" },
    { name: "AI Runtime Gateway", desc: "Model routing & usage metering", count: gov.summary.ready ? gov.summary.totalRequests : null, href: "/super-admin/platform-ops/ai-gateway" },
  ];
  const connectedTools = connectors.filter(c => c.count != null).length;

  // Builders — open the real authoring surface each maps to today.
  const builders = [
    { name: "Prompt Builder", icon: "✍️", desc: "Prompt, variables, sources, safety", href: "/super-admin/platform-ops/ai-gateway" },
    { name: "Agent Builder", icon: "🤖", desc: "Identity, tools, model, escalation", href: "/super-admin/ai/operations" },
    { name: "Workflow Automation", icon: "🔀", desc: "Event → action pipelines", href: "/super-admin/workflows" },
    { name: "Decision Tree Builder", icon: "🌳", desc: "Deterministic rules (no AI final call)", href: null, soon: true },
    { name: "Knowledge Connectors", icon: "🔌", desc: "Bind approved knowledge sources", href: "/super-admin/ckp/repository" },
    { name: "Tool Registry", icon: "🧰", desc: "Permit engines & approved APIs", href: "/super-admin/ai/operations" },
    { name: "Testing Playground", icon: "🧪", desc: "Accuracy, safety, grounding, cost", href: "/super-admin/assistant" },
    { name: "Publishing & Versioning", icon: "🚦", desc: "Governed release lifecycle", href: "/super-admin/platform-ops/approvals" },
  ];

  const kpis = {
    agents: COPILOTS.length,
    automations: JOB_REGISTRY.length,
    activeAutomations: runnable,
    promptOps: gov.byOperation.length,
    connectedTools,
    workflows: WORKFLOW_CATALOGUE.length,
    failedAutomations: jobs.summary.ready ? jobs.summary.failed24h : null,
    pendingApprovals: appr.summary.ready ? appr.summary.pending : null,
  };

  return {
    kpis,
    builders,
    connectors,
    automations: jobs.jobs,           // JOB_REGISTRY + last run
    automationsReady: jobs.summary.ready,
    workflows: appr.byWorkflow,       // WORKFLOW_CATALOGUE + pending counts
    stages: PUBLISHING_STAGES,
    agentCatalogue: COPILOTS.map(c => ({ name: c.name, icon: c.icon, desc: c.desc })),
    generatedAt: new Date().toISOString(),
  };
}
