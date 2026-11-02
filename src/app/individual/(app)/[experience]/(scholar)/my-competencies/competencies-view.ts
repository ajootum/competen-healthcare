import { EVIDENCE_LABEL, type IndividualPassport } from "@/lib/individual/passport";
import { STUDY_ACHIEVEMENT, studyDetail } from "@/lib/individual/scholar/passport-items";
import { noProgrammeText } from "@/lib/individual/scholar/classify-view";
import { NO_APPROVED_COMPETENCIES } from "@/lib/individual/scholar/config";
import type { CatalogueCompetency } from "@/lib/individual/scholar/catalogue";
import type { CompetencyCoverage } from "@/lib/competency/progress-model";

// ── MY COMPETENCIES: WHAT EACH DESTINATION SAYS ── SCHOLAR-MODULES-01 ──────────────────────────────────────
//
// Pure: the frameworks grouping, the development-gaps states and the evidence groups, decided from rows the
// existing readers already returned (loadLearnerCatalogue, loadLearningIntelligence's coverage,
// loadIndividualPassport). Nothing here reads, writes or invents a competency, a gap or a piece of evidence.
//
// ⚠ FORMATIVE IS NEVER FORMAL. What the learner did in My Learning (practice, evaluations they chose to show) and
// what an organisation or Competen Holdings recorded are two groups with two headings, and every row carries its
// evidence label in words. Neither group is ever described as the other.
// ⚠ UNREADABLE IS NOT EMPTY. A read that failed is its own state, said as such; "none" only follows a read that
// succeeded and found none. A gap is "not practised yet", never a deficiency or a failure.

export const NO_FRAMEWORK = "No published competency framework is available for your programme yet.";
export const NO_EVIDENCE = "No evidence on your record yet.";
export const LEARNER_EVIDENCE_TITLE = "Your learning evidence (formative, not verified)";
export const FORMAL_RECORDS_TITLE = "Formal records";

type LearnerLike = { provisioned: boolean; programme: { label: string } | null; competencies: CatalogueCompetency[] | null; belowFloor: number };

// ── FRAMEWORKS ──

export type FrameworkGroup = { frameworkId: string; name: string; competencies: CatalogueCompetency[]; layers: string[] };

/** Competencies grouped by the framework (catalogue) they sit in, in first-seen order, each group sorted by code then title. */
export function groupByFramework(competencies: readonly CatalogueCompetency[]): FrameworkGroup[] {
  const groups = new Map<string, FrameworkGroup>();
  for (const c of competencies) {
    const g = groups.get(c.frameworkId) ?? { frameworkId: c.frameworkId, name: c.catalogue, competencies: [], layers: [] };
    g.competencies.push(c);
    if (!g.layers.includes(c.layer)) g.layers.push(c.layer);
    groups.set(c.frameworkId, g);
  }
  const key = (c: CatalogueCompetency) => `${c.code ?? ""}\u0000${c.title}`;
  return [...groups.values()].map(g => ({ ...g, competencies: [...g.competencies].sort((a, b) => key(a).localeCompare(key(b))) }));
}

export type FrameworksView =
  | { kind: "not_set_up"; text: string }
  | { kind: "no_programme"; text: string }
  | { kind: "unreadable" }
  | { kind: "empty"; text: string; heldBack: number }
  | { kind: "groups"; programme: string; groups: FrameworkGroup[]; heldBack: number };

export function frameworksView(learner: LearnerLike, programmesOffered: number | null): FrameworksView {
  if (!learner.provisioned) return { kind: "not_set_up", text: noProgrammeText(0) };
  if (!learner.programme) return { kind: "no_programme", text: noProgrammeText(programmesOffered) };
  if (learner.competencies === null) return { kind: "unreadable" };
  if (learner.competencies.length === 0) return { kind: "empty", text: learner.belowFloor > 0 ? NO_APPROVED_COMPETENCIES : NO_FRAMEWORK, heldBack: learner.belowFloor };
  return { kind: "groups", programme: learner.programme.label, groups: groupByFramework(learner.competencies), heldBack: learner.belowFloor };
}

// ── DEVELOPMENT GAPS ──

export type Gap = { id: string; name: string; expected: string | null };
export type GapsView =
  | { kind: "not_set_up"; text: string }
  | { kind: "no_programme"; text: string }
  | { kind: "unreadable" }
  /** Coverage could not be measured (or too little practice to say): the measure's own reason. */
  | { kind: "not_measured"; reason: string }
  | { kind: "none"; framework: string; total: number }
  | { kind: "gaps"; framework: string; total: number; covered: number; gaps: Gap[] };

export function gapsView(learner: Pick<LearnerLike, "provisioned" | "programme">, coverage: CompetencyCoverage | null, programmesOffered: number | null): GapsView {
  if (!learner.provisioned) return { kind: "not_set_up", text: noProgrammeText(0) };
  if (!learner.programme) return { kind: "no_programme", text: noProgrammeText(programmesOffered) };
  if (coverage === null) return { kind: "unreadable" };
  if (coverage.state !== "measured") return { kind: "not_measured", reason: coverage.reason };
  return coverage.gaps.length === 0
    ? { kind: "none", framework: coverage.framework, total: coverage.total }
    : { kind: "gaps", framework: coverage.framework, total: coverage.total, covered: coverage.covered, gaps: coverage.gaps };
}

