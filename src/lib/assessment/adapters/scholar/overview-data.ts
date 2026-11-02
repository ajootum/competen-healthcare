/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadIndividualPolicyOnce } from "@/lib/individual/policy";
import { scholarModulesFor } from "@/lib/individual/scholar/module-access";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { listOffers, loadCompetencyLabels, loadHistory, startableByCompetency, assessmentsReady, type InstanceSummary, type SelfHistory } from "./store";
import type { OfferCard } from "./offer";
import { buildOverview, unionCompetencies, type ActivityFact, type OverviewCompetency, type ProgressFact, type VerificationFact } from "./competency-overview-model";
import type { Attempt } from "./history";
import type { Finding } from "./findings";

// ── WHAT THE SCHOLAR PAGES READ OF THE ASSESSMENT SIDE ── Checklist Studio S3 ────────────────────────────────────────
//
// One call per page: whether the assessment tables are here, what HQ offers this learner, and the learner's own instances. Server only.
// Every state is kept apart: not ready (tables absent), unreadable (a read failed) and empty are three different things, and an
// unreadable read is never shown as "no self-assessments".

type Admin = any;

export type SelfSide =
  | { state: "not_ready" }
  | { state: "unreadable" }
  | { state: "ready"; offers: OfferCard[]; pendingGrants: number; summaries: InstanceSummary[]; history: SelfHistory; startable: Map<string, { code: string; name: string }> };

export async function loadSelfSide(admin: Admin, userId: string, expected: ReadonlyMap<string, number | null>): Promise<SelfSide> {
  try {
    if (!(await assessmentsReady(admin, userId))) return { state: "not_ready" };
    const policy = await loadIndividualPolicyOnce(admin);
    const [offers, history] = await Promise.all([listOffers(admin, userId, policy.scholarAssessmentInstruments), loadHistory(admin, userId, expected)]);
    if (!offers.ok || !history.ok) return { state: "unreadable" };
    return { state: "ready", offers: offers.data.cards, pendingGrants: offers.data.pendingGrants, summaries: history.data.summaries, history: history.data, startable: await startableByCompetency(admin, offers.data.cards) };
  } catch { return { state: "unreadable" }; }
}

/** The competencies' expected level (the scale's own ordinal) from the catalogue the learner is offered. */
export const expectedMap = (competencies: readonly { id: string; expectedLevel: { score: number } | null }[] | null): Map<string, number | null> =>
  new Map((competencies ?? []).map(c => [c.id, c.expectedLevel?.score ?? null]));

/** The Passport's verifications as the Overview's facts: null when the Passport could not be read; none when verification is not on here. */
export function verificationFacts(passport: { verifications?: { provisioned: boolean; items: { competencyId: string; outcomeLabel: string; issuer: string; decidedAt: string; current: boolean }[] | null } } | null): VerificationFact[] | null {
  if (!passport) return null;
  if (!passport.verifications?.provisioned) return [];
  if (passport.verifications.items === null) return null;
  return passport.verifications.items.map(v => ({ competencyId: v.competencyId, outcomeLabel: v.outcomeLabel, issuer: v.issuer, decidedAt: v.decidedAt, current: v.current }));
}

/** The facts the pure model needs, from the rows loadCompetencyProfile already read. */
export function progressFacts(progress: { layers: { rows: { id: string; sectionsAccepted: number; sectionsProposed: number; questions: number; answered: number; latestAccuracy: number | null; status: ProgressFact["status"] }[] }[] } | null): Map<string, ProgressFact> {
  const out = new Map<string, ProgressFact>();
  for (const l of progress?.layers ?? []) for (const r of l.rows) out.set(r.id, { sectionsAccepted: r.sectionsAccepted, sectionsProposed: r.sectionsProposed, questions: r.questions, answered: r.answered, latestAccuracy: r.latestAccuracy, status: r.status });
  return out;
}

/** The programme's competencies plus every competency the learner has a self-assessment on. The extra ones are named from their labels only. */
export async function competenciesWithOwn(admin: Admin, programme: readonly OverviewCompetency[], side: Extract<SelfSide, { state: "ready" }> | null): Promise<OverviewCompetency[]> {
  if (!side) return [...programme];
  const have = new Set(programme.map(c => c.id));
  const extraIds = [...side.history.selfMapped.keys()].filter(id => !have.has(id));
  const labels = extraIds.length ? await loadCompetencyLabels(admin, extraIds) : new Map();
  return unionCompetencies(programme, side.history.selfMapped.keys(), labels);
}

export function overviewFrom(args: {
  competencies: readonly OverviewCompetency[]; side: Extract<SelfSide, { state: "ready" }> | null;
  progress: ReadonlyMap<string, ProgressFact>; activity: ReadonlyMap<string, ActivityFact> | null; verifications: readonly VerificationFact[] | null;
}) {
  const attempts: ReadonlyMap<string, readonly Attempt[]> = args.side?.history.attempts ?? new Map();
  const findings: ReadonlyMap<string, readonly Finding[]> = args.side?.history.latestFindings ?? new Map();
  return buildOverview({
    competencies: args.competencies, attempts, progress: args.progress, activity: args.activity, verifications: args.verifications,
    startable: args.side?.startable ?? new Map(), findings, scaleMax: args.side?.history.scaleMax ?? null,
    openSelf: new Map([...(args.side?.history.selfMapped ?? [])].flatMap(([id, v]) => (v.inProgressId ? [[id, v.inProgressId] as [string, string]] : []))),
  });
}

/** For My Plan: the gaps the learner's own latest self-assessments show, as the plan engine's input. Fails soft (nothing) on any error. */
export async function planGapsFor(admin: Admin, userId: string, competencies: readonly { id: string; title: string; expectedLevel: { score: number } | null }[]): Promise<{ competencyId: string; title: string; assessedAt: string; self: number | null; expected: number | null; gapItems: number }[]> {
  try {
    if (!competencies.length || !(await assessmentsReady(admin, userId))) return [];
    const h = await loadHistory(admin, userId, expectedMap(competencies));
    if (!h.ok) return [];
    const out = [];
    for (const c of competencies) {
      const latest = [...(h.data.attempts.get(c.id) ?? [])].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).pop();
      if (!latest) continue;
      out.push({
        competencyId: c.id, title: c.title, assessedAt: latest.submittedAt, self: latest.rating.rating, expected: c.expectedLevel?.score ?? null,
        gapItems: (h.data.latestFindings.get(c.id) ?? []).filter(f => f.kind !== "met").length,
      });
    }
    return out;
  } catch { return []; }
}

/** My Plan's input for the competency rule: nothing unless the learner may see the module, the tables are here and they have submitted a self-assessment. Fails soft. */
export async function competencyGapsForPlan(admin: Admin, userId: string) {
  try {
    if (!(await scholarModulesFor(admin, userId)).has("competencies")) return [];
    const learner = await loadLearnerCatalogue(admin, userId);
    return await planGapsFor(admin, userId, learner.competencies ?? []);
  } catch { return []; }
}
