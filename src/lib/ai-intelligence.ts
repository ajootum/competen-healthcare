import { createAdminClient } from "@/lib/supabase/server";
import { computeRiskFlags } from "@/lib/engines/risk";

type Admin = ReturnType<typeof createAdminClient>;

// ── AI & Intelligence Hub data loader ───────────────────────────────────────
// The institution intelligence layer: synthesises live signals from across the
// platform into executive KPIs, an intelligence-map view and prioritised,
// explainable recommendations with deep links. Every figure is live/hospital-
// scoped; recommendations are rule-derived from real records (labelled as such).

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);

export type MapNode = { id: string; label: string; sub: string; metric: string; href: string; color: string; alert: boolean };
export type Recommendation = { title: string; reason: string; priority: "High" | "Medium" | "Low"; href: string; icon: string };

export type AiIntelligence = {
  cards: { intervention: number; curriculaReview: number; insufficientEvidence: number; awaitingValidation: number; accreditationRisks: number; recommendations: number };
  nodes: MapNode[];
  recommendations: Recommendation[];
  learners: number;
};

export async function loadAiIntelligence(admin: Admin, hospitalId: string): Promise<AiIntelligence> {
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: frameworks }, { data: comps }, { data: scores }, { data: decisions },
    { data: audits }, { data: faculty }, { data: capa },
  ] = await Promise.all([
    admin.from("frameworks").select("pub_status").limit(500),
    admin.from("framework_competencies").select("id").limit(5000),
    nurseIds.length ? admin.from("competency_scores").select("competency_id, is_passing, educator_validated").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("competency_id, outcome").in("nurse_id", nurseIds).limit(8000) : noRows,
    hospitalId ? admin.from("audits").select("compliance_pct, items_not_met").eq("hospital_id", hospitalId).limit(2000) : noRows,
    hospitalId ? admin.from("profiles").select("id").eq("hospital_id", hospitalId).or("role.in.(educator,assessor),roles.cs.{educator},roles.cs.{assessor}").limit(500) : noRows,
    hospitalId ? admin.from("capa_actions").select("status, priority").eq("hospital_id", hospitalId).limit(500) : noRows,
  ]);
  let risks: Awaited<ReturnType<typeof computeRiskFlags>> = [];
  try { risks = await computeRiskFlags(admin, hospitalId); } catch { /* fail-soft */ }

  const fw = (frameworks ?? []) as { pub_status: string | null }[];
  const fc = (comps ?? []) as { id: string }[];
  const sc = (scores ?? []) as { competency_id: string; is_passing: boolean; educator_validated: boolean }[];
  const dec = (decisions ?? []) as { competency_id: string; outcome: string }[];
  const au = (audits ?? []) as { compliance_pct: number | null; items_not_met: number | null }[];
  const capaRows = (capa ?? []) as { status: string; priority: string | null }[];

  const intervention = risks.length;
  const curriculaReview = fw.filter(f => ["draft", "in_review", "review"].includes(f.pub_status ?? "")).length;
  const evidenceComps = new Set(dec.map(d => d.competency_id));
  const insufficientEvidence = fc.filter(c => !evidenceComps.has(c.id)).length;
  const awaitingValidation = sc.filter(s => !s.educator_validated).length;
  const accreditationRisks = au.filter(a => (a.items_not_met ?? 0) > 0).length + capaRows.filter(c => c.priority === "high" && c.status !== "completed" && c.status !== "closed").length;
  const compliance = au.length ? Math.round(au.reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / au.length) : null;
  const achieved = new Set([...dec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id), ...sc.filter(s => s.is_passing).map(s => s.competency_id)]).size;
  const coveragePct = fc.length ? Math.round((new Set(sc.map(s => s.competency_id)).size / fc.length) * 100) : 0;

  // ── Recommendations (rule-derived, prioritised, explainable) ──
  const recs: Recommendation[] = [];
  if (intervention > 0) recs.push({ title: "Schedule Remediation", reason: `${intervention} learner${intervention === 1 ? "" : "s"} require intervention`, priority: "High", href: "/educator/at-risk", icon: "🧑‍⚕️" });
  if (curriculaReview > 0) recs.push({ title: "Review Curriculum", reason: `${curriculaReview} curricul${curriculaReview === 1 ? "um is" : "a are"} in draft/review`, priority: "High", href: "/educator/studio/curriculum", icon: "📖" });
  if (accreditationRisks > 0) recs.push({ title: "Prepare Accreditation", reason: `${accreditationRisks} accreditation risk${accreditationRisks === 1 ? "" : "s"} detected`, priority: "High", href: "/educator/analytics/accreditation", icon: "🛡️" });
  if (awaitingValidation > 0) recs.push({ title: "Approve Validations", reason: `${awaitingValidation} assessment score${awaitingValidation === 1 ? "" : "s"} awaiting validation`, priority: "Medium", href: "/educator/validations", icon: "📋" });
  if (insufficientEvidence > 0) recs.push({ title: "Validate Evidence", reason: `${insufficientEvidence} competenc${insufficientEvidence === 1 ? "y has" : "ies have"} insufficient evidence`, priority: "Medium", href: "/educator/analytics/competency/gaps", icon: "🎯" });
  if (coveragePct < 80) recs.push({ title: "Close Assessment Gaps", reason: `Blueprint coverage is ${coveragePct}%`, priority: "Medium", href: "/educator/studio/gaps", icon: "🧩" });
  recs.push({ title: "Ask the AI Copilot", reason: "Get a prioritised plan built from your live data", priority: "Low", href: "/dashboard/copilot", icon: "✨" });
  const rank = { High: 0, Medium: 1, Low: 2 };
  recs.sort((a, b) => rank[a.priority] - rank[b.priority]);

  const nodes: MapNode[] = [
    { id: "learners", label: "Learners", sub: "Engagement & Performance", metric: `${nurseIds.length} · ${intervention} at risk`, href: "/educator/analytics/learning", color: "#22c55e", alert: intervention > 0 },
    { id: "competencies", label: "Competencies", sub: "Mastery & Progress", metric: `${achieved}/${fc.length} achieved`, href: "/educator/analytics/competency", color: "#14b8a6", alert: insufficientEvidence > 0 },
    { id: "curriculum", label: "Curriculum", sub: "Alignment & Gaps", metric: `${fw.length} frameworks · ${curriculaReview} review`, href: "/educator/analytics/curriculum", color: "#f59e0b", alert: curriculaReview > 0 },
    { id: "assessments", label: "Assessments", sub: "Quality & Coverage", metric: `${awaitingValidation} awaiting`, href: "/educator/analytics/assessment", color: "#3b82f6", alert: awaitingValidation > 0 },
    { id: "educators", label: "Educators", sub: "Effectiveness & Support", metric: `${(faculty ?? []).length} faculty`, href: "/educator/analytics/learning/faculty", color: "#a855f7", alert: false },
    { id: "institution", label: "Institution", sub: "Operations & Resources", metric: compliance !== null ? `${compliance}% compliance` : "—", href: "/educator/analytics/quality", color: "#6366f1", alert: false },
    { id: "accreditation", label: "Accreditation", sub: "Compliance & Standards", metric: `${accreditationRisks} risk${accreditationRisks === 1 ? "" : "s"}`, href: "/educator/analytics/accreditation", color: "#ec4899", alert: accreditationRisks > 0 },
    { id: "predictions", label: "Predictions", sub: "Risks & Opportunities", metric: `${intervention} flagged`, href: "/educator/at-risk", color: "#06b6d4", alert: intervention > 0 },
  ];

  return {
    cards: { intervention, curriculaReview, insufficientEvidence, awaitingValidation, accreditationRisks, recommendations: recs.length },
    nodes, recommendations: recs, learners: nurseIds.length,
  };
}
