/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadFrameworkStructure } from "@/lib/competency/foundation";
import type { CatalogueCompetency } from "@/lib/individual/scholar/catalogue";
import { buildExplorerModel, type ExplorerFacts, type ExplorerModel, type ExplorerStructure } from "@/lib/individual/scholar/competency-explorer";
import { competencyProgressRows, materialTitles, practiceEvidenceByCompetency } from "@/lib/individual/scholar/store";
import type { OverviewRow } from "@/lib/assessment/adapters/scholar/competency-overview-model";
import type { ActivityFact } from "@/lib/assessment/adapters/scholar/competency-overview-model";
import { TREND_TEXT } from "@/lib/assessment/adapters/scholar/history";
import { BAND_LABEL } from "@/lib/assessment/adapters/scholar/compare";

// ── WHAT THE EXPLORER READS ── SCHOLAR-COMPETENCY-EXPLORER-HFE-01 ─────────────────────────────────────────────────
//
// Beside the Overview's own rows (buildOverview: self rating, linked practice, compare, verification, stage), the Explorer
// needs three more things, each from an existing reader: the frameworks' organisation (foundation.loadFrameworkStructure,
// published only), practice outside practice questions (store.practiceEvidenceByCompetency: OSCE runs, completed cases,
// Learn sessions) and the titles of linked materials (store.materialTitles). Nothing is written, and no new table is read
// for a person that the Progress and Overview pages do not already read.

type Admin = any;

/** What the drawer shows for one competency. Plain data: it crosses to the client. */
export type ExplorerDetail = {
  id: string;
  description: string | null;
  outcomes: string[];
  self: {
    rating: number | null; descriptor: string | null; at: string; range: string | null; trend: string; latestInstanceId: string | null; attempts: number;
    previous: { at: string; rating: number | null; instrument: string }[];
  } | null;
  selfOpenInstanceId: string | null;
  selfStartable: { code: string; name: string } | null;
  gaps: { prompt: string; label: string; code: string | null }[];
  strengths: number;
  evidence: {
    outcome: string | null; sectionsAccepted: number; sectionsProposed: number; questions: number; answered: number; accuracy: number | null;
    lastAt: string | null; lastVerdict: string | null; osceFinished: number; casesCompleted: number; learningSessions: number;
    /** Linked materials (accepted links), by title. null: titles could not be read. */
    materials: { id: string; title: string; sections: number }[] | null;
  };
  compare: { text: string; differs: boolean; selfBand: string | null; evidenceBand: string | null };
  stages: { summary: string; computedAt: string; stale: boolean; note: string }[];
  verification: { state: "not_yet" | "verified" | "unreadable"; line: string; detail: string | null };
};

export type ExplorerData = {
  model: ExplorerModel;
  details: Record<string, ExplorerDetail>;
  /** The frameworks' organisation could not be read: the catalogue order is shown and said. */
  structureUnreadable: boolean;
  /** Practice outside practice questions could not be read: those indicators rest on the rest. */
  practiceUnreadable: boolean;
};

