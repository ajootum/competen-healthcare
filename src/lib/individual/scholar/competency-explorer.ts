import { matchesSearch } from "../search/match";
import { frameworkTree, type FrameworkTree } from "@/lib/competency/framework-tree";

// ── MY COMPETENCIES EXPLORER: THE VIEW MODEL ── SCHOLAR-COMPETENCY-EXPLORER-HFE-01 (owner instruction 3 Nov 2026) ──
//
// Pure and client-safe. The learner's programme as Holdings organised it (Framework -> Area -> Domain -> Competency, in
// the saved order, through framework-tree.ts) with, on every competency, INDEPENDENT progress indicators derived from the
// records Scholar already keeps. No second engine: the facts come in from the existing readers (competency progress on
// accepted links, learning activity, the self-assessment history, the evidence-supported stage, the Passport) and are
// only worded and counted here.
//
// ⚠ SEVEN INDICATORS, NEVER ONE STATUS. Each is true or false on its own:
//   Material linked            a section of the learner's notes is linked to the competency by an ACCEPTED mapping.
//                              Accepting a mapping is a decision about the notes, NOT practice: it never sets Practised.
//   Learning started           a Learn session on the competency, or learning activity on a linked section.
//   Practised                  practice done against the competency: a practice question answered through an accepted
//                              link, a finished OSCE run on a station for it, or a completed clinical case mapped to it.
//   Self-assessed              the learner submitted a self-assessment that rates it (self-reported, never verified).
//   Learning evidence available a recorded outcome the evidence view can show: a measured practice result, a finished
//                              OSCE run, a completed case, or an assessor-led stage decision. A knowledge assessment
//                              never establishes clinical competence, and the page never says it does.
//   Verified                   a current independent verification on the Passport. Nothing else produces it.
//   Not started                none of the above, no suggested link waiting and no self-assessment open.
//
// ⚠ "NEEDS ATTENTION" is a difference the learner can act on (a self-identified gap, self rating and practice that
// differ, a stage with outstanding requirements, a self rating below the programme's expected level). It is never a
// deficiency where nothing is recorded yet: a competency with no record is Not started, and that is all it is.

export type ExplorerFacts = {
  sectionsAccepted: number; sectionsProposed: number; questions: number; answered: number; latestAccuracy: number | null;
  learningActions: number; learningSessions: number; lastLearningAt: string | null;
  osceFinished: number; casesCompleted: number; lastPracticeAt: string | null;
  selfAttempts: number; selfLatestAt: string | null; selfLatestRating: number | null; selfOpen: boolean; selfGaps: number;
  compareDiffers: boolean;
  /** An assessor-led stage decision exists (staged or not staged); outstanding = its requirements still open. */
  stage: { outstanding: number } | null;
  verified: boolean;
  expected: number | null;
};

export const INDICATOR_KEYS = ["material_linked", "learning_started", "practised", "self_assessed", "evidence_available", "verified"] as const;
export type IndicatorKey = (typeof INDICATOR_KEYS)[number];
export type Indicators = Record<IndicatorKey, boolean> & { not_started: boolean };

export const INDICATOR_LABEL: Record<IndicatorKey | "not_started", string> = {
  not_started: "Not started",
  material_linked: "Material linked",
  learning_started: "Learning started",
  practised: "Practised",
  self_assessed: "Self-assessed",
  evidence_available: "Learning evidence available",
  verified: "Verified",
};

export const EMPTY_FACTS: ExplorerFacts = {
  sectionsAccepted: 0, sectionsProposed: 0, questions: 0, answered: 0, latestAccuracy: null,
  learningActions: 0, learningSessions: 0, lastLearningAt: null, osceFinished: 0, casesCompleted: 0, lastPracticeAt: null,
  selfAttempts: 0, selfLatestAt: null, selfLatestRating: null, selfOpen: false, selfGaps: 0, compareDiffers: false, stage: null, verified: false, expected: null,
};

