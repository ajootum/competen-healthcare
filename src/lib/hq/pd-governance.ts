import {
  posture, trend, POSTURE_NOT_DETERMINED_LABEL,
  type RiskMethodology, type PostureState,
} from "@/lib/hq/gov-evidence";
import { loadControls, type ControlsRead } from "@/lib/hq/gov-control";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-010 §3 — GOVERNANCE OVERVIEW, the loader.
//
// ⚠ THREE KINDS OF NOTHING ON ONE SCREEN, AND CONFLATING ANY TWO IS THE FAILURE THIS MODULE INVITES.
//
//   NOT DETERMINABLE  the risk register is real and readable; posture cannot be stated because no
//                     methodology is published. Fixing it is a governance act, not a build.
//   MEASURED ZERO     the risk store was read and holds no rows. Somebody looked and found none.
//   NO RECORD TYPE    obligations, decisions, exceptions, evidence and reviews have no table yet.
//                     Nobody has looked, because there is nowhere to look.
//
// ⚠ CONTROLS MOVED FROM THE THIRD CATEGORY TO THE SECOND WHEN migration 322 LANDED, and this comment
// was edited in the same commit. A header describing an absence that has since been closed is how a
// reader learns to distrust the ones that are still true.
//
// A screen that renders all three as "0" tells a Director the product is well governed. It is not
// governed at all yet, and those are opposite conclusions from identical pixels.
//
// ⚠ CONTROL ASSURANCE IS COUNTED NOW, AND IT WAS REFUSED HERE UNTIL migration 322 EXISTED. While there
// was no control table, controlAssurance([]) would have returned a tidy 0-of-0 with zero not-tested — a
// measured-LOOKING answer over a store that did not exist. The function was correct and calling it would
// have been the lie. Now the store is real, the count is real, and the aggregate percentage is STILL
// refused — because that refusal was never about missing data.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export type GovAbsence = { label: string; why: string; spec: string };

/**
 * §2's objects that have no store yet. Phase 1 and 2 built the methodology and the register; §26
 * sequences the rest after them.
 *
 * ⚠ NAMED AS MODELS TO BUILD, NOT AS FEATURES TO ENABLE — and each says what it would take, because a
 * Director reading this needs to know which of these is a sprint and which is a governance decision.
 */
export const GOV_MISSING: GovAbsence[] = [
  {
    label: "Obligation", spec: "§10",
    why: "No obligation register exists. §10 requires source, applicability, owner, evidence links, review frequency and a compliance state that distinguishes Not Assessed from Not Applicable.",
  },
  {
    label: "Governance decision / approval", spec: "§11",
    why: "No decision record exists. §11 requires the decision maker, options considered, conditions, rationale and the submitted/reviewed/decided audit trail — and emergency approvals to be identifiable for retrospective review.",
  },
  {
    label: "Exception / risk acceptance", spec: "§12",
    why: "No exception record exists. §12 requires scope, compensating controls, an approver, an expiry and the rule that an expired exception cannot silently remain in force.",
  },
  {
    label: "Evidence / audit finding", spec: "§13",
    why: "No evidence index exists. §13 requires source, validity and expiry per item, so that staleness becomes visible rather than being read as continued compliance.",
  },
  {
    label: "Governance review", spec: "§14",
    why: "No review record exists. §14 is explicit that a review is not meeting minutes: its decisions and actions must create linked structured records.",
  },
];

export type GovernanceOverview = Awaited<ReturnType<typeof loadGovernanceOverview>>;