export async function loadExplorerData(admin: Admin, userId: string, catalogue: readonly CatalogueCompetency[], rows: readonly OverviewRow[], activity: ReadonlyMap<string, ActivityFact> | null): Promise<ExplorerData> {
  // The catalogue rows came through loadLearnerCatalogue (published, allowlisted): their frameworks are the only ones whose organisation is read.
  const [structures, practice, progressRows] = await Promise.all([
    loadFrameworkStructure(admin, catalogue).catch(() => null),
    practiceEvidenceByCompetency(admin, userId).catch(() => null),
    competencyProgressRows(admin, userId).catch(() => null),
  ]);
  // Linked materials per competency (accepted links only), by title.
  const acceptedByCompetency = new Map<string, Map<string, number>>();
  if (progressRows?.ok) {
    for (const m of progressRows.data.mappings) {
      if (m.state !== "accepted") continue;
      const per = acceptedByCompetency.get(m.competencyId) ?? new Map<string, number>();
      per.set(m.materialId, (per.get(m.materialId) ?? 0) + 1);
      acceptedByCompetency.set(m.competencyId, per);
    }
  }
  const titles = await materialTitles(admin, userId, [...new Set([...acceptedByCompetency.values()].flatMap(per => [...per.keys()]))]).catch(() => null);

  const byId = new Map(catalogue.map(c => [c.id, c]));
  const facts = new Map<string, ExplorerFacts>();
  const details: Record<string, ExplorerDetail> = {};
  for (const r of rows) {
    const c = byId.get(r.competency.id);
    if (!c) continue;
    const e = r.evidence;
    const p = practice?.get(c.id) ?? null;
    const a = activity?.get(c.id) ?? null;
    const latest = r.self?.history.latest ?? null;
    const stage = r.stages[0] ?? null;
    facts.set(c.id, {
      sectionsAccepted: e.state === "evidence" ? e.sectionsAccepted : 0,
      sectionsProposed: progressRows?.ok ? progressRows.data.mappings.filter(m => m.competencyId === c.id && m.state === "proposed").length : 0,
      questions: e.state === "evidence" ? e.questions : 0,
      answered: e.state === "evidence" ? e.answered : 0,
      latestAccuracy: e.state === "evidence" ? e.accuracy : null,
      learningActions: a?.actions ?? 0,
      learningSessions: p?.learningSessions ?? 0,
      lastLearningAt: a?.lastAt || null,
      osceFinished: p?.osceFinished ?? 0,
      casesCompleted: p?.casesCompleted ?? 0,
      lastPracticeAt: p?.lastAt ?? null,
      selfAttempts: r.self?.history.attempts.length ?? 0,
      selfLatestAt: latest?.submittedAt ?? null,
      selfLatestRating: latest?.rating.rating ?? null,
      selfOpen: !!r.self?.openInstanceId,
      selfGaps: r.self?.gaps.length ?? 0,
      compareDiffers: r.compare.differs,
      stage: stage && stage.state !== "unassessed" ? { outstanding: stage.outstanding.length } : null,
      verified: r.verification.state === "verified",
      expected: c.expectedLevel?.score ?? null,
    });
    const per = acceptedByCompetency.get(c.id);
    details[c.id] = {
      id: c.id,
      description: c.description ?? null,
      outcomes: c.outcomes,
      self: r.self && latest ? {
        rating: r.self.rating, descriptor: r.self.descriptor, at: latest.submittedAt, range: r.self.range, trend: TREND_TEXT[r.self.trend], latestInstanceId: r.self.latestInstanceId,
        attempts: r.self.history.attempts.length,
        previous: [...r.self.history.attempts].reverse().slice(1, 6).map(x => ({ at: x.submittedAt, rating: x.rating.rating, instrument: x.instrumentName })),
      } : null,
      selfOpenInstanceId: r.self?.openInstanceId ?? null,
      selfStartable: r.self?.canRepeat ?? null,
      gaps: (r.self?.gaps ?? []).slice(0, 6).map(g => ({ prompt: g.prompt, label: g.label, code: g.code || null })),
      strengths: r.self?.strengths.length ?? 0,
      evidence: {
        outcome: e.state === "evidence" ? e.outcome : null,
        sectionsAccepted: e.state === "evidence" ? e.sectionsAccepted : 0,
        sectionsProposed: facts.get(c.id)!.sectionsProposed,
        questions: e.state === "evidence" ? e.questions : 0, answered: e.state === "evidence" ? e.answered : 0, accuracy: e.state === "evidence" ? e.accuracy : null,
        lastAt: e.state === "evidence" ? e.lastAt : a?.lastAt || null, lastVerdict: e.state === "evidence" ? e.lastVerdict : null,
        osceFinished: p?.osceFinished ?? 0, casesCompleted: p?.casesCompleted ?? 0, learningSessions: p?.learningSessions ?? 0,
        materials: titles === null ? null : [...(per ?? [])].map(([id, sections]) => ({ id, title: titles.get(id) ?? "A material no longer in your library", sections })),
      },
      compare: { text: r.compare.text, differs: r.compare.differs, selfBand: r.compare.selfBand ? BAND_LABEL[r.compare.selfBand] : null, evidenceBand: r.compare.evidenceBand ? BAND_LABEL[r.compare.evidenceBand] : null },
      stages: r.stages.map(s => ({ summary: s.summary, computedAt: s.computedAt, stale: s.stale, note: s.note })),
      verification: { state: r.verification.state, line: r.verification.line, detail: r.verification.detail },
    };
  }
  const structureMap: Map<string, ExplorerStructure> | null = structures === null ? null : new Map([...structures].map(([k, s]) => [k, { frameworkId: s.frameworkId, areas: s.areas, domains: s.domains }]));
  const model = buildExplorerModel({
    competencies: catalogue.map(c => ({ id: c.id, code: c.code, title: c.title, frameworkId: c.frameworkId, catalogue: c.catalogue, frameworkCode: c.frameworkCode ?? null, catalogueVersion: c.catalogueVersion ?? null, domain: c.domain, domainId: c.domainId ?? null, sortOrder: c.sortOrder ?? null, expectedLevel: c.expectedLevel, contentStatus: c.contentStatus })),
    structures: structureMap, facts,
  });
  return { model, details, structureUnreadable: structures === null, practiceUnreadable: practice === null };
}