/** Pure: the seven indicators from the facts. */
export function deriveIndicators(f: ExplorerFacts): Indicators {
  const material_linked = f.sectionsAccepted > 0;
  const learning_started = f.learningActions > 0 || f.learningSessions > 0;
  const practised = f.answered > 0 || f.osceFinished > 0 || f.casesCompleted > 0;
  const self_assessed = f.selfAttempts > 0;
  const evidence_available = f.latestAccuracy !== null || f.osceFinished > 0 || f.casesCompleted > 0 || f.stage !== null;
  const verified = f.verified;
  const not_started = !material_linked && !learning_started && !practised && !self_assessed && !evidence_available && !verified && f.sectionsProposed === 0 && !f.selfOpen;
  return { material_linked, learning_started, practised, self_assessed, evidence_available, verified, not_started };
}

/** Pure: whether the learner has something to act on. Never true for a competency with nothing recorded. */
export function needsAttention(f: ExplorerFacts): boolean {
  if (f.selfGaps > 0 || f.compareDiffers) return true;
  if (f.stage && f.stage.outstanding > 0) return true;
  if (f.selfLatestRating !== null && f.expected !== null && f.selfLatestRating < f.expected) return true;
  return false;
}

/** Pure: the newest moment anything happened on the competency, or null. */
export function lastActivityAt(f: ExplorerFacts): string | null {
  const dates = [f.lastLearningAt, f.lastPracticeAt, f.selfLatestAt].filter((d): d is string => !!d);
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}

/** The one concise line a row shows about its progress: the indicators that hold, in the fixed order, or "Not started". */
export function indicatorLine(ind: Indicators): string {
  const on = INDICATOR_KEYS.filter(k => ind[k]).map(k => INDICATOR_LABEL[k]);
  return on.length ? on.join(" · ") : INDICATOR_LABEL.not_started;
}

// ── THE ROWS AND THE TREE ──

export type ExplorerRow = {
  id: string; code: string | null; title: string;
  frameworkId: string; domainId: string | null;
  expected: { score: number; label: string } | null;
  contentStatus: "approved" | "draft" | "unreviewed";
  facts: ExplorerFacts;
  ind: Indicators;
  attention: boolean;
  lastActivityAt: string | null;
};

export type ExplorerDomain = { id: string; name: string; code: string | null; rows: ExplorerRow[]; areaName: string | null };
export type ExplorerArea = {
  /** null: the group of competencies with no Area ("unassigned"). */
  id: string | null; name: string; domains: ExplorerDomain[]; unassigned: boolean;
};
export type ExplorerFramework = {
  id: string; name: string; code: string | null; version: string | null;
  areas: ExplorerArea[];
  areasRead: boolean;
  /** Said to framework administrators, never guessed away: domains with no Area, competencies with no domain of this framework. */
  structureGaps: string[];
  total: number;
};
export type ExplorerSummary = { total: number; selfAssessed: number; learningActivity: number; evidence: number; verified: number; notStarted: number };
export type ExplorerModel = { frameworks: ExplorerFramework[]; summary: ExplorerSummary };

export type ExplorerCompetency = {
  id: string; code: string | null; title: string; frameworkId: string; catalogue: string; frameworkCode?: string | null; catalogueVersion?: string | null;
  domain: string; domainId?: string | null; sortOrder?: number | null;
  expectedLevel: { score: number; label: string } | null; contentStatus: "approved" | "draft" | "unreviewed";
};
export type ExplorerStructure = {
  frameworkId: string;
  areas: { id: string; name: string; sortOrder: number | null }[] | null;
  domains: { id: string; name: string; code: string | null; sortOrder: number | null; areaId: string | null }[];
};

export const UNASSIGNED_AREA_NAME = "Not yet assigned to an Area";

