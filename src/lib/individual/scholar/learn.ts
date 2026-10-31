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
import { rankChunks, spreadAcrossMaterials, toTsQuery } from "./retrieval";
import { chunksByIds, competencyChunks, getPassage, isUuid, searchCandidates, sectionLinks, sectionRefs, sectionTopicRows, sectionsOf, topicsOfSections, type LearningStep, type SectionRef } from "./store";
import { topicIndex, topicKey } from "./learn-search";
import { competencyLabels } from "./competency-view";
import { referenceCollections, type CatalogueCompetency, type ReferenceCompetency } from "./catalogue";
import type { GovernedReference } from "./generation";
import { matchLibrary } from "./exam-answer";
import { CONTENT_STATUS_LABEL, REFERENCE_CHANGED_LABEL } from "./config";
import type { IndividualPolicy } from "../policy";

export type ScopeKind = "section" | "document" | "documents" | "topic" | "competency";
/** SCH-LEARN-UX-01: the sources a student chose from a search -- documents, sections and topics -- and, optionally, what they typed. */
export type SourcesScope = { kind: "sources"; materialIds: string[]; chunkIds: string[]; topics: string[]; topic?: string };
export type LearningScope =
  | { kind: "section"; chunkId: string }
  | { kind: "document"; materialId: string }
  | { kind: "documents"; materialIds: string[] }
  | { kind: "topic"; topic: string; materialIds?: string[] }
  | { kind: "competency"; competencyId: string }
  | SourcesScope;

/** Sections a topic session gathers from across the library, at most. */
export const TOPIC_SECTIONS = 24;
export const MAX_SCOPE_MATERIALS = 10;
/** SCH-LEARN-UX-01: chosen sections and chosen topics in one "Teach me using selected sources", at most (the selection itself is held to MAX_SCOPE_MATERIALS in all). */
export const MAX_SCOPE_SECTIONS = TOPIC_SECTIONS;
export const MAX_SCOPE_TOPICS = MAX_SCOPE_MATERIALS;

/** Pure. The words a student typed into a scope (a topic, or chosen topics), screened for patient identifiers before use. */
export const scopeText = (scope: LearningScope): string =>
  scope.kind === "topic" ? scope.topic : scope.kind === "sources" ? [scope.topic ?? "", ...scope.topics].join(" ").trim() : "";

/** Pure. How a sources session is kept (414's kinds): a named topic as a topic session, otherwise by what it covers. */
export function storedScopeKind(scope: LearningScope, sections: readonly SectionRef[]): ScopeKind {
  if (scope.kind !== "sources") return scope.kind;
  if (scope.topic || scope.topics.length) return "topic";
  if (!scope.chunkIds.length) return scope.materialIds.length > 1 ? "documents" : "document";
  if (sections.length === 1) return "section";
  return new Set(sections.map(s => s.materialId)).size > 1 ? "documents" : "document";
}

const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// ── SCHOLAR-LEARN-FIX-01 L-A: LESSONS, NOT SLIDES ───────────────────────────────────────────────────────────────────
//
// Production, 31 Oct: a 47-section deck gave 8 steps covering 9 sections, and step 1 was the title slide alone. A step
// broke wherever the next section shared no EXACT topic string, and a near-empty title or agenda slide was a step of
// its own. The plan is now a set of LESSONS: thin sections join their neighbour, and the material is cut into at most
// maxSteps contiguous lessons where the headings and topics change most, with sizes balanced. Still pure, still no AI,
// still the document's own order, so it is the same every time. Saved sessions keep the steps they were given (414).

