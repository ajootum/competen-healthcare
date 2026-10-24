/* eslint-disable @typescript-eslint/no-explicit-any */
// ── STAGE 3: LEARN -- WHAT A SESSION TEACHES ── COMPETEN-SCHOLAR-LEARN-01 L1 and L3 ────────────────────
//
// A learning session is a SCOPE resolved into a SUGGESTED sequence of steps, each a few of the student's own
// sections. Everything here reads what Stage 2 already built -- the ordered chunks, their topics (with the
// student's corrections), full-text search, the competency links -- through the Scholar store. There is no new
// extraction, index or retrieval path (owner GO s2). The plan itself uses no AI: it is the document's own order,
// grouped by topic, so it is the same every time and the student can see why.
//
// ⚠ SUGGESTED, NOT COMPULSORY. A student may skip, revisit or reorder steps and ask about anything at any point.
// ⚠ NOTHING HERE IS ASSESSMENT. An informal check is the student's own signal (config INFORMAL_CHECK_LABEL).

import { createHash } from "node:crypto";
import { STEP_MAX_SECTIONS } from "./config";
import { rankChunks, spreadAcrossMaterials, toTsQuery } from "./retrieval";
import { competencyChunks, getPassage, searchCandidates, sectionLinks, sectionRefs, sectionsOf, topicsOfSections, type LearningStep, type SectionRef } from "./store";
import { competencyLabels, type CompetencyLabel } from "./competency-view";
import type { CatalogueCompetency } from "./catalogue";
import type { GovernedReference } from "./generation";
import { CONTENT_STATUS_LABEL } from "./config";

export type ScopeKind = "section" | "document" | "documents" | "topic" | "competency";
export type LearningScope =
  | { kind: "section"; chunkId: string }
  | { kind: "document"; materialId: string }
  | { kind: "documents"; materialIds: string[] }
  | { kind: "topic"; topic: string; materialIds?: string[] }
  | { kind: "competency"; competencyId: string };

/** Sections a topic session gathers from across the library, at most. */
export const TOPIC_SECTIONS = 24;
export const MAX_SCOPE_MATERIALS = 10;

const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Pure. Sections (already in teaching order) -> the suggested steps. Consecutive sections of the same material
 * share a step, up to STEP_MAX_SECTIONS, and a new step starts where the topics change (no topic in common with
 * the step so far). At most `maxSteps`; `coverage` says how many sections the steps hold, of how many there were.
 */
export function planSteps(sections: readonly SectionRef[], topics: ReadonlyMap<string, readonly string[]>, maxSteps: number): { steps: LearningStep[]; coverage: { sections: number; of: number } } {
  const steps: LearningStep[] = [];
  let cur: SectionRef[] = [], curTopics = new Set<string>();
  const flush = () => { if (cur.length) { steps.push({ step: steps.length, sections: cur }); cur = []; curTopics = new Set(); } };
  for (const s of sections) {
    const t = (topics.get(s.chunkId) ?? []).map(norm).filter(Boolean);
    const sameMaterial = cur.length > 0 && cur[cur.length - 1].materialId === s.materialId;
    const shares = !curTopics.size || !t.length || t.some(x => curTopics.has(x));
    if (cur.length && (!sameMaterial || cur.length >= STEP_MAX_SECTIONS || !shares)) flush();
    if (steps.length >= maxSteps) break;
    cur.push(s); t.forEach(x => curTopics.add(x));
  }
  if (steps.length < maxSteps) flush();
  const held = steps.reduce((n, s) => n + s.sections.length, 0);
  return { steps, coverage: { sections: held, of: sections.length } };
}

/** Pure. A step's name for the student: its topics where known, otherwise where it is in the notes. */
export function stepTitle(step: LearningStep, topics: ReadonlyMap<string, readonly string[]>): string {
  const seen = new Map<string, string>();
  for (const s of step.sections) for (const t of topics.get(s.chunkId) ?? []) if (!seen.has(norm(t))) seen.set(norm(t), t);
  const names = [...seen.values()].slice(0, 3);
  if (names.length) return names.join(", ");
  const first = step.sections[0];
  return first ? `${first.materialTitle}, ${first.pageFrom !== null ? `${first.unit} ${first.pageFrom}` : `section ${first.ordinal}`}` : "This step";
}

export type ResolvedScope = { ok: true; title: string; sections: SectionRef[]; topic: string | null; competencyId: string | null } | { ok: false; status: number; error: string };

/**
 * L1: a scope -> its sections in teaching order, through the existing reads only. The caller has already gated
 * the student; every read is keyed on their own id, so another person's material or section is simply not found.
 */