/**
 * Pure. The programme's competencies as its frameworks organise them. `structures` is what loadFrameworkStructure read
 * (null: unreadable -- every framework then shows its competencies in catalogue order under one group, said as such).
 */
export function buildExplorerModel(input: {
  competencies: readonly ExplorerCompetency[];
  structures: ReadonlyMap<string, ExplorerStructure> | null;
  facts: ReadonlyMap<string, ExplorerFacts>;
}): ExplorerModel {
  const rowOf = (c: ExplorerCompetency): ExplorerRow => {
    const facts = { ...(input.facts.get(c.id) ?? EMPTY_FACTS), expected: c.expectedLevel?.score ?? null };
    return { id: c.id, code: c.code, title: c.title, frameworkId: c.frameworkId, domainId: c.domainId ?? null, expected: c.expectedLevel, contentStatus: c.contentStatus, facts, ind: deriveIndicators(facts), attention: needsAttention(facts), lastActivityAt: lastActivityAt(facts) };
  };
  const byFramework = new Map<string, ExplorerCompetency[]>();
  for (const c of input.competencies) byFramework.set(c.frameworkId, [...(byFramework.get(c.frameworkId) ?? []), c]);
  const frameworks: ExplorerFramework[] = [];
  for (const [fid, comps] of byFramework) {
    const rows = new Map(comps.map(c => [c.id, rowOf(c)]));
    const s = input.structures?.get(fid) ?? null;
    const first = comps[0];
    const gaps: string[] = [];
    let areas: ExplorerArea[];
    let areasRead = false;
    if (!s) {
      // No structure read: the catalogue order, one group, honestly labelled by the caller (areasRead false).
      const byDomain = new Map<string, ExplorerCompetency[]>();
      for (const c of comps) byDomain.set(c.domainId ?? c.domain, [...(byDomain.get(c.domainId ?? c.domain) ?? []), c]);
      areas = [{ id: null, name: first.catalogue, unassigned: false, domains: [...byDomain.values()].map(list => ({ id: list[0].domainId ?? list[0].domain, name: list[0].domain, code: null, areaName: null, rows: list.map(c => rows.get(c.id)!) })) }];
    } else {
      const tree: FrameworkTree = frameworkTree({
        areas: s.areas, domains: s.domains,
        competencies: comps.filter(c => c.domainId).map(c => ({ id: c.id, name: c.title, domainId: c.domainId!, sortOrder: c.sortOrder ?? null })),
      });
      areasRead = tree.areasRead;
      areas = tree.areas.map(a => ({
        id: a.area?.id ?? null, name: a.area?.name ?? UNASSIGNED_AREA_NAME, unassigned: a.area === null && tree.areasRead && (s.areas?.length ?? 0) > 0,
        domains: a.domains.filter(d => d.competencyIds.length).map(d => ({ id: d.id, name: d.name, code: d.code, areaName: a.area?.name ?? null, rows: d.competencyIds.map(id => rows.get(id)!) })),
      })).filter(a => a.domains.length);
      // A competency the framework's domains do not hold (a referenced one, or no domain id): listed, never dropped.
      const placed = new Set(areas.flatMap(a => a.domains.flatMap(d => d.rows.map(r => r.id))));
      const loose = comps.filter(c => !placed.has(c.id));
      if (loose.length) {
        const byDomain = new Map<string, ExplorerCompetency[]>();
        for (const c of loose) byDomain.set(c.domain, [...(byDomain.get(c.domain) ?? []), c]);
        areas.push({ id: null, name: UNASSIGNED_AREA_NAME, unassigned: true, domains: [...byDomain.entries()].map(([name, list]) => ({ id: list[0].domainId ?? name, name, code: null, areaName: null, rows: list.map(c => rows.get(c.id)!) })) });
        gaps.push(`${loose.length} competenc${loose.length === 1 ? "y is" : "ies are"} not placed in a domain of ${first.catalogue}.`);
      }
      const unassignedDomains = s.domains.filter(d => tree.unassignedDomainIds.includes(d.id) && comps.some(c => c.domainId === d.id));
      if (unassignedDomains.length) gaps.push(`${unassignedDomains.length} domain${unassignedDomains.length === 1 ? "" : "s"} of ${first.catalogue} ${unassignedDomains.length === 1 ? "has" : "have"} no Area: ${unassignedDomains.map(d => d.name).join(", ")}.`);
    }
    frameworks.push({ id: fid, name: first.catalogue, code: first.frameworkCode ?? null, version: first.catalogueVersion ?? null, areas, areasRead, structureGaps: gaps, total: comps.length });
  }
  const all = frameworks.flatMap(f => f.areas.flatMap(a => a.domains.flatMap(d => d.rows)));
  return {
    frameworks,
    summary: {
      total: all.length,
      selfAssessed: all.filter(r => r.ind.self_assessed).length,
      learningActivity: all.filter(r => r.ind.learning_started || r.ind.practised || r.ind.material_linked).length,
      evidence: all.filter(r => r.ind.evidence_available).length,
      verified: all.filter(r => r.ind.verified).length,
      notStarted: all.filter(r => r.ind.not_started).length,
    },
  };
}

