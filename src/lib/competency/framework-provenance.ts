/* eslint-disable @typescript-eslint/no-explicit-any */

// ── FRAMEWORK PROVENANCE OF A COMPETENCY ── SQIE-CLOSE-2026-11 WS-D (migrations 990, 991) ────────────────────────────────
//
// What a competency said, and in which framework version, at one moment: its competency_content_hash (395, 761), the framework it
// sits in, that framework's version (012 major.minor.revision) and its publication status (127 pub_status). A practice record
// (the Scholar attempt snapshot) keeps these so an old answer still names the framework version it was mapped to after the
// framework moves on (framework_competencies rows are edited in place, 751).
//
// It lives in the competency layer, not in Scholar: Scholar reads competencies only through the catalogue interface
// (scripts/scholar-learning-harness.ts K2), and this is not an offer of competencies but the provenance of one a question was
// already mapped to. Reads only. Never throws: what cannot be read is left out of the maps, so the caller records null.
//
// ⚠ A publication status says whether the framework version was published. It is never competence, a stage or verification.

export type FrameworkProvenanceRead = {
  hashes: Map<string, string>;
  frameworkOf: Map<string, string>;
  versionOf: Map<string, { major: unknown; minor: unknown; revision: unknown }>;
  /** framework id -> published, or draft (any other pub_status: publication pending). */
  statusOf: Map<string, "published" | "draft">;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The provenance of these competencies (at most 20), as maps. Every unreadable part is simply absent. */
export async function readFrameworkProvenance(admin: any, competencyIds: readonly string[]): Promise<FrameworkProvenanceRead> {
  const out: FrameworkProvenanceRead = { hashes: new Map(), frameworkOf: new Map(), versionOf: new Map(), statusOf: new Map() };
  const ids = [...new Set(competencyIds)].filter(isUuid).slice(0, 20);
  if (!ids.length) return out;
  try {
    const [h, c] = await Promise.all([
      admin.rpc("competency_content_hashes", { p_ids: ids }),
      admin.from("framework_competencies").select("id, domain_id").in("id", ids),
    ]);
    for (const r of (h.error ? [] : h.data ?? []) as any[]) if (typeof r?.competency_id === "string" && typeof r?.content_hash === "string") out.hashes.set(r.competency_id, r.content_hash);
    const domainOf = new Map<string, string>(((c.error ? [] : c.data ?? []) as any[]).filter(r => isUuid(r?.domain_id)).map(r => [String(r.id), String(r.domain_id)]));
    const domainIds = [...new Set(domainOf.values())];
    if (!domainIds.length) return out;
    const d = await admin.from("framework_domains").select("id, framework_id").in("id", domainIds);
    const fwOfDomain = new Map<string, string>(((d.error ? [] : d.data ?? []) as any[]).filter(r => isUuid(r?.framework_id)).map(r => [String(r.id), String(r.framework_id)]));
    for (const [comp, dom] of domainOf) { const fw = fwOfDomain.get(dom); if (fw) out.frameworkOf.set(comp, fw); }
    const fwIds = [...new Set(out.frameworkOf.values())];
    if (!fwIds.length) return out;
    const f = await admin.from("frameworks").select("id, version_major, version_minor, version_revision, pub_status").in("id", fwIds);
    for (const r of (f.error ? [] : f.data ?? []) as any[]) {
      out.versionOf.set(String(r.id), { major: r.version_major, minor: r.version_minor, revision: r.version_revision });
      if (typeof r.pub_status === "string") out.statusOf.set(String(r.id), r.pub_status === "published" ? "published" : "draft");
    }
  } catch { /* provenance is never worth a failed answer: what was not read stays absent */ }
  return out;
}
