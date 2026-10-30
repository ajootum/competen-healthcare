/* eslint-disable @typescript-eslint/no-explicit-any */
// ── GOVERNED LIBRARY QUESTIONS, REUSED BEFORE ANY ARE WRITTEN ── SCHOLAR-SQIE-CLOSE-01 C (owner, 30 Oct 2026) ──────────
//
// The governed question library already exists: CKRI knowledge resources of kind revision_question (migration 442), each
// version educator-reviewed, clinically approved on its exact content (395 decisions, ckri_knowledge_approved) and
// published by hq.quality.knowledge.publish, with the CFCA competencies it teaches (ckri_knowledge_version_competency).
// Nothing here is a new repository: it is the read path Scholar Revision lacked.
//
// ⚠ PUBLISHED AND APPROVED ONLY. A version is offered only while it is the published version of an active
// revision_question resource AND ckri_knowledge_approved says its exact content is approved. A draft, a submitted, a
// superseded or a retired version is never read, and a learner copy of a version that stops being published is no
// longer offered (store.ts hydrate). Migration 710 makes any other copy unstorable (its guard trigger).
// ⚠ MATCHED TO THE SECTION. An item is offered for a section only when it teaches a competency the section is linked to
// with an ACCEPTED link, and -- where the section has topics -- names one of them. Library items record no programme
// level, so level is not matched (there is nothing recorded to match).
// ⚠ NO STUDENT CONTENT. Nothing here reads or writes anything of a student's into the library (442 makes that
// unrepresentable). The learner's copy is their own individual_scholar_question row, with its provenance.

export type LibraryQuestion = {
  versionId: string; resourceId: string; versionNo: number; title: string;
  stem: string; options: string[]; correctIndex: number; rationale: string;
  competencyIds: string[]; publishedAt: string | null;
};
/** A section of the student's notes, as the library is matched to it: its ACCEPTED competency links and its topics. */
export type LibrarySection = { chunkId: string; competencyIds: string[]; topics: string[] };
export type LibraryPick = { question: LibraryQuestion; chunkId: string; competencyId: string };