/** What the planner and the lesson titles read of a section: its heading (first line), its size and its text. */
export type SectionProfile = { heading: string | null; chars: number; content?: string };
/** A section below this many characters (a title, agenda or divider slide) is not a lesson of its own. */
export const LESSON_THIN_CHARS = 160;
/** A lesson holds at most this many sections and characters (one section larger than that is a lesson alone). */
export const LESSON_MAX_SECTIONS = 10;
export const LESSON_MAX_CHARS = 7200;
/** A lesson aims at the planned material's size over maxSteps, never below this: a short material is one or two lessons. */
export const LESSON_MIN_TARGET_CHARS = 1500;
/** A lesson whose own text is shorter than this (an older session's title-slide step) is thin: Teach adds related sections of the same material. */
export const TEACH_THIN_CHARS = 400;
/** The size assumed for a section whose text was not read (no profile): an ordinary section, never a thin one. */
const UNREAD_CHARS = 600;
/** Cutting between two sections costs this times how alike they are (0-1); a lesson's distance from the target size costs its square. */
const CUT_WEIGHT = 1;

const SPEAKER_NOTES = /^speaker notes:?$/i;
/** Headings that say where you are, not what is taught: never a lesson title. */
const GENERIC_HEADING = /^(objectives?|learning objectives?|learning outcomes?|aims?|agenda|outline|contents?|overview|introduction|intro|summary|conclusions?|references?|bibliography|questions?|any questions\??|thank you|thanks|tools|discussion|activity|exercise|notes?|appendix)$/i;
const FUNCTION_WORD = /^(a|an|and|as|at|by|for|from|in|into|of|on|or|the|to|vs|with|within|without)$/i;
const HEADING_STOP = new Set("a an and are as at be by for from how in into is it its of on or the this to what when where which who why with your".split(" "));

/** Pure. A section's first line as a heading, cleaned, or null where it is not one (a sentence, a number, the notes marker). */
export function sectionHeading(content: string): string | null {
  const line = (content.split("\n").map(l => l.trim()).find(Boolean) ?? "").replace(/\s+/g, " ");
  if (!line || SPEAKER_NOTES.test(line) || !/\p{L}/u.test(line)) return null;
  const words = line.split(" ");
  // A full sentence (a quotation, a definition) is content, not a heading.
  if (line.length > 90 || words.length > 12 || (/[.!]$/.test(line) && words.length > 6)) return null;
  // A citation in brackets ("Just Culture (Leape, 2000)") is where the slide came from, not what it teaches.
  return line.replace(/\s*\([^)]*\b\d{4}\b[^)]*\)/g, "").replace(/[\s:;,.–—-]+$/u, "").trim() || null;
}

/** Pure. A section's profile from its text: the heading, and its size without the speaker-notes marker. */
export const sectionProfile = (content: string): SectionProfile =>
  ({ heading: sectionHeading(content), chars: content.replace(/\n*Speaker notes:\n*/i, " ").trim().length, content });

/** Pure. The words of a heading or topic as the planner compares them: lower-case, no stop words, five-letter stems. */
export function stems(text: string): string[] {
  const out = new Set<string>();
  for (const w of text.toLowerCase().normalize("NFKD").split(/[^a-z0-9]+/)) {
    if (w.length < 3 || HEADING_STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w.length > 5 ? w.slice(0, 5) : w);
  }
  return [...out];
}

type Unit = { sections: SectionRef[]; chars: number; material: string; head: Set<string>; topic: Set<string> };

/** Pure. How alike two neighbouring units are, 0-1: their headings' word overlap or their topics' Jaccard, whichever is higher. */
function likeness(a: Unit, b: Unit): number {
  const common = (x: Set<string>, y: Set<string>) => { let n = 0; for (const w of x) if (y.has(w)) n++; return n; };
  const head = a.head.size && b.head.size ? common(a.head, b.head) / Math.min(a.head.size, b.head.size) : 0;
  const both = a.topic.size && b.topic.size ? common(a.topic, b.topic) : 0;
  const topic = both ? both / (a.topic.size + b.topic.size - both) : 0;
  return Math.max(head, topic);
}