export async function resolveScope(admin: any, userId: string, scope: LearningScope, labels?: { competencyTitle?: string | null }): Promise<ResolvedScope> {
  if (scope.kind === "section") {
    const p = await getPassage(admin, userId, scope.chunkId);
    if (!p) return { ok: false, status: 404, error: "That section could not be found." };
    const s: SectionRef = { chunkId: p.chunkId, materialId: p.materialId, ordinal: p.ordinal, pageFrom: p.pageFrom, pageTo: p.pageTo, materialTitle: p.materialTitle, unit: p.unit ?? "page" };
    return { ok: true, title: `${s.materialTitle}, ${s.pageFrom !== null ? `${s.unit} ${s.pageFrom}` : `section ${s.ordinal}`}`, sections: [s], topic: null, competencyId: null };
  }
  if (scope.kind === "document" || scope.kind === "documents") {
    const ids = scope.kind === "document" ? [scope.materialId] : scope.materialIds.slice(0, MAX_SCOPE_MATERIALS);
    const r = await sectionsOf(admin, userId, ids);
    if (!r.ok) return { ok: false, status: 503, error: "Your materials could not be read just now." };
    if (!r.data.length) return { ok: false, status: 404, error: "Those materials could not be found." };
    const titles = [...new Set(r.data.map(s => s.materialTitle))];
    return { ok: true, title: titles.length === 1 ? titles[0] : `${titles.length} materials: ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? "…" : ""}`, sections: r.data, topic: null, competencyId: null };
  }
  if (scope.kind === "topic") {
    const tsq = toTsQuery(scope.topic);
    if (!tsq) return { ok: false, status: 400, error: "Name a topic to learn, in a few words." };
    const found = await searchCandidates(admin, userId, tsq, scope.materialIds?.length ? { materialIds: scope.materialIds } : null);
    if (!found.ok) return { ok: false, status: 503, error: "Your notes could not be searched just now." };
    const picked = spreadAcrossMaterials(rankChunks(scope.topic, found.data, 60), TOPIC_SECTIONS);
    if (!picked.length) return { ok: false, status: 404, error: "Your notes do not seem to cover that topic. Try other words." };
    // Teaching order: each material's sections together, in document order, materials in the order they matched.
    const firstSeen = new Map<string, number>(); picked.forEach((c, i) => { if (!firstSeen.has(c.materialId)) firstSeen.set(c.materialId, i); });
    const ordered = [...picked].sort((a, b) => firstSeen.get(a.materialId)! - firstSeen.get(b.materialId)! || a.ordinal - b.ordinal);
    return { ok: true, title: scope.topic, sections: await sectionRefs(admin, userId, ordered), topic: scope.topic, competencyId: null };
  }
  const linked = await competencyChunks(admin, userId, scope.competencyId);
  if (!linked.ok) return { ok: false, status: 503, error: "Your notes could not be read just now." };
  if (!linked.data.length) return { ok: false, status: 404, error: "None of your notes is linked to that competency yet. Find the topics in a material and accept the links that fit." };
  return { ok: true, title: labels?.competencyTitle ?? "A competency", sections: await sectionRefs(admin, userId, linked.data), topic: null, competencyId: scope.competencyId };
}

/** L1/L3: the topics of a session's sections, read from Stage 2 (the student's corrections included). */
export const sessionTopics = topicsOfSections;

/**
 * The governed references for some sections: the competencies they are linked to (accepted first) with the
 * outcome named where one was, from the student's programme catalogue, labelled with the review state. [] when
 * the student has no programme or no usable catalogue (R1): learning goes on without them.
 */
export async function governedReferences(admin: any, userId: string, chunkIds: readonly string[], catalogue: CatalogueCompetency[] | null, limit = 4): Promise<GovernedReference[]> {
  const links = await sectionLinks(admin, userId, chunkIds);
  if (!links.length) return [];
  const ordered = [...links].sort((a, b) => Number(b.accepted) - Number(a.accepted));
  const unique = [...new Map(ordered.map(l => [l.competencyId, l])).values()].slice(0, limit);
  const labels: Map<string, CompetencyLabel> = await competencyLabels(admin, catalogue, unique.map(l => l.competencyId), new Map());
  return unique.map(l => {
    const lab = labels.get(l.competencyId);
    return { competencyId: l.competencyId, title: lab?.title ?? "A competency", code: lab?.code ?? null, outcome: l.outcome, status: CONTENT_STATUS_LABEL[(lab?.contentStatus ?? "unreviewed") as keyof typeof CONTENT_STATUS_LABEL] ?? CONTENT_STATUS_LABEL.unreviewed };
  });
}

/** The learning actions whose answers are reusable artefacts (s8). Conversation -- ask, check, clarify -- is not. */
export const ARTEFACT_ACTIONS = ["teach", "explain", "simplify", "deeper", "examples", "summary"] as const;
export const isArtefactAction = (a: string): a is (typeof ARTEFACT_ACTIONS)[number] => (ARTEFACT_ACTIONS as readonly string[]).includes(a);

/**
 * AI-FAIR-USE-01 s8: the key that makes the same request return the saved artefact instead of a new AI call -- the
 * action, the depth, the sections (as a set), the prompt version, and which references (by competency and outcome)
 * it would be given. Anything that would change the answer changes the key.
 */
export function artefactKey(input: { action: string; depth: string; chunkIds: readonly string[]; promptVersion: string; references: readonly GovernedReference[]; background: boolean }): string {
  const refs = input.references.map(r => `${r.competencyId ?? r.title}|${r.outcome ?? ""}`).sort().join(";");
  const basis = [input.action, input.depth, [...input.chunkIds].sort().join(","), input.promptVersion, refs, input.background ? "bg" : "nobg"].join("\n");
  return createHash("sha256").update(basis).digest("hex");
}