/** Pure. The 442 shape of a revision question (ckri_knowledge_content_ok), read defensively. null when it is not that. */
export function libraryContent(c: unknown): { stem: string; options: string[]; correctIndex: number; rationale: string } | null {
  const x = (c ?? {}) as Record<string, unknown>;
  const options = Array.isArray(x.options) && x.options.length === 4 && x.options.every(o => typeof o === "string" && o.trim()) ? (x.options as string[]) : null;
  const ci = x.correct_index;
  if (typeof x.stem !== "string" || !x.stem.trim() || !options || typeof ci !== "number" || !Number.isInteger(ci) || ci < 0 || ci > 3
    || typeof x.rationale !== "string" || !x.rationale.trim()) return null;
  return { stem: x.stem, options, correctIndex: ci, rationale: x.rationale };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Pure. Whether a topic is named by a text: the phrase itself, or every word of four letters or more in it. */
export function namesTopic(text: string, topic: string): boolean {
  const t = norm(topic), body = ` ${norm(text)} `;
  if (!t) return false;
  if (body.includes(` ${t} `)) return true;
  const words = t.split(" ").filter(w => w.length >= 4);
  return words.length > 0 && words.every(w => body.includes(` ${w}`));
}

/**
 * Pure. The library questions a session offers, before any are written: for each section in turn, the items teaching one
 * of its accepted competencies (and naming one of its topics, where it has topics), the most topics named first, then
 * the most recently published. One item at most per resource, none already held (`exclude`, version ids), at most `limit`.
 */
export function pickLibraryQuestions(input: { questions: readonly LibraryQuestion[]; sections: readonly LibrarySection[]; exclude: ReadonlySet<string>; limit: number }): LibraryPick[] {
  if (input.limit <= 0) return [];
  const lanes = input.sections.map(s => {
    const hits = (q: LibraryQuestion) => s.topics.filter(t => namesTopic(`${q.title}\n${q.stem}`, t)).length;
    return input.questions
      .filter(q => !input.exclude.has(q.versionId) && q.competencyIds.some(c => s.competencyIds.includes(c)) && (!s.topics.length || hits(q) > 0))
      .map(q => ({ q, hits: hits(q), competencyId: q.competencyIds.find(c => s.competencyIds.includes(c))! }))
      .sort((a, b) => b.hits - a.hits || (b.q.publishedAt ?? "").localeCompare(a.q.publishedAt ?? "") || a.q.versionId.localeCompare(b.q.versionId))
      .map(x => ({ question: x.q, chunkId: s.chunkId, competencyId: x.competencyId }));
  });
  const out: LibraryPick[] = [];
  const resources = new Set<string>();
  for (let i = 0; out.length < input.limit && lanes.some(l => i < l.length); i++)
    for (const l of lanes) {
      const p = l[i];
      if (!p || resources.has(p.question.resourceId) || out.length >= input.limit) continue;
      resources.add(p.question.resourceId); out.push(p);
    }
  return out;
}

/**
 * The published, clinically approved library revision questions teaching any of these competencies. [] when there are
 * none, and when anything cannot be read (442 absent, an error): the session is then made without them, as before.
 */
export async function loadLibraryQuestions(admin: any, competencyIds: readonly string[]): Promise<LibraryQuestion[]> {
  const ids = [...new Set(competencyIds)].slice(0, 100);
  if (!ids.length) return [];
  try {
    const links = await admin.from("ckri_knowledge_version_competency").select("version_id, competency_id").in("competency_id", ids).limit(2000);
    if (links.error || !links.data?.length) return [];
    const byVersion = new Map<string, string[]>();
    for (const l of links.data as any[]) byVersion.set(l.version_id, [...(byVersion.get(l.version_id) ?? []), l.competency_id]);
    const versions = await admin.from("ckri_knowledge_version").select("id, resource_id, version_no, content, state, published_at")
      .in("id", [...byVersion.keys()].slice(0, 500)).eq("state", "published");
    if (versions.error || !versions.data?.length) return [];
    const resources = await admin.from("ckri_knowledge_resource").select("id, kind, title, status")
      .in("id", [...new Set((versions.data as any[]).map(v => v.resource_id))]).eq("kind", "revision_question").eq("status", "active");
    if (resources.error) return [];
    const resource = new Map(((resources.data ?? []) as any[]).map(r => [r.id, r]));
    const candidates = (versions.data as any[]).filter(v => resource.has(v.resource_id) && libraryContent(v.content)).slice(0, 50);
    const approved = await approvedVersions(admin, candidates.map(v => v.id));
    return candidates.filter(v => approved.has(v.id)).map(v => {
      const c = libraryContent(v.content)!;
      return {
        versionId: v.id, resourceId: v.resource_id, versionNo: v.version_no, title: String(resource.get(v.resource_id)!.title ?? ""),
        ...c, competencyIds: byVersion.get(v.id) ?? [], publishedAt: v.published_at ?? null,
      };
    });
  } catch {
    return [];
  }
}

/** The versions ckri_knowledge_approved says are clinically approved on their exact content. Unreadable: none. */
async function approvedVersions(admin: any, versionIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all(versionIds.map(async id => {
    const r = await admin.rpc("ckri_knowledge_approved", { p_version: id });
    if (!r.error && r.data === true) out.add(id);
  }));
  return out;
}

/**
 * Of these library versions, the ones that may still be offered: published, of an active revision_question resource,
 * and clinically approved. A copy of any other is no longer offered. Unreadable: none (fail closed).
 */
export async function servableLibraryVersions(admin: any, versionIds: readonly string[]): Promise<Map<string, { versionNo: number }>> {
  const ids = [...new Set(versionIds)];
  if (!ids.length) return new Map();
  try {
    const v = await admin.from("ckri_knowledge_version").select("id, resource_id, version_no, state").in("id", ids).eq("state", "published");
    if (v.error || !v.data?.length) return new Map();
    const r = await admin.from("ckri_knowledge_resource").select("id").in("id", [...new Set((v.data as any[]).map(x => x.resource_id))])
      .eq("kind", "revision_question").eq("status", "active");
    if (r.error) return new Map();
    const active = new Set(((r.data ?? []) as any[]).map(x => x.id));
    const live = (v.data as any[]).filter(x => active.has(x.resource_id));
    const approved = await approvedVersions(admin, live.map(x => x.id));
    return new Map(live.filter(x => approved.has(x.id)).map(x => [x.id, { versionNo: x.version_no }]));
  } catch {
    return new Map();
  }
}
