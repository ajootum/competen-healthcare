import { createAdminClient } from "@/lib/supabase/server";
import { computeRiskFlags } from "@/lib/engines/risk";

type Admin = ReturnType<typeof createAdminClient>;

// ── AI Copilot workspace context loader ─────────────────────────────────────
// Supplies the copilot's standing institutional context: current context,
// data-access scope, a live health score, rule-derived AI reasoning, the
// grounding sources and recommended next actions. The chat itself is powered by
// the real grounded /api/ai/assistant endpoint; these panels frame it with live
// figures so the copilot's "intelligence summary" is never fabricated.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);

export type CopilotContext = {
  context: { institution: string; frameworks: number; competencies: number; cpus: number };
  dataAccess: { label: string; allowed: boolean }[];
  health: number | null;
  confidence: "High" | "Medium" | "Low";
  reasoning: string[];
  sources: string[];
  recommendations: { title: string; priority: "High" | "Medium" | "Low"; href: string }[];
  aiConfigured: boolean;
};

export async function loadCopilotContext(admin: Admin, hospitalId: string): Promise<CopilotContext> {
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: hospital }, { count: fwCount }, { data: comps }, { count: cpuCount },
    { data: scores }, { data: decisions }, { data: audits },
  ] = await Promise.all([
    hospitalId ? admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("frameworks").select("id", { count: "exact", head: true }),
    admin.from("framework_competencies").select("id").limit(5000),
    admin.from("clinical_practice_units").select("id", { count: "exact", head: true }),
    nurseIds.length ? admin.from("competency_scores").select("competency_id, is_passing, educator_validated").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("competency_id, outcome").in("nurse_id", nurseIds).limit(8000) : noRows,
    hospitalId ? admin.from("audits").select("compliance_pct, items_not_met").eq("hospital_id", hospitalId).limit(2000) : noRows,
  ]);

  const fc = (comps ?? []) as { id: string }[];
  const sc = (scores ?? []) as { competency_id: string; is_passing: boolean; educator_validated: boolean }[];
  const dec = (decisions ?? []) as { competency_id: string; outcome: string }[];
  const au = (audits ?? []) as { compliance_pct: number | null; items_not_met: number | null }[];

  const evidenceComps = new Set(dec.map(d => d.competency_id));
  const achieved = new Set([...dec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id), ...sc.filter(s => s.is_passing).map(s => s.competency_id)]).size;
  const assessed = new Set(sc.map(s => s.competency_id)).size;
  const attainment = fc.length ? Math.round((achieved / fc.length) * 100) : null;
  const coverage = fc.length ? Math.round((assessed / fc.length) * 100) : null;
  const compliance = au.length ? Math.round(au.reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / au.length) : null;
  const backed = [attainment, coverage, compliance].filter((v): v is number => v !== null);
  const health = backed.length ? Math.round(backed.reduce((a, b) => a + b, 0) / backed.length) : null;

  let risks: Awaited<ReturnType<typeof computeRiskFlags>> = [];
  try { risks = await computeRiskFlags(admin, hospitalId); } catch { /* fail-soft */ }
  const insufficientEvidence = fc.filter(c => !evidenceComps.has(c.id)).length;
  const awaitingValidation = sc.filter(s => !s.educator_validated).length;
  const notMapped = au.filter(a => (a.items_not_met ?? 0) > 0).length;

  const reasoning: string[] = [];
  if (insufficientEvidence) reasoning.push(`${insufficientEvidence} competencies lack observed practice evidence.`);
  if (coverage !== null && coverage < 80) reasoning.push(`Assessment blueprint coverage is below 80% (${coverage}%).`);
  if (notMapped) reasoning.push(`${notMapped} accreditation area${notMapped === 1 ? " is" : "s are"} not fully mapped.`);
  if (risks.length) reasoning.push(`${risks.length} learner${risks.length === 1 ? "" : "s"} flagged at risk in relevant areas.`);
  if (!reasoning.length) reasoning.push("No material risks detected in the current institutional data.");

  const recs: CopilotContext["recommendations"] = [];
  if (insufficientEvidence) recs.push({ title: `Review ${insufficientEvidence} underassessed competencies`, priority: "High", href: "/educator/analytics/competency/gaps" });
  if (coverage !== null && coverage < 80) recs.push({ title: "Generate missing assessment items", priority: "High", href: "/educator/studio/gaps" });
  if (awaitingValidation) recs.push({ title: "Assign evidence validation to educators", priority: "Medium", href: "/educator/validations" });
  if (risks.length) recs.push({ title: "Create remediation plan for at-risk learners", priority: "Medium", href: "/educator/at-risk" });
  recs.push({ title: "Prepare curriculum improvement report", priority: "Low", href: "/educator/analytics/curriculum" });

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));

  return {
    context: {
      institution: (hospital as { name: string } | null)?.name ?? "Your institution",
      frameworks: fwCount ?? 0, competencies: fc.length, cpus: cpuCount ?? 0,
    },
    dataAccess: [
      { label: "Curriculum & Frameworks", allowed: true }, { label: "Competencies & CPUs", allowed: true },
      { label: "Assessment Blueprints", allowed: true }, { label: "Learner Analytics (Aggregated)", allowed: true },
      { label: "Accreditation Standards", allowed: true }, { label: "Restricted Learner Records", allowed: false },
    ],
    health, confidence: backed.length >= 3 ? "High" : backed.length >= 1 ? "Medium" : "Low",
    reasoning, sources: ["Competency Frameworks", "Assessment Blueprints", "CPU Library", "Learner Performance", "Knowledge Objects & Cases", "Quality Standards & Audits"],
    recommendations: recs, aiConfigured: configured,
  };
}
