import { artefactIdsForChunks, artefactIdsForSession, artefactsByIds, chunksForCompetency, sessionStepSummaries } from "./store";
import { NO_SCOPE, type FilterScope, type ItemRef } from "./library-organise";
import type { LibraryQuery } from "./saved-library";

// ── SCHOLAR-CE-2026 CE-02: THE LIBRARY FILTERS, RESOLVED ON THE SERVER ── reads only, no AI ───────────────────────────────
//
// Turns the request's Material / Topic / Study session / Competency filters into sets of the CALLER'S OWN ids (every store read
// here is keyed on the caller's id), which library-organise.itemAllowed / chunkAllowed then apply to the search results, the
// sections and the notes. The query is expected to have gone through ownedQuery first, so a foreign id never reaches here; even
// if it did, every read below returns nothing for an id that is not the caller's, and the filter then passes nothing, never more.
// An unreadable set fails CLOSED (nothing passes), never open.

type Admin = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Topics = { chunkId: string; topics: string[] }[];

/** The sets for the active filters. `items` are the rows about to be filtered, so a lesson's or a session's material can be looked up. */
export async function resolveFilterScope(admin: Admin, userId: string, q: Pick<LibraryQuery, "material" | "topic" | "session" | "competency">, topicRows: Topics, items: readonly ItemRef[] = []): Promise<FilterScope> {
  if (!q.material && !q.topic && !q.session && !q.competency) return NO_SCOPE;
  const acc: { set: Set<string> | null } = { set: null };
  const narrow = (ids: Iterable<string>) => { const next = new Set(ids); acc.set = acc.set ? new Set([...acc.set].filter(x => next.has(x))) : next; };
  if (q.topic) { const want = q.topic.toLowerCase(); narrow(topicRows.filter(r => r.topics.some(t => t.toLowerCase() === want)).map(r => r.chunkId)); }
  if (q.competency) narrow(await chunksForCompetency(admin, userId, q.competency, { acceptedOnly: true }));
  const chunks = acc.set;
  const chunkArtefacts = chunks ? new Set(chunks.size ? (await artefactIdsForChunks(admin, userId, [...chunks])) ?? [] : []) : null;

  let sessionChunks: Set<string> | null = null, sessionArtefacts: Set<string> | null = null;
  const sessionMaterials = new Map<string, ReadonlySet<string>>();
  const wantSessions = [...new Set([...(q.session ? [q.session] : []), ...(q.material ? items.flatMap(i => (i.sessionId ? [i.sessionId] : [])) : [])])];
  const summaries = wantSessions.length ? await sessionStepSummaries(admin, userId, wantSessions.slice(0, 200)) : new Map<string, { steps: number; chunkIds: string[]; materialIds: string[] }>();
  for (const [id, s] of summaries) sessionMaterials.set(id, new Set(s.materialIds));
  if (q.session) {
    sessionChunks = new Set(summaries.get(q.session)?.chunkIds ?? []);
    sessionArtefacts = new Set((await artefactIdsForSession(admin, userId, q.session)) ?? []);
  }

  const artefactMaterial = new Map<string, string>();
  const artefactIds = q.material ? [...new Set(items.flatMap(i => (i.artefactId && !i.materialId ? [i.artefactId] : [])))] : [];
  if (artefactIds.length) {
    const r = await artefactsByIds(admin, userId, artefactIds);
    for (const a of r.ok ? r.data : []) artefactMaterial.set(a.id, a.materialId);
  }
  return { material: q.material, session: q.session, chunkSet: chunks, chunkArtefacts, sessionChunks, sessionArtefacts, artefactMaterial, sessionMaterials };
}