export async function loadGovernanceOverview(admin: Admin) {
  const controls: ControlsRead = await loadControls(admin);
  const [methodRes, riskRes, assessRes, actionRes] = await Promise.all([
    admin.from("gov_risk_methodology")
      .select("methodology_id, version, name, aggregation_rule, status, published_at, effective_from, effective_to")
      .eq("status", "published"),
    admin.from("gov_product_risk")
      .select("risk_id, reference, title, category_code, owner_name, treatment, status, trend, trend_rationale, next_review_on, escalation_state, escalation_to, created_at")
      .limit(501),
    admin.from("gov_risk_assessment").select("assessment_id, risk_id, basis, score, assessed_at").limit(501),
    admin.from("gov_risk_action").select("action_id, risk_id, action, owner_name, due_on, state, verified_by_assessment_id").limit(501),
  ]);

  const problems: string[] = [];
  for (const [name, r] of [
    ["the risk methodology", methodRes], ["the risk register", riskRes],
    ["risk assessments", assessRes], ["risk actions", actionRes],
  ] as const) {
    if (r.error) problems.push(`${name} could not be read — ${String(r.error.message).slice(0, 80)}. That is not zero.`);
  }

  const risks = (riskRes.data ?? []) as Record<string, unknown>[];
  const actions = (actionRes.data ?? []) as Record<string, unknown>[];
  const assessments = (assessRes.data ?? []) as Record<string, unknown>[];

  // ⚠ RESOLVED AT READ TIME, and only over a methodology that is BOTH published and currently effective.
  // A published-but-superseded methodology is history, not the active scale.
  const now = Date.now();
  const activeRow = ((methodRes.data ?? []) as Record<string, unknown>[]).find(m => {
    const from = m.effective_from ? new Date(String(m.effective_from)).getTime() : null;
    const to = m.effective_to ? new Date(String(m.effective_to)).getTime() : null;
    return from !== null && from <= now && (to === null || to > now);
  }) ?? null;

  let methodology: RiskMethodology | null = null;
  if (activeRow) {
    const bands = await admin.from("gov_posture_band")
      .select("code, label, definition, sort_order")
      .eq("methodology_id", activeRow.methodology_id).order("sort_order");
    methodology = {
      methodologyId: String(activeRow.methodology_id),
      version: Number(activeRow.version),
      name: String(activeRow.name),
      aggregationRule: (activeRow.aggregation_rule as string | null) ?? null,
      publishedAt: String(activeRow.published_at),
      effectiveFrom: String(activeRow.effective_from),
      bands: ((bands.data ?? []) as Record<string, unknown>[]).map(b => ({
        code: String(b.code), label: String(b.label),
        definition: String(b.definition), sortOrder: Number(b.sort_order),
      })),
    };
  }

  // ⚠ THE AGGREGATE IS null UNTIL A METHODOLOGY EXISTS TO AGGREGATE UNDER. There is no "highest score"
  // to compute without an aggregation rule, and picking max() here would BE the undocumented
  // methodology §4 forbids — silently, in a loader, where nobody would look for it.
  const assessedRiskIds = new Set(assessments.map(a => String(a.risk_id)));
  const postureState: PostureState = posture(methodology, {
    bandCode: null,
    assessedRisks: assessedRiskIds.size,
  });

  const today = new Date().toISOString().slice(0, 10);
  const openRisks = risks.filter(r => r.status !== "closed");

  return {
    readAt: new Date().toISOString(),
    problems,
    methodology,
    posture: postureState,
    postureLabel: postureState.state === "determined" ? postureState.label : POSTURE_NOT_DETERMINED_LABEL,

    /** §3's posture trend. No prior observation window exists, so it is unavailable rather than flat. */
    postureTrend: trend<string>({
      current: postureState.state === "determined" ? postureState.label : POSTURE_NOT_DETERMINED_LABEL,
      prior: null, series: [], priorPeriod: null,
    }),

    register: {
      readable: !riskRes.error,
      total: risks.length,
      open: openRisks.length,
      /** §22: "Risk owner missing → high-priority governance exception." */
      ownerless: openRisks.filter(r => !r.owner_name).length,
      /** §4/§22: an assessment overdue is a Needs Attention item. */
      reviewOverdue: openRisks.filter(r => r.next_review_on && String(r.next_review_on) < today).length,
      unassessed: openRisks.filter(r => !assessedRiskIds.has(String(r.risk_id))).length,
      escalated: openRisks.filter(r => r.escalation_state === "escalated" || r.escalation_state === "requested").length,
      truncated: risks.length > 500,
      rows: openRisks.slice(0, 50).map(r => ({
        riskId: String(r.risk_id), reference: String(r.reference), title: String(r.title),
        category: String(r.category_code),
        ownerName: (r.owner_name as string | null) ?? null,
        treatment: String(r.treatment), status: String(r.status),
        trend: String(r.trend), trendRationale: (r.trend_rationale as string | null) ?? null,
        nextReviewOn: (r.next_review_on as string | null) ?? null,
        assessed: assessedRiskIds.has(String(r.risk_id)),
      })),
    },

    actions: {
      readable: !actionRes.error,
      open: actions.filter(a => a.state !== "done" && a.state !== "cancelled").length,
      overdue: actions.filter(a =>
        a.state !== "done" && a.state !== "cancelled" && a.due_on && String(a.due_on) < today).length,
      /**
       * §15/§24: completing an action does not by itself reduce risk. These are the actions somebody
       * marked done that no reassessment has followed — the promise kept with no evidence it worked.
       */
      doneUnverified: actions.filter(a => a.state === "done" && !a.verified_by_assessment_id).length,
    },

    /**
     * s6 control assurance. NOW REAL — migration 322 gave controls a store, so this is counted rather
     * than refused. null means the store could not be read, which is not the same as no controls.
     *
     * ⚠ AND STILL NO AGGREGATE PERCENTAGE, now that there IS a store and real tests behind it. The
     * refusal was never about the data being absent — it is about design and operating effectiveness
     * being two judgements that no single number can carry.
     */
    controls,

    missing: GOV_MISSING,
  };
}
