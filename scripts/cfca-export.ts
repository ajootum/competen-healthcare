/* eslint-disable @typescript-eslint/no-explicit-any */
// The CFCA export contract, pure: what supabase/reference/cfca-export.sql produces, what the staging mirror
// (scripts/seed-staging-cfca.ts) accepts, and nothing else. Imported by the static harness, so it reads no
// environment and connects to nothing.

/** Export section -> table, and the ONLY keys a row may carry (cfca-export.sql names exactly these). */
export const SECTIONS = [
  { key: "frameworks", table: "frameworks", cols: ["id", "name", "code", "library", "description", "is_active", "sort_order", "pub_status", "parent_framework_id"] },
  { key: "domains", table: "framework_domains", cols: ["id", "framework_id", "name", "sort_order"] },
  { key: "practices", table: "practices", cols: ["id", "domain_id", "name", "description", "code", "sort_order"] },
  { key: "cpus", table: "clinical_practice_units", cols: ["id", "practice_id", "name", "description", "code", "risk_category", "complexity", "reassessment_months", "pub_status", "version_num", "sort_order"] },
  { key: "blueprints", table: "assessment_blueprints", cols: ["id", "cpu_id", "min_score", "min_assessors", "consensus_rule", "reassessment_months"] },
  { key: "blueprint_methods", table: "blueprint_methods", cols: ["id", "blueprint_id", "method", "weight", "is_required", "min_evidence"] },
  { key: "evidence_matrix", table: "evidence_matrix", cols: ["id", "cpu_id", "evidence_type", "min_quantity", "weight", "validity_months", "is_critical", "min_assessors"] },
  { key: "critical_failure_rules", table: "critical_failure_rules", cols: ["id", "cpu_id", "description"] },
  { key: "competencies", table: "framework_competencies", cols: ["id", "domain_id", "name", "description", "code", "sort_order", "practice_id", "cpu_id", "risk_category"] },
] as const;
export const DOC_KEYS = new Set(["format", "exported_at", "hospital_owned_practices", ...SECTIONS.map(s => s.key)]);

/** Pure: the export's problems, before anything is written. Empty = safe to mirror. */
export function checkExport(doc: any): string[] {
  const bad: string[] = [];
  if (doc?.format !== "competen-cfca-export-v1") bad.push(`format is ${doc?.format}, not competen-cfca-export-v1`);
  for (const k of Object.keys(doc ?? {})) if (!DOC_KEYS.has(k)) bad.push(`unexpected section ${k}`);
  const ids = new Map<string, Set<string>>();
  for (const s of SECTIONS) {
    const rows = doc?.[s.key];
    if (!Array.isArray(rows)) { bad.push(`${s.key} is not a list`); continue; }
    ids.set(s.key, new Set(rows.map((r: any) => r.id)));
    for (const r of rows) {
      for (const k of Object.keys(r)) if (!(s.cols as readonly string[]).includes(k)) bad.push(`${s.key} row ${r.id} carries ${k}, which is not exportable`);
      if (typeof r.id !== "string" || !/^[0-9a-f-]{36}$/i.test(r.id)) bad.push(`${s.key} row without a uuid id`);
    }
  }
  // Every parent a row names must travel with it (a CPU or practice link on a competency may be dropped, below).
  const need = (sec: string, col: string, parent: string) => {
    for (const r of doc?.[sec] ?? []) if (r[col] && !ids.get(parent)?.has(r[col])) bad.push(`${sec} ${r.id}: ${col} ${r[col]} is not in the export`);
  };
  need("domains", "framework_id", "frameworks"); need("practices", "domain_id", "domains"); need("cpus", "practice_id", "practices");
  need("blueprints", "cpu_id", "cpus"); need("blueprint_methods", "blueprint_id", "blueprints"); need("evidence_matrix", "cpu_id", "cpus");
  need("critical_failure_rules", "cpu_id", "cpus"); need("competencies", "domain_id", "domains");
  return bad;
}

/** Pure: rows as written. A link to a practice, CPU or parent framework that is neither in the export nor (for a parent) already on the target is cleared and reported. */
export function rowsFor(doc: any, sectionKey: string, targetFrameworkIds: ReadonlySet<string> = new Set()): { rows: any[]; cleared: string[] } {
  const s = SECTIONS.find(x => x.key === sectionKey)!;
  const practices = new Set((doc.practices ?? []).map((r: any) => r.id)), cpus = new Set((doc.cpus ?? []).map((r: any) => r.id));
  const frameworks = new Set([...(doc.frameworks ?? []).map((r: any) => r.id), ...targetFrameworkIds]);
  const cleared: string[] = [];
  const rows = (doc[sectionKey] as any[]).map(r => {
    const o: any = Object.fromEntries(s.cols.map(c => [c, r[c] ?? null]));
    if (sectionKey === "competencies") {
      if (o.practice_id && !practices.has(o.practice_id)) { cleared.push(`${o.id} practice_id`); o.practice_id = null; }
      if (o.cpu_id && !cpus.has(o.cpu_id)) { cleared.push(`${o.id} cpu_id`); o.cpu_id = null; }
    }
    if (sectionKey === "frameworks" && o.parent_framework_id && !frameworks.has(o.parent_framework_id)) { cleared.push(`${o.id} parent_framework_id`); o.parent_framework_id = null; }
    if (sectionKey === "frameworks") o.hospital_id = null;
    return o;
  });
  return { rows, cleared };
}