// ── SEARCH, FILTERS AND SORTING ── structure-preserving, client-side ──

export const FILTERS = ["all", "not_started", "in_progress", "self_assessed", "evidence", "attention"] as const;
export type ExplorerFilter = (typeof FILTERS)[number];
export const FILTER_LABEL: Record<ExplorerFilter, string> = {
  all: "All", not_started: "Not started", in_progress: "In progress", self_assessed: "Self-assessed", evidence: "Learning evidence available", attention: "Needs attention",
};
export const SORTS = ["framework", "recent", "gaps", "alpha"] as const;
export type ExplorerSort = (typeof SORTS)[number];
export const SORT_LABEL: Record<ExplorerSort, string> = { framework: "Framework order", recent: "Recently practised", gaps: "Learning gaps", alpha: "Alphabetical" };

export const isFilter = (v: unknown): v is ExplorerFilter => typeof v === "string" && (FILTERS as readonly string[]).includes(v);
export const isSort = (v: unknown): v is ExplorerSort => typeof v === "string" && (SORTS as readonly string[]).includes(v);

export function rowMatchesFilter(r: ExplorerRow, f: ExplorerFilter): boolean {
  switch (f) {
    case "all": return true;
    case "not_started": return r.ind.not_started;
    case "in_progress": return !r.ind.not_started && (r.ind.material_linked || r.ind.learning_started || r.ind.practised || r.facts.selfOpen || r.facts.sectionsProposed > 0);
    case "self_assessed": return r.ind.self_assessed;
    case "evidence": return r.ind.evidence_available;
    case "attention": return r.attention;
  }
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Pure: every word of the query must occur in the competency's title, code, domain, Area or framework. */
export function rowMatchesQuery(r: ExplorerRow, context: { domain: string; area: string | null; framework: string; frameworkCode: string | null }, q: string): boolean {
  return matchesSearch([r.title, r.code ?? "", context.domain, context.area ?? "", context.framework, context.frameworkCode ?? ""], q);
}

const cmpIso = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a > b ? -1 : 1);

/** Pure: rows of ONE domain in the chosen order. Framework order is the order given. Ties keep the framework order. */
export function sortRows(rows: readonly ExplorerRow[], sort: ExplorerSort): ExplorerRow[] {
  const indexed = rows.map((r, i) => ({ r, i }));
  const tie = (a: { i: number }, b: { i: number }) => a.i - b.i;
  switch (sort) {
    case "framework": return [...rows];
    case "alpha": return indexed.sort((a, b) => a.r.title.localeCompare(b.r.title) || tie(a, b)).map(x => x.r);
    case "recent": return indexed.sort((a, b) => cmpIso(a.r.lastActivityAt, b.r.lastActivityAt) || tie(a, b)).map(x => x.r);
    case "gaps": {
      // What to work on first: needs attention, then not started (highest expected level first), then the rest.
      const rank = (r: ExplorerRow) => (r.attention ? 0 : r.ind.not_started ? 1 : r.ind.verified ? 3 : 2);
      return indexed.sort((a, b) => rank(a.r) - rank(b.r) || (b.r.expected?.score ?? -1) - (a.r.expected?.score ?? -1) || tie(a, b)).map(x => x.r);
    }
  }
}