/**
 * Pure. Sections (already in teaching order) -> the suggested LESSONS (SCHOLAR-LEARN-FIX-01).
 *   1. A thin section (under LESSON_THIN_CHARS: a title, agenda or divider slide) joins the next section of its material
 *      (the previous one at the material's end), so it is never a lesson alone.
 *   2. Capacity: at most maxSteps lessons of LESSON_MAX_SECTIONS sections and LESSON_MAX_CHARS characters each. What is
 *      beyond that is left unplanned FROM THE END, so the lessons always cover one contiguous run from the start, and
 *      `coverage` says how many sections they hold, of how many there were.
 *   3. That run is cut into at most maxSteps contiguous lessons, never across materials, by the cuts that cost least
 *      (dynamic programming, deterministic): cutting between alike neighbours (heading words, topics) costs their
 *      likeness, and each lesson costs its squared distance from the target size (the run's size over maxSteps).
 * Without profiles (text not read) every section counts as an ordinary one with no heading, and topics alone decide.
 */
export function planSteps(sections: readonly SectionRef[], topics: ReadonlyMap<string, readonly string[]>, maxSteps: number, profiles: ReadonlyMap<string, SectionProfile> = new Map()): { steps: LearningStep[]; coverage: { sections: number; of: number } } {
  const max = Math.max(1, Math.floor(maxSteps));
  const charsOf = (s: SectionRef) => profiles.get(s.chunkId)?.chars ?? UNREAD_CHARS;
  const unitOf = (list: SectionRef[]): Unit => ({
    sections: list, chars: list.reduce((t, s) => t + charsOf(s), 0), material: list[0].materialId,
    head: new Set(list.filter(s => charsOf(s) >= LESSON_THIN_CHARS).flatMap(s => stems(profiles.get(s.chunkId)?.heading ?? ""))),
    topic: new Set(list.flatMap(s => (topics.get(s.chunkId) ?? []).flatMap(stems))),
  });
  // 1. Units: each substantive section with the thin ones just before it; thin ones at a material's end join the last.
  const units: Unit[] = [];
  let pending: SectionRef[] = [];
  const settle = () => {
    if (!pending.length) return;
    const prev = units[units.length - 1];
    if (prev && prev.material === pending[0].materialId) units[units.length - 1] = unitOf([...prev.sections, ...pending]);
    else units.push(unitOf(pending));
    pending = [];
  };
  for (const s of sections) {
    if (pending.length && pending[0].materialId !== s.materialId) settle();
    // A thin section that carries the previous one on (its heading words are all the previous heading's: the last,
    // short slide of "FMEA") joins it; any other thin section (a title, an agenda) leads into what follows.
    const prev = units[units.length - 1];
    const words = stems(profiles.get(s.chunkId)?.heading ?? "");
    if (charsOf(s) < LESSON_THIN_CHARS && !pending.length && prev?.material === s.materialId && words.length && words.every(w => prev.head.has(w))) {
      units[units.length - 1] = { ...prev, sections: [...prev.sections, s], chars: prev.chars + charsOf(s) };
      continue;
    }
    pending.push(s);
    if (charsOf(s) >= LESSON_THIN_CHARS) { units.push(unitOf(pending)); pending = []; }
  }
  settle();
  // 2. Capacity, from the start.
  let n = 0, secs = 0, chars = 0;
  while (n < units.length && (n === 0 || (secs + units[n].sections.length <= max * LESSON_MAX_SECTIONS && chars + units[n].chars <= max * LESSON_MAX_CHARS))) {
    secs += units[n].sections.length; chars += units[n].chars; n++;
  }
  // 3. The cuts. best[i][k]: the least cost of units 0..i-1 as k lessons; from[i][k]: where the last lesson starts.
  const preC = [0], preS = [0];
  for (let j = 0; j < n; j++) { preC.push(preC[j] + units[j].chars); preS.push(preS[j] + units[j].sections.length); }
  const target = Math.max(LESSON_MIN_TARGET_CHARS, chars / max);
  const cut = (i: number) => (i <= 0 || units[i].material !== units[i - 1].material ? 0 : CUT_WEIGHT * likeness(units[i - 1], units[i]));
  const INF = Number.POSITIVE_INFINITY;
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(max + 1).fill(INF));
  const from: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(max + 1).fill(-1));
  best[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let a = i - 1; a >= 0; a--) {
      // A lesson is one material, within the size caps (one unit alone always fits). Wider only grows, so stop.
      if (a < i - 1 && (units[a].material !== units[i - 1].material || preC[i] - preC[a] > LESSON_MAX_CHARS || preS[i] - preS[a] > LESSON_MAX_SECTIONS)) break;
      const d = (preC[i] - preC[a] - target) / target;
      const own = d * d + cut(a);
      for (let k = 1; k <= max; k++) {
        if (best[a][k - 1] === INF) continue;
        const c = best[a][k - 1] + own;
        if (c < best[i][k] - 1e-12) { best[i][k] = c; from[i][k] = a; }
      }
    }
  }
  // The longest run the lessons can hold (all of it, unless there are more materials than steps), at its least cost.
  let end = n;
  while (end > 0 && best[end].every(v => v === INF)) end--;
  let k = 0;
  for (let j = 1; j <= max; j++) if (best[end][j] < (k ? best[end][k] : INF) - 1e-12) k = j;
  const bounds: [number, number][] = [];
  for (let i = end; k > 0 && i > 0; k--) { const a = from[i][k]; bounds.unshift([a, i]); i = a; }
  const steps = bounds.map(([a, b], step) => ({ step, sections: units.slice(a, b).flatMap(u => u.sections) }));
  return { steps, coverage: { sections: steps.reduce((t, s) => t + s.sections.length, 0), of: sections.length } };
}

