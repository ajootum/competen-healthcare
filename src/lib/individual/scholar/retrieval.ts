// ── RETRIEVAL OVER THE PERSON'S OWN CHUNKS ── COMPETEN-IND-004 s2, COMPETEN-IND-002 s3.2(3) ─────────────
//
// Postgres full-text search on individual_scholar_chunk.tsv (a generated tsvector, migration 372), so no
// embedding key is needed. The store filters by user_id FIRST and then by the query, so the candidate set
// is only ever the person's own chunks. This file is the pure half: turning a question into a tsquery,
// and ranking the candidates the database returned.
//
// ⚠ OR, NOT AND. A question like "explain the pathophysiology of heart failure" ANDed term by term would
// need a chunk containing "explain", which a set of lecture notes almost never does. Terms are ORed and
// the ranking below rewards chunks that match more of them.

const STOPWORDS = new Set((
  "a about above after again against all am an and any are as at be because been before being below between both but by " +
  "can could did do does doing down during each explain explanation few for from further had has have having he her here " +
  "hers how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our " +
  "out over own please same she should so some such tell than that the their them then there these they this those " +
  "through to too under until up very was we were what when where which while who whom why will with would you your " +
  "describe define summarise summarize mean means meaning give list")
  .split(" "));

/** Lower-case terms worth searching for. Letters and digits only, so nothing reaches to_tsquery unescaped. */
export function searchTerms(question: string): string[] {
  const words = question.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3 && !/^\d+$/.test(w)) continue;
    if (STOPWORDS.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= 12) break;
  }
  return out;
}

/** The to_tsquery text: terms ORed. Null when nothing is left to search for. */
export function toTsQuery(question: string): string | null {
  const terms = searchTerms(question);
  return terms.length ? terms.join(" | ") : null;
}

export type CandidateChunk = {
  id: string;
  materialId: string;
  ordinal: number;
  pageFrom: number | null;
  pageTo: number | null;
  content: string;
};

/**
 * Pure. UPLOAD-01 U4: across several materials, the best passages SPREAD over the materials that matched --
 * the best passage of each material first, in rank order, then the rest -- so a question asked of the whole
 * library (or of chosen documents) is answered from each relevant document, not five passages of one.
 * The input is already ranked; the output keeps rank order within each round.
 */
export function spreadAcrossMaterials<T extends { materialId: string }>(ranked: readonly T[], limit: number): T[] {
  const byMaterial = new Map<string, T[]>();
  for (const c of ranked) byMaterial.set(c.materialId, [...(byMaterial.get(c.materialId) ?? []), c]);
  const out: T[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const list of byMaterial.values()) {
      if (round < list.length && out.length < limit) { out.push(list[round]); added = true; }
    }
    if (!added) break;
  }
  return out;
}

/**
 * Pure. Ranks the database's candidates by how many distinct query terms each contains (by prefix, so a
 * stemmed "infarct" still finds "infarction"), then by how often, then by document order. Returns the
 * top `limit`. A chunk matching no term at all is dropped.
 */
export function rankChunks<T extends CandidateChunk>(question: string, candidates: T[], limit: number): T[] {
  const terms = searchTerms(question).map(t => (t.length > 5 ? t.slice(0, 5) : t));
  if (!terms.length) return [];
  const scored = candidates.map(c => {
    const words = c.content.toLowerCase().split(/[^a-z0-9]+/);
    let distinct = 0, hits = 0;
    for (const t of terms) {
      const n = words.filter(w => w.startsWith(t)).length;
      if (n) { distinct++; hits += n; }
    }
    return { c, distinct, hits };
  }).filter(s => s.distinct > 0);
  scored.sort((a, b) => b.distinct - a.distinct || b.hits - a.hits || a.c.ordinal - b.c.ordinal);
  return scored.slice(0, limit).map(s => s.c);
}