export type ExplorerQuery = { q: string; filter: ExplorerFilter; sort: ExplorerSort };

/** Pure: the framework with search, filter and sort applied, every Area -> Domain -> Competency relationship intact. Domains with no row left are dropped; Areas with no domain left are kept with none (so the tab can say "no matches"). */
export function applyQuery(f: ExplorerFramework, query: ExplorerQuery): ExplorerFramework {
  const q = query.q.trim();
  return {
    ...f,
    areas: f.areas.map(a => ({
      ...a,
      domains: a.domains
        .map(d => ({ ...d, rows: sortRows(d.rows.filter(r => rowMatchesFilter(r, query.filter) && rowMatchesQuery(r, { domain: d.name, area: a.id === null ? null : a.name, framework: f.name, frameworkCode: f.code }, q)), query.sort) }))
        .filter(d => d.rows.length),
    })),
  };
}

export const countRows = (a: ExplorerArea) => a.domains.reduce((n, d) => n + d.rows.length, 0);

// ── REMEMBERED NAVIGATION STATE ── per framework, in the browser only ──

export type ExplorerState = { areaId: string | null; expanded: string[]; q: string; filter: ExplorerFilter; sort: ExplorerSort };
export const storageKey = (frameworkId: string) => `scholar.competency-explorer.${frameworkId}`;

/** Pure: a stored value as a state, or null. Unknown values are dropped rather than trusted. */
export function parseExplorerState(raw: unknown): Partial<ExplorerState> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<ExplorerState> = {};
  if (typeof r.areaId === "string" || r.areaId === null) out.areaId = r.areaId as string | null;
  if (Array.isArray(r.expanded)) out.expanded = r.expanded.filter((x): x is string => typeof x === "string").slice(0, 500);
  if (typeof r.q === "string") out.q = r.q.slice(0, 200);
  if (isFilter(r.filter)) out.filter = r.filter;
  if (isSort(r.sort)) out.sort = r.sort;
  return out;
}

// ── THE WORDS ──

export const EXPLORER_HEADING = "Explore Your Competencies";
export const EXPLORER_INTRO = "Explore the competencies in your programme, assess your abilities and track evidence of your learning.";
export const HOW_PROGRESS_WORKS: { title: string; text: string }[] = [
  { title: "Material linked", text: "Scholar suggests which competencies a section of your notes is about. A link counts once you have accepted it. Accepting a link is a decision about your notes, not practice." },
  { title: "Learning started and Practised", text: "Learning started means you have opened a Learn session on the competency or worked on a linked section. Practised means you have answered a practice question written for it, run an OSCE station for it, or completed a clinical case mapped to it. Practice is formative: it is never a judgement of competence." },
  { title: "Self-assessed", text: "Your own rating of yourself on an assessment instrument. It is self-reported and not independently verified, and it never changes your evidence-supported stage." },
  { title: "Learning evidence available", text: "A recorded outcome the evidence view can show: a practice result, a finished OSCE run, a completed case, or a stage worked out from assessor-led assessments. A knowledge assessment does not establish clinical competence." },
  { title: "Verified", text: "An independent verification recorded on your Passport. Nothing you do in Scholar produces it: a self-assessment and a practice result never count as one." },
  { title: "Nothing recorded yet", text: "A competency with nothing recorded is simply not started. It says nothing about you." },
];
