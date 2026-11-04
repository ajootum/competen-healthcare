// ── SQIE-CLOSE-2026-11 WS-D: WHICH FRAMEWORK VERSION A PRACTISED COMPETENCY BELONGED TO (migration 990) ────────────────────
//
// Server only. A question practises a framework_competencies row (388 competency_id). Those rows are edited in place (751), so
// an id alone does not say what the competency said when an attempt was marked. This read answers it, for the snapshot: the
// framework (id, code) the competency sits in, that framework's version as major.minor.revision, and the competency content
// hash (395/761 competency_content_hashes, the hash clinical review and assessment items already pin).
//
// The same read as the assessment adapter (src/lib/assessment/adapters/scholar/criteria.ts version3), made from the framework
// tables, never an individual_scholar_* table. FAIL CLOSED: any read that fails gives null (nothing recorded, the snapshot is kept
// without it); a hash the RPC cannot give is null in its entry, never invented.
//
// ⚠ FORMATIVE. A framework version on a practice attempt says what the question practised. It never stages, meets or verifies a
// competency (directive s7; question-score-stage.test.ts pins that no question score reaches a stage).

import type { CompetencyProvenance } from "./attempt-snapshot";
import type { Admin } from "./store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Pure. A framework row's version, as the assessment adapter writes it. */
export const frameworkVersionOf = (f: { version_major?: unknown; version_minor?: unknown; version_revision?: unknown }): string =>
  `${Number(f.version_major ?? 0) || 0}.${Number(f.version_minor ?? 0) || 0}.${Number(f.version_revision ?? 0) || 0}`;

/** The provenance of these competencies (at most 20), or null where the framework tables could not be read. */
export async function competencyProvenance(admin: Admin, competencyIds: readonly string[]): Promise<CompetencyProvenance[] | null> {
  const ids = [...new Set(competencyIds)].filter(id => UUID.test(id)).slice(0, 20);
  if (!ids.length) return null;
  try {
    const { data: comps, error } = await admin.from("framework_competencies").select("id, domain_id").in("id", ids);
    if (error || !comps?.length) return null;
    const domIds = [...new Set((comps as { domain_id: string }[]).map(c => c.domain_id).filter(Boolean))];
    const { data: doms, error: dErr } = domIds.length ? await admin.from("framework_domains").select("id, framework_id").in("id", domIds) : { data: [], error: null };
    if (dErr) return null;
    const fwIds = [...new Set(((doms ?? []) as { framework_id: string }[]).map(d => d.framework_id).filter(Boolean))];
    const { data: fws, error: fErr } = fwIds.length ? await admin.from("frameworks").select("id, code, version_major, version_minor, version_revision").in("id", fwIds) : { data: [], error: null };
    if (fErr) return null;
    const hashes = await admin.rpc("competency_content_hashes", { p_ids: ids }).then((r: { data?: unknown; error?: unknown }) => (r.error ? [] : r.data ?? []), () => []);
    const hashOf = new Map(((hashes ?? []) as { competency_id: string; content_hash: string }[]).map(h => [h.competency_id, h.content_hash]));
    const domain = new Map(((doms ?? []) as { id: string; framework_id: string }[]).map(d => [d.id, d.framework_id]));
    const framework = new Map(((fws ?? []) as { id: string; code?: string | null }[]).map(f => [f.id, f]));
    return (comps as { id: string; domain_id: string }[]).map(c => {
      const fwId = domain.get(c.domain_id) ?? null;
      const fw = fwId ? (framework.get(fwId) as Record<string, unknown> | undefined) : undefined;
      return {
        competencyId: c.id, frameworkId: fwId, frameworkCode: typeof fw?.code === "string" ? fw.code : null,
        frameworkVersion: fw ? frameworkVersionOf(fw) : null, contentHash: typeof hashOf.get(c.id) === "string" ? hashOf.get(c.id)! : null,
      };
    });
  } catch { return null; }
}
