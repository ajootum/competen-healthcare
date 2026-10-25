/* eslint-disable @typescript-eslint/no-explicit-any */

// ── THE LEARNING BLUEPRINT ── learning-blueprint/1 ── COMPETEN-LEARNING-01 S1-S2, migration 460 ─────────────────────
//
// The content of one version of one offering, as ONE JSON document stored in learning_offering_version.content. The
// database hashes it, reads its filter columns from it, and freezes it from submission (460). The approval a clinician
// gives is to this document's exact hash (461). Everything here is PURE: no I/O, no clock, no AI.
//
// Programme -> Course -> Module or Session -> Activity -> Outcome (product definition s5). A short activity is a
// one-module course: nothing requires a programme. A programme lists the offerings it contains.
//
// ⚠ THE KEY NEVER REACHES A LEARNER. Knowledge-check answers live in this document because the reviewer approves them
// with the content. learnerView() strips every key and rationale before anything is sent to a browser, and scoring
// happens on the server against the stored version (scoreCheck).
//
// ⚠ NO COMPLETION CLAIMS MORE THAN WAS RECORDED. A completion is course_completion or assessed_knowledge, computed
// here from the version's own rule. Neither is verification of competence, accreditation or CPD approval.

export const BLUEPRINT_SCHEMA = "learning-blueprint/1";

export const RELATIONS = ["introduces", "develops", "practises", "assesses", "supports_verification"] as const;
export type Relation = (typeof RELATIONS)[number];
export const RELATION_LABEL: Record<Relation, string> = {
  introduces: "Introduces", develops: "Develops knowledge or skills", practises: "Provides practice", assesses: "Assesses an outcome",
  supports_verification: "Supports independent verification (does not verify)",
};

export const RIGHTS = ["educator_original", "competen_owned", "partner_supplied", "licensed", "open_licence", "public_domain"] as const;
export type Rights = (typeof RIGHTS)[number];
export const RIGHTS_LABEL: Record<Rights, string> = {
  educator_original: "Written by the educator for Competen", competen_owned: "Owned by Competen Holdings", partner_supplied: "Supplied by the partner under agreement",
  licensed: "Licensed for this use", open_licence: "Open licence (named below)", public_domain: "Public domain",
};

export type OutcomeRef = { competencyId: string; index: number; relation: Relation };
export type Objective = { id: string; text: string; outcomeRefs: OutcomeRef[] };
export type Block =
  | { type: "text"; text: string }
  | { type: "image"; mediaPath: string; alt: string }
  | { type: "pdf"; mediaPath: string; title: string }
  | { type: "video"; url: string; title: string };
export type Question = { id: string; prompt: string; options: { id: string; text: string }[]; correct: string[]; rationale: string };
export type Activity =
  | { id: string; kind: "lesson"; title: string; minutes: number; blocks: Block[] }
  | { id: string; kind: "check"; title: string; passMark: number; questions: Question[] }
  | { id: string; kind: "reflection"; title: string; prompt: string }
  | { id: string; kind: "case"; title: string; caseVersionId: string };
export type Module = { id: string; title: string; kind: "module" | "session"; activities: Activity[] };
export type Completion = { requiredActivityIds: string[]; assessedCheckIds: string[] };

export type Blueprint = {
  schema: typeof BLUEPRINT_SCHEMA;
  title: string;
  summary: string;
  level: string;
  format: string;
  language: string;
  durationMinutes: number | null;
  topics: string[];
  audience: { professionTermIds: string[]; specialtyTermIds: string[] };
  objectives: Objective[];
  modules: Module[];
  programme: { offerings: { offeringId: string; required: boolean }[] } | null;
  prerequisites: string[];
  completion: Completion;
  certificate: { offered: boolean };
  cpd: { hours: number | null; points: number | null; note: string };
  access: { model: "free" | "paid" | "external" };
  external: { url: string; providerNote: string; deliveryLocation: string; payment: "provider" | "none" | "competen"; certificateBy: "provider" | "none"; cpdInfo: string; reviewDueOn: string } | null;
  provenance: { kind: "educator" | "ai_draft"; rights: Rights; sources: { title: string; licence: string; url: string }[]; note: string | null };
};