/** A lesson's name and objective for the student, from the material's own headings and topics (no AI). */
export type LessonOutline = { title: string; objective: string; focus: string[] };
const TITLE_MAX = 80;
const DESCRIBE_NOUN = /\b(diagram|worksheet|framework|model|tool|tools|cycle|analysis|process|steps|method|methods|chart|bundle|checklist|template|pathway|algorithm|scale|score)\b/i;

/** Pure. A heading in sentence case: a Title-Case word becomes lower case only where the material itself writes it so. */
export function sentenceCase(heading: string, content = ""): string {
  const lower = new Set((content.match(/(?:^|[^\p{L}])(\p{Ll}[\p{L}'-]*)/gu) ?? []).map(w => w.replace(/^[^\p{L}]+/u, "")));
  const proper = new Set([...content.matchAll(/\p{Ll}[\p{L}'-]*,? (\p{Lu}\p{Ll}+)/gu)].map(m => m[1]));
  const words = heading.replace(/\s+/g, " ").trim().split(" ");
  const caps = words.filter(w => /\p{L}/u.test(w)).every(w => w === w.toUpperCase());
  const out = words.map((w, i) => {
    const bare = w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
    if (!bare) return w;
    const low = bare.toLowerCase();
    if (i === 0) return caps && bare.length > 1 ? w.replace(bare, bare[0] + bare.slice(1).toLowerCase()) : w.replace(bare, bare[0].toUpperCase() + bare.slice(1));
    if (FUNCTION_WORD.test(bare)) return w.replace(bare, low);
    // An acronym (FMEA, PDSA, WHO) stays, unless the whole heading is shouted and the material writes the word in lower case.
    if (bare === bare.toUpperCase() && bare.length > 1) return caps && lower.has(low) ? w.replace(bare, low) : w;
    // A Title-Case word is lower-cased where the material writes it in lower case, or never writes it capitalised
    // after a lower-case word (a name it does: "the Donabedian framework" keeps Donabedian).
    if (/^\p{Lu}\p{Ll}+$/u.test(bare) && (lower.has(low) || !proper.has(bare))) return w.replace(bare, low);
    return w;
  });
  return out.join(" ");
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n) > n / 2 ? s.lastIndexOf(" ", n) : n).replace(/[\s,;:]+$/, "")}`);
/** The first letter in lower case inside a sentence, unless the first word is an acronym (PDSA) or a name followed by a capitalised word. */
const lowerFirst = (s: string) => (/^\p{Lu}(\p{Ll}*)(\s|$)/u.test(s) && !/^\p{Lu}\p{Ll}+\s+\p{Lu}/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Pure. A lesson's title and objective, deterministic, from what the lesson actually holds:
 *   title      its best heading -- the heading that carries most of the lesson's text (a slide title, or the first
 *              heading line of its most substantive section), never a generic one (Objectives, Agenda ...), cleaned,
 *              sentence-cased, at most 80 characters. Otherwise its top one or two topics phrased as a title. Otherwise
 *              where it is in the notes.
 *   objective  one sentence, "Describe ..." for a tool, model or process and "Explain ..." otherwise, naming the title and
 *              up to two other headings (or topics) the lesson holds.
 *   focus      the headings and topics used, for the lesson's key terms (grounding).
 */
export function lessonOutline(step: LearningStep, topics: ReadonlyMap<string, readonly string[]>, profiles: ReadonlyMap<string, SectionProfile> = new Map()): LessonOutline {
  const groups = new Map<string, { heading: string; chars: number; content: string; first: number }>();
  step.sections.forEach((s, i) => {
    const p = profiles.get(s.chunkId);
    if (!p?.heading || GENERIC_HEADING.test(p.heading.replace(/[?!.:]+$/, "").trim())) return;
    const key = stems(p.heading).join(" ") || norm(p.heading);
    const g = groups.get(key) ?? { heading: p.heading, chars: 0, content: "", first: i };
    g.chars += p.chars; g.content += `\n${p.content ?? ""}`;
    groups.set(key, g);
  });
  const ranked = [...groups.values()].sort((a, b) => b.chars - a.chars || a.first - b.first);
  const seen = new Map<string, string>();
  for (const s of step.sections) for (const t of topics.get(s.chunkId) ?? []) if (norm(t) && !seen.has(norm(t))) seen.set(norm(t), t.trim());
  const topicNames = [...seen.values()];
  const content = step.sections.map(s => profiles.get(s.chunkId)?.content ?? "").join("\n");
  let title: string;
  if (ranked.length) title = clip(sentenceCase(ranked[0].heading, content), TITLE_MAX);
  else if (topicNames.length) title = clip(sentenceCase(listOf(topicNames.slice(0, 2)), topicNames.join(" ").toLowerCase()), TITLE_MAX);
  else {
    const first = step.sections[0];
    title = first ? `${first.materialTitle}, ${first.pageFrom !== null ? `${first.unit} ${first.pageFrom}` : `section ${first.ordinal}`}` : "This step";
    return { title, objective: "Explain what this part of your notes says.", focus: [] };
  }
  // Up to two more headings (then topics), each adding words the title and the ones before it do not already say.
  const said = new Set(stems(title));
  const more: string[] = [];
  for (const x of [...ranked.slice(1).map(g => sentenceCase(g.heading, content)), ...topicNames].map(x => x.replace(/[?!.]+$/, "").trim())) {
    if (more.length >= 2) break;
    const w = stems(x);
    if (!w.length || w.every(t => said.has(t))) continue;
    more.push(x); w.forEach(t => said.add(t));
  }
  const what = title.match(/^what (is|are) (.+?)\??$/i);
  const subject = what ? `what ${what[2]} ${what[1].toLowerCase()}` : lowerFirst(title.replace(/[?!]+$/, ""));
  const verb = !what && DESCRIBE_NOUN.test(title) ? "Describe" : "Explain";
  const objective = `${verb} ${subject}${more.length ? `, including ${listOf(more.map(lowerFirst))}` : ""}.`;
  return { title, objective, focus: [ranked.length ? ranked[0].heading : title, ...more] };
}

/** Pure. A step's name for the student (lessonOutline's title). Callers without profiles get the topics-or-place title. */
export function stepTitle(step: LearningStep, topics: ReadonlyMap<string, readonly string[]>, profiles?: ReadonlyMap<string, SectionProfile>): string {
  return lessonOutline(step, topics, profiles).title;
}

/** The profiles of some of the person's own sections (heading and size), read in batches. Unreadable: none (planning still works). */
export async function sectionProfiles(admin: any, userId: string, chunkIds: readonly string[]): Promise<Map<string, SectionProfile>> {
  const ids = [...new Set(chunkIds)];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const read = await Promise.all(batches.map(b => chunksByIds(admin, userId, b)));
  const out = new Map<string, SectionProfile>();
  for (const r of read) if (r.ok) for (const c of r.data) out.set(c.id, sectionProfile(c.content));
  return out;
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
  if (scope.kind === "sources") return resolveSources(admin, userId, scope);
  const linked = await competencyChunks(admin, userId, scope.competencyId);
  if (!linked.ok) return { ok: false, status: 503, error: "Your notes could not be read just now." };
  if (!linked.data.length) return { ok: false, status: 404, error: "None of your notes is linked to that competency yet. Find the topics in a material and accept the links that fit." };
  return { ok: true, title: labels?.competencyTitle ?? "A competency", sections: await sectionRefs(admin, userId, linked.data), topic: null, competencyId: scope.competencyId };
}

/**
 * SCH-LEARN-UX-01: the chosen sources -> their sections in teaching order. A chosen topic brings the sections topic finding
 * gave it (the student's corrections included), spread over its documents; a chosen document brings all of its own.
 * Every read is keyed on the student's id, so another person's section, document or topic is simply not found.
 */
async function resolveSources(admin: any, userId: string, scope: SourcesScope): Promise<ResolvedScope> {
  const [chosen, docs, topicRows] = await Promise.all([
    chunksByIds(admin, userId, scope.chunkIds), sectionsOf(admin, userId, scope.materialIds),
    scope.topics.length ? sectionTopicRows(admin, userId) : Promise.resolve({ ok: true as const, data: [] }),
  ]);
  if (!chosen.ok || !docs.ok || !topicRows.ok) return { ok: false, status: 503, error: "Your materials could not be read just now." };
  const wanted = new Set(scope.topics.map(topicKey));
  const index = topicIndex(topicRows.data).filter(e => wanted.has(e.key));
  const byMaterial = topicRows.data.filter(r => index.some(e => e.chunkIds.includes(r.chunkId))).map(r => ({ materialId: r.materialId, id: r.chunkId }));
  const topicChunks = await chunksByIds(admin, userId, spreadAcrossMaterials(byMaterial, TOPIC_SECTIONS).map(c => c.id));
  if (!topicChunks.ok) return { ok: false, status: 503, error: "Your materials could not be read just now." };
  const picked = await sectionRefs(admin, userId, [...chosen.data, ...topicChunks.data]);
  const all = [...new Map([...docs.data, ...picked].map(s => [s.chunkId, s])).values()];
  if (!all.length) return { ok: false, status: 404, error: "Those sources could not be found." };
  const firstSeen = new Map<string, number>(); all.forEach((s, i) => { if (!firstSeen.has(s.materialId)) firstSeen.set(s.materialId, i); });
  const ordered = all.sort((a, b) => firstSeen.get(a.materialId)! - firstSeen.get(b.materialId)! || a.ordinal - b.ordinal);
  const named = scope.topic ?? (index.length === 1 ? index[0].name : scope.topics[0]) ?? null;
  const titles = [...new Set(ordered.map(s => s.materialTitle))];
  return { ok: true, title: named ?? (titles.length === 1 ? titles[0] : `${titles.length} materials`), sections: ordered, topic: named, competencyId: null };
}

/** A scope from a request body: a section, a document, chosen documents, a topic (optionally within materials) or a competency. Learn and Revision both use it. A string is the reason it was refused. */
export function parseScope(body: { scope?: Record<string, unknown> } | null): LearningScope | string {
  const s = body?.scope ?? {};
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter(isUuid))].slice(0, MAX_SCOPE_MATERIALS) : []);
  if (s.kind === "section") return isUuid(s.chunkId) ? { kind: "section", chunkId: s.chunkId } : "Choose a section.";
  if (s.kind === "document") return isUuid(s.materialId) ? { kind: "document", materialId: s.materialId } : "Choose a material.";
  if (s.kind === "documents") {
    const m = ids(s.materialIds);
    return m.length ? (m.length === 1 ? { kind: "document", materialId: m[0] } : { kind: "documents", materialIds: m }) : "Choose at least one material.";
  }
  if (s.kind === "topic") {
    const topic = typeof s.topic === "string" ? s.topic.replace(/\s+/g, " ").trim() : "";
    if (topic.length < 2 || topic.length > 120) return "Name a topic in a few words.";
    const m = ids(s.materialIds);
    return { kind: "topic", topic, materialIds: m.length ? m : undefined };
  }
  if (s.kind === "competency") return isUuid(s.competencyId) ? { kind: "competency", competencyId: s.competencyId } : "Choose a competency.";
  if (s.kind === "sources") {
    const m = ids(s.materialIds);
    const c = Array.isArray(s.chunkIds) ? [...new Set(s.chunkIds.filter(isUuid))].slice(0, MAX_SCOPE_SECTIONS) : [];
    const t = Array.isArray(s.topics) ? [...new Set(s.topics.filter((x): x is string => typeof x === "string").map(x => x.replace(/\s+/g, " ").trim()).filter(x => x.length >= 2 && x.length <= 120))].slice(0, MAX_SCOPE_TOPICS) : [];
    const topic = typeof s.topic === "string" ? s.topic.replace(/\s+/g, " ").trim() : "";
    if (topic && (topic.length < 2 || topic.length > 120)) return "Name a topic in a few words.";
    if (!m.length && !c.length && !t.length) return topic ? { kind: "topic", topic } : "Choose at least one source.";
    return { kind: "sources", materialIds: m, chunkIds: c, topics: t, ...(topic ? { topic } : {}) };
  }
  return "Choose what to learn.";
}

/** L1/L3: the topics of a session's sections, read from Stage 2 (the student's corrections included). */
export const sessionTopics = topicsOfSections;

/**
 * LEARN-01 item 5: where Learn's governed references come from. The policy's collections when HQ lists any;
 * otherwise (the default) the student's programme catalogue -- the CFCA catalogues Scholar is already allowed.
 * Collections that cannot be read give no reference (fail closed): learning goes on without them, as with no
 * catalogue (R1).
 */
export type ReferenceSource = { collections: false; catalogue: readonly ReferenceCompetency[] | null } | { collections: true; catalogue: readonly ReferenceCompetency[] };

export async function referenceSource(admin: any, policy: Pick<IndividualPolicy, "scholarReferenceCollections" | "scholarCatalogueMinStatus">, programme: CatalogueCompetency[] | null): Promise<ReferenceSource> {
  if (!policy.scholarReferenceCollections.length) return { collections: false, catalogue: programme };
  return { collections: true, catalogue: (await referenceCollections(admin, policy.scholarReferenceCollections, policy.scholarCatalogueMinStatus)) ?? [] };
}

/**
 * Pure. THE ONE RULE for a reference's review label (Stage 3 acceptance, items 3 and 5): "Clinically approved" only
 * where 395 approved the competency's CURRENT content (S1 reads that, by content hash) and the outcome shown is part
 * of that content. A competency the source does not hold, or an outcome its content no longer holds, is never approved.
 */
export function referenceStatus(c: ReferenceCompetency | undefined, outcome: string | null): { status: string; approved: boolean } {
  if (!c) return { status: CONTENT_STATUS_LABEL.unreviewed, approved: false };
  if (outcome !== null && !c.outcomes.includes(outcome)) return { status: REFERENCE_CHANGED_LABEL, approved: false };
  return { status: CONTENT_STATUS_LABEL[c.contentStatus] ?? CONTENT_STATUS_LABEL.unreviewed, approved: c.contentStatus === "approved" };
}

/**
 * The governed references for some sections: the competencies they are linked to (accepted first) with the outcome
 * named where one was, from the reference source, labelled by referenceStatus. With listed collections, only their
 * competencies are references. An outcome the competency's current content no longer holds is not given. [] when
 * there is nothing to give: learning goes on without them.
 */
export async function governedReferences(admin: any, userId: string, chunkIds: readonly string[], source: ReferenceSource, limit = 4): Promise<GovernedReference[]> {
  const links = await sectionLinks(admin, userId, chunkIds);
  if (!links.length) return [];
  const known = new Map((source.catalogue ?? []).map(c => [c.id, c]));
  const ordered = [...links].sort((a, b) => Number(b.accepted) - Number(a.accepted)).filter(l => !source.collections || known.has(l.competencyId));
  const unique = [...new Map(ordered.map(l => [l.competencyId, l])).values()].slice(0, limit);
  // Names for links the source does not hold (a programme changed since): the person's record, never approved.
  const missing = unique.map(l => l.competencyId).filter(id => !known.has(id));
  const names = missing.length ? await competencyLabels(admin, null, missing, new Map()) : new Map();
  return unique.map(l => {
    const c = known.get(l.competencyId);
    const outcome = c && l.outcome !== null && !c.outcomes.includes(l.outcome) ? null : l.outcome;
    return { competencyId: l.competencyId, title: c?.title ?? names.get(l.competencyId)?.title ?? "A competency", code: c?.code ?? names.get(l.competencyId)?.code ?? null, outcome, ...referenceStatus(c, outcome) };
  });
}

/**
 * Pure. A saved answer's references, labelled again by the source as it is NOW: a review label is never carried
 * from the day the answer was saved (approval is lost the moment the content changes, 395).
 */
export function relabelReferences(refs: readonly unknown[], source: ReferenceSource): (GovernedReference & { tag?: string })[] {
  const known = new Map((source.catalogue ?? []).map(c => [c.id, c]));
  return refs.flatMap(raw => {
    const r = raw as Partial<GovernedReference> & { tag?: string; kind?: string } | null;
    // COMPETEN-RESEARCH-01: an external research reference is not a governed one (learn-research.ts shows it).
    if (!r || typeof r.title !== "string" || r.kind === "external") return [];
    const outcome = typeof r.outcome === "string" ? r.outcome : null;
    const c = typeof r.competencyId === "string" ? known.get(r.competencyId) : undefined;
    return [{ ...(r.tag ? { tag: r.tag } : {}), competencyId: r.competencyId, title: r.title, code: typeof r.code === "string" ? r.code : null, outcome, ...(r.library ? { library: true } : {}), ...referenceStatus(c, outcome) }];
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
export function artefactKey(input: { action: string; depth: string; chunkIds: readonly string[]; promptVersion: string; references: readonly GovernedReference[]; background: boolean; mode?: string }): string {
  const refs = input.references.map(r => `${r.competencyId ?? r.title}|${r.outcome ?? ""}`).sort().join(";");
  // COMPETEN-RESEARCH-01: a library or research answer has its own key; a notes-only key is exactly as before.
  const basis = [input.action, input.depth, [...input.chunkIds].sort().join(","), input.promptVersion, refs, input.background ? "bg" : "nobg", ...(input.mode && input.mode !== "notes" ? [`mode:${input.mode}`] : [])].join("\n");
  return createHash("sha256").update(basis).digest("hex");
}

/**
 * COMPETEN-RESEARCH-01, "My notes + approved Competen library": the reference source's APPROVED entries (the governed
 * CFCA library HQ offers, clinically approved as they stand) that match the topic, labelled as library and by
 * referenceStatus. They ground only their own words, like every governed reference. Ones already given are not repeated.
 */
export function libraryReferences(text: string, source: ReferenceSource, have: readonly GovernedReference[], limit = 3): GovernedReference[] {
  const catalogue = source.catalogue ?? [];
  const known = new Map(catalogue.map(c => [c.id, c]));
  const entries = catalogue.map(c => ({ id: c.id, code: c.code ?? null, title: c.title, outcomes: [...(c.outcomes ?? [])], contentStatus: c.contentStatus ?? "unreviewed" }));
  // Owner (pilot, 28 Oct): the library mode offers APPROVED content only -- clinically approved as it stands (395).
  return matchLibrary(text, entries.filter(e => e.contentStatus === "approved"), limit + have.length)
    .filter(m => !have.some(h => h.competencyId === m.id))
    .map(m => ({ competencyId: m.id, title: m.title, code: m.code, outcome: m.outcome, library: true, ...referenceStatus(known.get(m.id), m.outcome) }))
    .filter(r => r.approved)
    .slice(0, limit);
}