// ── EVIDENCE ──

export type EvidenceRow = { key: string; title: string; detail: string; label: string };
export type EvidenceSection = {
  id: string; title: string;
  state: "items" | "empty" | "unreadable" | "unavailable";
  rows: EvidenceRow[];
  /** Said when the section is empty or unavailable. */
  text: string;
};
export type EvidenceView = { learner: EvidenceSection[]; formal: EvidenceSection[]; allEmpty: boolean };

const day = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);
const join = (...p: (string | null | undefined | false)[]) => p.filter(Boolean).join(" · ");

function section<T>(id: string, title: string, read: T[] | null, empty: string, row: (x: T, i: number) => EvidenceRow): EvidenceSection {
  if (read === null) return { id, title, state: "unreadable", rows: [], text: "" };
  return read.length ? { id, title, state: "items", rows: read.map(row), text: "" } : { id, title, state: "empty", rows: [], text: empty };
}

export function evidenceView(p: IndividualPassport): EvidenceView {
  const study: EvidenceSection = !p.study.ok
    ? (p.study.notProvisioned
      ? { id: "study", title: "Study achievements you chose to show", state: "unavailable", rows: [], text: "Showing study achievements is not available here yet." }
      : { id: "study", title: "Study achievements you chose to show", state: "unreadable", rows: [], text: "" })
    : section("study", "Study achievements you chose to show", p.study.data, "Nothing shown. You choose achievements to show, one at a time, in Progress in My Learning.", a => ({
      key: `${a.materialId}-${a.achievement}`, title: a.label,
      detail: join(STUDY_ACHIEVEMENT[a.achievement].name, studyDetail(a), a.lastStudied && `last studied ${day(a.lastStudied)}`), label: EVIDENCE_LABEL.self_directed,
    }));
  const evaluations: EvidenceSection = !p.evaluations.ok
    ? (p.evaluations.notProvisioned
      ? { id: "evaluations", title: "Educational evaluations you chose to show", state: "unavailable", rows: [], text: "Showing evaluations is not available here yet." }
      : { id: "evaluations", title: "Educational evaluations you chose to show", state: "unreadable", rows: [], text: "" })
    : section("evaluations", "Educational evaluations you chose to show", p.evaluations.data, "Nothing shown. You choose an evaluation to show in Evaluate in My Learning.", e => ({
      key: e.evaluationId, title: e.label,
      detail: join(e.scope, e.method, `made ${day(e.madeAt)}`, e.confidence, `${e.limitations} limitation${e.limitations === 1 ? "" : "s"} stated`), label: EVIDENCE_LABEL.educational_evaluation,
    }));

  const formal: EvidenceSection[] = [
    section("assessed", "Competencies assessed by organisations", p.competencies, "No assessed competencies on your record yet.", c => ({
      key: c.competencyId, title: c.name,
      detail: join(c.issuer ? `Issued by ${c.issuer}` : "Issuing organisation not recorded", day(c.decidedAt), c.expiryDate && `${c.current ? "expires" : "expiry"} ${day(c.expiryDate)}`),
      label: `${EVIDENCE_LABEL.institution_issued} · ${c.current ? "Current" : c.outcome.replace(/_/g, " ")}`,
    })),
  ];
  if (p.verifications?.provisioned) {
    formal.push(section("verified", "Verified by Competen Holdings", p.verifications.items, "No verified competencies yet.", v => ({
      key: v.decisionId, title: v.title,
      detail: join(v.issuer, v.method.name ?? "Assessment method", v.method.versionNo ? `version ${v.method.versionNo}` : null, day(v.decidedAt)),
      label: join(v.outcomeLabel, v.current ? "Current" : v.standing.replace(/_/g, " ")),
    })));
  }
  formal.push(section("credentials", "Credentials and registrations held with organisations", p.credentials, "No credentials on your record yet.", (c, i) => ({
    key: `${c.title}-${i}`, title: c.title, detail: join(c.issuingBody, c.type.replace(/_/g, " "), c.expiryDate && `expires ${day(c.expiryDate)}`),
    label: join(EVIDENCE_LABEL[c.evidence], c.status !== "active" && c.status.replace(/_/g, " ")),
  })));
  if (p.learning?.enabled) {
    formal.push(section("learning", "Completed Competen Learning courses", p.learning.items, "No completed Competen Learning courses yet.", l => ({
      key: l.recordId, title: l.title, detail: join(l.detail, day(l.date)), label: l.label,
    })));
  }

  const learner = [study, evaluations];
  const settled = (s: EvidenceSection[]) => s.every(x => x.state === "empty" || x.state === "unavailable");
  return { learner, formal, allEmpty: settled(learner) && settled(formal) };
}