const KEY = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTPS = /^https:\/\/[A-Za-z0-9.-]{3,253}(:[0-9]{1,5})?([/?#][^\s]*)?$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const ids = (v: unknown, max = 50): string[] => arr(v).filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, max);
const int = (v: unknown, lo: number, hi: number): number | null => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null; };
export const isHttps = (u: unknown): u is string => typeof u === "string" && u.length <= 1900 && HTTPS.test(u);

/** A new hosted course: one module, one lesson, one check. Everything is then the educator's to fill. */
export function hostedTemplate(title: string): Blueprint {
  return {
    schema: BLUEPRINT_SCHEMA, title, summary: "", level: "foundation", format: "self_paced", language: "en", durationMinutes: null, topics: [],
    audience: { professionTermIds: [], specialtyTermIds: [] },
    objectives: [{ id: "obj-1", text: "", outcomeRefs: [] }],
    modules: [{ id: "m1", title: "Module 1", kind: "module", activities: [
      { id: "l1", kind: "lesson", title: "Lesson 1", minutes: 10, blocks: [{ type: "text", text: "" }] },
      { id: "q1", kind: "check", title: "Knowledge check", passMark: 70, questions: [{ id: "q1-1", prompt: "", options: [{ id: "a", text: "" }, { id: "b", text: "" }], correct: ["a"], rationale: "" }] },
    ] }],
    programme: null, prerequisites: [],
    completion: { requiredActivityIds: ["l1", "q1"], assessedCheckIds: ["q1"] },
    certificate: { offered: true }, cpd: { hours: null, points: null, note: "" }, access: { model: "paid" }, external: null,
    provenance: { kind: "educator", rights: "educator_original", sources: [], note: null },
  };
}

/** A new external listing: a link, its provider and what the learner needs to know before leaving Competen. */
export function externalTemplate(title: string): Blueprint {
  return {
    ...hostedTemplate(title), modules: [], completion: { requiredActivityIds: [], assessedCheckIds: [] }, certificate: { offered: false }, access: { model: "external" },
    external: { url: "", providerNote: "", deliveryLocation: "Online", payment: "provider", certificateBy: "provider", cpdInfo: "", reviewDueOn: "" },
    provenance: { kind: "educator", rights: "competen_owned", sources: [], note: null },
  };
}

/** Pure: a writer's document, normalised to the shape (unknown keys dropped, lengths bounded). Problems are separate. */
export function normaliseBlueprint(c: any, delivery: "hosted" | "external"): Blueprint {
  const t = delivery === "hosted" ? hostedTemplate("") : externalTemplate("");
  const block = (b: any): Block | null => {
    if (b?.type === "text") return { type: "text", text: str(b.text, 20000) };
    if (b?.type === "image") return { type: "image", mediaPath: str(b.mediaPath, 300), alt: str(b.alt, 300) };
    if (b?.type === "pdf") return { type: "pdf", mediaPath: str(b.mediaPath, 300), title: str(b.title, 200) };
    if (b?.type === "video") return { type: "video", url: str(b.url, 1900), title: str(b.title, 200) };
    return null;
  };
  const activity = (a: any): Activity | null => {
    const id = str(a?.id, 41), title = str(a?.title, 200);
    if (a?.kind === "lesson") return { id, kind: "lesson", title, minutes: int(a.minutes, 1, 600) ?? 5, blocks: arr(a.blocks).map(block).filter((x): x is Block => !!x).slice(0, 60) };
    if (a?.kind === "check") return { id, kind: "check", title, passMark: int(a.passMark, 1, 100) ?? 70, questions: arr(a.questions).slice(0, 50).map((q: any) => ({
      id: str(q?.id, 41), prompt: str(q?.prompt, 2000), rationale: str(q?.rationale, 2000),
      options: arr(q?.options).slice(0, 8).map((o: any) => ({ id: str(o?.id, 41), text: str(o?.text, 500) })),
      correct: arr(q?.correct).filter((x: unknown) => typeof x === "string").map((x: string) => x.slice(0, 41)).slice(0, 8),
    })) };
    if (a?.kind === "reflection") return { id, kind: "reflection", title, prompt: str(a.prompt, 2000) };
    if (a?.kind === "case") return { id, kind: "case", title, caseVersionId: str(a.caseVersionId, 36) };
    return null;
  };
  const ext = c?.external;
  return {
    schema: BLUEPRINT_SCHEMA, title: str(c?.title, 200), summary: str(c?.summary, 4000), level: str(c?.level, 31) || t.level, format: str(c?.format, 31) || t.format,
    language: str(c?.language, 10) || "en", durationMinutes: int(c?.durationMinutes, 1, 100000),
    topics: arr(c?.topics).map((x: unknown) => str(x, 80)).filter(Boolean).slice(0, 30),
    audience: { professionTermIds: ids(c?.audience?.professionTermIds), specialtyTermIds: ids(c?.audience?.specialtyTermIds) },
    objectives: arr(c?.objectives).slice(0, 40).map((o: any) => ({ id: str(o?.id, 41), text: str(o?.text, 1000),
      outcomeRefs: arr(o?.outcomeRefs).slice(0, 20).filter((r: any) => typeof r?.competencyId === "string" && UUID.test(r.competencyId))
        .map((r: any) => ({ competencyId: r.competencyId, index: int(r.index, -1, 199) ?? -1, relation: (RELATIONS as readonly string[]).includes(r.relation) ? r.relation : "develops" })) })),
    modules: delivery === "external" ? [] : arr(c?.modules).slice(0, 40).map((m: any) => ({ id: str(m?.id, 41), title: str(m?.title, 200), kind: m?.kind === "session" ? "session" : "module",
      activities: arr(m?.activities).map(activity).filter((x): x is Activity => !!x).slice(0, 60) })),
    programme: c?.programme && Array.isArray(c.programme.offerings) ? { offerings: c.programme.offerings.slice(0, 40).filter((o: any) => typeof o?.offeringId === "string" && UUID.test(o.offeringId)).map((o: any) => ({ offeringId: o.offeringId, required: o.required !== false })) } : null,
    prerequisites: ids(c?.prerequisites, 20),
    completion: { requiredActivityIds: arr(c?.completion?.requiredActivityIds).map((x: unknown) => str(x, 41)).filter(Boolean).slice(0, 200),
      assessedCheckIds: arr(c?.completion?.assessedCheckIds).map((x: unknown) => str(x, 41)).filter(Boolean).slice(0, 50) },
    certificate: { offered: delivery === "hosted" && c?.certificate?.offered === true },
    cpd: { hours: c?.cpd?.hours == null || c?.cpd?.hours === "" ? null : (Number.isFinite(Number(c.cpd.hours)) && Number(c.cpd.hours) > 0 && Number(c.cpd.hours) <= 1000 ? Math.round(Number(c.cpd.hours) * 10) / 10 : null),
      points: int(c?.cpd?.points, 0, 1000), note: str(c?.cpd?.note, 500) },
    access: { model: delivery === "external" ? "external" : c?.access?.model === "free" ? "free" : "paid" },
    external: delivery === "external" ? {
      url: str(ext?.url, 1900), providerNote: str(ext?.providerNote, 2000), deliveryLocation: str(ext?.deliveryLocation, 200),
      payment: ext?.payment === "none" ? "none" : ext?.payment === "competen" ? "competen" : "provider", certificateBy: ext?.certificateBy === "none" ? "none" : "provider",
      cpdInfo: str(ext?.cpdInfo, 1000), reviewDueOn: /^\d{4}-\d{2}-\d{2}$/.test(ext?.reviewDueOn ?? "") ? ext.reviewDueOn : "",
    } : null,
    provenance: { kind: c?.provenance?.kind === "ai_draft" ? "ai_draft" : "educator", rights: (RIGHTS as readonly string[]).includes(c?.provenance?.rights) ? c.provenance.rights : t.provenance.rights,
      sources: arr(c?.provenance?.sources).slice(0, 20).map((s: any) => ({ title: str(s?.title, 300), licence: str(s?.licence, 200), url: str(s?.url, 1900) })),
      note: typeof c?.provenance?.note === "string" ? c.provenance.note.slice(0, 300) : null },
  };
}

export const allActivities = (b: Pick<Blueprint, "modules">): Activity[] => b.modules.flatMap(m => m.activities);

/**
 * Pure: what stops a version going forward, in words. Drafts may be incomplete: this is applied at submission.
 * `allowed` is the published Learning policy (formats, levels), so the vocabulary is configuration, not code.
 */
export function blueprintProblems(b: Blueprint, delivery: "hosted" | "external", allowed: { formats: readonly string[]; levels: readonly string[] }): string[] {
  const p: string[] = [];
  if (b.title.length < 2) p.push("Give it a title.");
  if (b.summary.length < 20) p.push("Write a summary a learner can decide from (at least a sentence).");
  if (!allowed.levels.includes(b.level)) p.push(`The level must be one the Learning policy lists (${allowed.levels.join(", ")}).`);
  if (!allowed.formats.includes(b.format)) p.push(`The format must be one the Learning policy lists (${allowed.formats.join(", ")}).`);
  if (!b.objectives.length || b.objectives.some(o => o.text.length < 5)) p.push("Every learning objective needs its text.");
  const keys = new Set<string>();
  const dupe = (k: string, what: string) => { if (!KEY.test(k)) p.push(`${what} "${k}" needs a short lowercase id.`); else if (keys.has(k)) p.push(`The id "${k}" is used twice.`); keys.add(k); };
  for (const o of b.objectives) dupe(o.id, "Objective");
  if (delivery === "hosted") {
    if (!b.objectives.some(o => o.outcomeRefs.length)) p.push("Map at least one objective to a CFCA competency (clinical review needs it).");
    if (!b.modules.length) p.push("Add at least one module or session.");
    for (const m of b.modules) {
      dupe(m.id, "Module");
      if (m.title.length < 2) p.push(`Module ${m.id} needs a title.`);
      if (!m.activities.length) p.push(`Module ${m.id} has no activity.`);
      for (const a of m.activities) {
        dupe(a.id, "Activity");
        if (a.title.length < 2) p.push(`Activity ${a.id} needs a title.`);
        if (a.kind === "lesson") {
          if (!a.blocks.length || a.blocks.every(x => x.type === "text" && x.text.length < 20)) p.push(`Lesson ${a.id} has no content yet.`);
          for (const x of a.blocks) {
            if (x.type === "video" && !isHttps(x.url)) p.push(`Lesson ${a.id}: a video is a secure (https) link.`);
            if ((x.type === "image" || x.type === "pdf") && !/^[a-z0-9-]{8,}\/[A-Za-z0-9._-]{1,200}$/.test(x.mediaPath)) p.push(`Lesson ${a.id}: upload the file in the studio.`);
            if (x.type === "image" && x.alt.length < 3) p.push(`Lesson ${a.id}: describe the image for learners who cannot see it.`);
          }
        }
        if (a.kind === "check") {
          if (!a.questions.length) p.push(`Check ${a.id} has no question.`);
          for (const q of a.questions) {
            if (!KEY.test(q.id)) p.push(`Check ${a.id}: a question needs a short lowercase id.`);
            if (q.prompt.length < 5) p.push(`Check ${a.id}, question ${q.id}: write the question.`);
            const optIds = q.options.map(o => o.id);
            if (q.options.length < 2 || q.options.some(o => !o.text) || new Set(optIds).size !== optIds.length) p.push(`Check ${a.id}, question ${q.id}: at least two distinct, written options.`);
            if (!q.correct.length || q.correct.some(c => !optIds.includes(c))) p.push(`Check ${a.id}, question ${q.id}: mark the correct option(s).`);
            if (q.rationale.length < 5) p.push(`Check ${a.id}, question ${q.id}: explain why the answer is correct.`);
          }
        }
        if (a.kind === "case" && !UUID.test(a.caseVersionId)) p.push(`Activity ${a.id}: choose a published library case.`);
      }
    }
    const known = new Set(allActivities(b).map(a => a.id));
    if (!b.completion.requiredActivityIds.length) p.push("Say which activities completion requires.");
    for (const id of b.completion.requiredActivityIds) if (!known.has(id)) p.push(`Completion names "${id}", which is not an activity.`);
    const checks = new Set(allActivities(b).filter(a => a.kind === "check").map(a => a.id));
    for (const id of b.completion.assessedCheckIds) if (!checks.has(id)) p.push(`Assessed knowledge names "${id}", which is not a knowledge check.`);
  } else {
    const e = b.external;
    if (!e || !isHttps(e.url)) p.push("An external listing needs its secure (https) link.");
    if (!e || e.providerNote.length < 10) p.push("Say what the learner will find at the provider and how to come back.");
    if (!e || !e.reviewDueOn) p.push("Set the date this listing is next reviewed for accuracy.");
  }
  if (b.provenance.rights === "open_licence" && !b.provenance.sources.some(s => s.licence.length >= 2)) p.push("Name the open licence of the material.");
  if (b.provenance.kind === "ai_draft") p.push("This content began as an AI draft. Mark it as checked by an educator (provenance) before it goes forward.");
  return p;
}

/** Pure: the CFCA rows 460 stores for a version (learning_offering_version_outcome), from its objectives. */
export function outcomeRows(b: Pick<Blueprint, "objectives">): { competency_id: string; outcome_index: number; relation: Relation; objective_key: string }[] {
  const seen = new Set<string>(); const rows: { competency_id: string; outcome_index: number; relation: Relation; objective_key: string }[] = [];
  for (const o of b.objectives) for (const r of o.outcomeRefs) {
    if (!KEY.test(o.id)) continue;
    const k = `${o.id}|${r.competencyId}|${r.index}|${r.relation}`;
    if (seen.has(k)) continue;
    seen.add(k); rows.push({ competency_id: r.competencyId, outcome_index: r.index, relation: r.relation, objective_key: o.id });
  }
  return rows;
}

/** Pure: the learner-facing content. Every key and rationale is removed: scoring is the server's (scoreCheck). */
export function learnerView(b: Blueprint): Blueprint {
  return {
    ...b,
    modules: b.modules.map(m => ({ ...m, activities: m.activities.map(a => a.kind === "check"
      ? { ...a, questions: a.questions.map(q => ({ id: q.id, prompt: q.prompt, options: q.options, correct: [], rationale: "" })) }
      : a) })),
  };
}

/** Pure: score one attempt at one check against the stored key. Each question is all-or-nothing. */
export function scoreCheck(a: Extract<Activity, { kind: "check" }>, answers: Record<string, unknown>): { score: number; max: number; passed: boolean; feedback: { id: string; correct: boolean; rationale: string; correctIds: string[] }[] } {
  const feedback = a.questions.map(q => {
    const given = arr(answers?.[q.id]).filter((x): x is string => typeof x === "string");
    const ok = given.length === q.correct.length && q.correct.every(c => given.includes(c));
    return { id: q.id, correct: ok, rationale: q.rationale, correctIds: q.correct };
  });
  const score = feedback.filter(f => f.correct).length, max = Math.max(1, a.questions.length);
  return { score, max, passed: score * 100 >= a.passMark * max, feedback };
}

export type ActivityState = { activity_key: string; kind: string; passed: boolean | null };

/**
 * Pure: is the record complete under its version's rule, and as what. Every required activity done (a required check
 * passed) is course_completion. If the rule names assessed checks and all of them are passed, it is assessed_knowledge.
 */
export function evaluateCompletion(b: Pick<Blueprint, "completion" | "modules">, done: readonly ActivityState[]): { complete: boolean; kind: "course_completion" | "assessed_knowledge" | null; required: number; satisfied: number } {
  const by = new Map(done.map(d => [d.activity_key, d]));
  const checks = new Set(allActivities(b).filter(a => a.kind === "check").map(a => a.id));
  const ok = (id: string) => { const d = by.get(id); return !!d && (!checks.has(id) || d.passed === true); };
  const required = b.completion.requiredActivityIds;
  const satisfied = required.filter(ok).length;
  const complete = required.length > 0 && satisfied === required.length;
  const assessed = b.completion.assessedCheckIds.length > 0 && b.completion.assessedCheckIds.every(ok);
  return { complete, kind: complete ? (assessed ? "assessed_knowledge" : "course_completion") : null, required: required.length, satisfied };
}

/** Pure: where to resume -- the first activity, in course order, not yet done (a check not yet passed). null = all done. */
export function resumePoint(b: Pick<Blueprint, "modules">, done: readonly ActivityState[]): string | null {
  const by = new Map(done.map(d => [d.activity_key, d]));
  for (const a of allActivities(b)) { const d = by.get(a.id); if (!d || (a.kind === "check" && d.passed !== true)) return a.id; }
  return null;
}

/** Pure: the CPD hours a completion may be counted as -- the version's own figure, or its lesson minutes. Never accreditation. */
export function cpdHours(b: Pick<Blueprint, "cpd" | "modules">): number | null {
  if (b.cpd.hours) return b.cpd.hours;
  const minutes = allActivities(b).reduce((s, a) => s + (a.kind === "lesson" ? a.minutes : 0), 0);
  return minutes > 0 ? Math.round((minutes / 60) * 10) / 10 : null;
}
