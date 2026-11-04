/* eslint-disable @typescript-eslint/no-explicit-any */
import { libraryVersionCompetencies } from "@/lib/cases/library";
import { applicationEvidenceRows, competencyAttemptSnapshots, competencyProvenance, type Read } from "./store";
import { caseRecord, linksFromProvenance, osceRecord, questionRecord, type CompetencyLink, type EvidenceRecord } from "./application-evidence";
import type { CompetencyProvenance } from "./attempt-snapshot";

// ── SALE-2026-11 R4 (SALE-13 / SALE-14): THE READ BEHIND APPLICATION EVIDENCE AND THE LEARNING-EVIDENCE VIEW ─────────────
//
// Server only. Reads the rows (store.ts, the only file that queries tables), joins each record to the competencies it was made
// for, and hands them to the pure rules in application-evidence.ts. Nothing is written and nothing is stored.
//
// Where a record kept its competency provenance when it was done (a question's 990/991 snapshot; a case completed with
// scholar_application_evidence on), that provenance is used as kept. Where it did not (an older case, an OSCE run), the competency
// it was made for is read now and the link says so ("not recorded when this was done"): a draft framework is still labelled draft.
// No AI. Every read is bounded; a failed read is not ok, never an empty list.

const MAX_CASES = 60;
const MAX_OSCE = 60;
const MAX_LIBRARY_VERSIONS = 10;

/** Pure-ish helper: the current provenance of many competencies (competencyProvenance reads 20 at a time). */
async function provenanceNow(admin: unknown, ids: readonly string[]): Promise<Map<string, CompetencyProvenance>> {
  const out = new Map<string, CompetencyProvenance>();
  const want = [...new Set(ids)];
  for (let i = 0; i < want.length && i < 200; i += 20) {
    for (const p of await competencyProvenance(admin, want.slice(i, i + 20)).catch(() => [] as CompetencyProvenance[])) out.set(p.id, p);
  }
  return out;
}
const linksNow = (ids: readonly string[], now: ReadonlyMap<string, CompetencyProvenance>): CompetencyLink[] =>
  linksFromProvenance([...new Set(ids)].map(id => ({ ...(now.get(id) ?? { id, content_hash: null, framework_id: null, framework_version: null }), objective: null })), false);

/** SALE-13: the learner's completed cases and finished OSCE runs as application evidence records, newest first. */
export async function loadApplicationEvidence(admin: any, userId: string): Promise<Read<EvidenceRecord[]>> {
  const rows = await applicationEvidenceRows(admin, userId, { maxCases: MAX_CASES, maxOsce: MAX_OSCE });
  if (!rows.ok) return rows;
  const { cases, privateCases, osce, stations } = rows.data;
  // Library plays kept without provenance: the competencies the version is linked to, read by the case library module (ids only).
  const versions = [...new Set(cases.filter(c => c.kind === "library" && !c.competencies?.length).map(c => c.caseRef.replace(/^lib:/, "")))].slice(0, MAX_LIBRARY_VERSIONS);
  const libCompetencies = versions.length ? await libraryVersionCompetencies(admin, versions).catch(() => new Map<string, string[]>()) : new Map<string, string[]>();
  const needNow: string[] = [];
  for (const c of cases) {
    if (c.competencies?.length) continue;
    if (c.kind === "private") needNow.push(...(privateCases.get(c.sessionId)?.competencyIds ?? []));
    else needNow.push(...(libCompetencies.get(c.caseRef.replace(/^lib:/, "")) ?? []));
  }
  for (const r of osce) { const s = stations.get(r.stationId); if (s?.competencyId) needNow.push(s.competencyId); }
  const now = needNow.length ? await provenanceNow(admin, needNow) : new Map<string, CompetencyProvenance>();

  const records: EvidenceRecord[] = [];
  for (const c of cases) {
    const pc = c.kind === "private" ? privateCases.get(c.sessionId) : undefined;
    const competencies = c.competencies?.length ? linksFromProvenance(c.competencies, true)
      : linksNow(c.kind === "private" ? pc?.competencyIds ?? [] : libCompetencies.get(c.caseRef.replace(/^lib:/, "")) ?? [], now);
    records.push(caseRecord({
      snapshotId: c.snapshotId, caseRef: c.caseRef, title: c.title ?? "", completedAt: c.completedAt, materialId: pc?.materialId ?? null,
      decisions: c.decisions.map((d: any) => ({ id: String(d?.id ?? ""), kind: d?.kind ?? null, dimension: d?.dimension ?? null, marking: d?.marking ?? null,
        correct: typeof d?.correct === "boolean" ? d.correct : null, score: typeof d?.score === "number" ? d.score : null, safety: Array.isArray(d?.safety) ? d.safety : [] })),
      corrections: c.corrections, escalations: c.escalations, competencies,
    }));
  }
  for (const r of osce) {
    const s = stations.get(r.stationId);
    records.push(osceRecord({ attemptId: r.attemptId, stationId: r.stationId, title: s?.title ?? "", finishedAt: r.finishedAt, score: r.score, marking: r.marking,
      materialId: s?.materialId ?? null, chunkId: s?.chunkId ?? null, competencies: s?.competencyId ? linksNow([s.competencyId], now) : [] }));
  }
  return { ok: true, data: records.sort((a, b) => b.at.localeCompare(a.at)) };
}

/**
 * SALE-14: every learning record that names a competency -- question answers with their 990/991 snapshot provenance, and the
 * case and OSCE records above -- newest first. `application` reuses a SALE-13 read already made on the same request.
 */
export async function loadCompetencyEvidenceRecords(admin: any, userId: string, application?: Read<EvidenceRecord[]>): Promise<Read<EvidenceRecord[]>> {
  const [snaps, app] = await Promise.all([competencyAttemptSnapshots(admin, userId, 200), application ? Promise.resolve(application) : loadApplicationEvidence(admin, userId)]);
  if (!snaps.ok) return snaps;
  if (!app.ok) return app;
  const unrecorded = snaps.data.filter(s => !s.provenance?.length).flatMap(s => s.competencyIds);
  const now = unrecorded.length ? await provenanceNow(admin, unrecorded) : new Map<string, CompetencyProvenance>();
  const questions = snaps.data.map(s => questionRecord({
    attemptId: s.attemptId, questionId: s.questionId, stem: s.stem, assessedAt: s.assessedAt, outcome: s.outcome, score: s.score, marking: s.marking,
    competencies: s.provenance?.length ? linksFromProvenance(s.provenance, true) : linksNow(s.competencyIds, now),
  }));
  return { ok: true, data: [...questions, ...app.data.filter(r => r.competencies.length > 0)].sort((a, b) => b.at.localeCompare(a.at)) };
}
