/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-108 — Standards Mapping Centre. Loads competency ↔ external-standard mappings
// (competency_standard_mappings, migration 129) and computes regulatory traceability: how many
// competencies are mapped to a standard, distribution by standard body and coverage level, and the
// count still UNMAPPED (real from framework_competencies) — the gap to close. Standard bodies are a
// fixed catalogue (WHO/JCI/SafeCare/MOH/councils/…); the mapping reference is free text per body.

const NONE = "00000000-0000-0000-0000-000000000000";

export const STANDARD_BODIES = [
  { key: "who", label: "WHO Guidelines" },
  { key: "jci", label: "JCI Accreditation" },
  { key: "safecare", label: "SafeCare" },
  { key: "moh", label: "Ministry of Health" },
  { key: "nursing_council", label: "Nursing Council" },
  { key: "medical_council", label: "Medical Council" },
  { key: "iso", label: "ISO Healthcare" },
  { key: "professional_society", label: "Professional Society" },
  { key: "hospital_policy", label: "Hospital Policy" },
  { key: "other", label: "Other / Tenant-defined" },
];
const BODY_LABEL: Record<string, string> = Object.fromEntries(STANDARD_BODIES.map(b => [b.key, b.label]));
export const COVERAGE = [
  { key: "full", label: "Full", color: "#10b981" },
  { key: "partial", label: "Partial", color: "#f59e0b" },
  { key: "reference", label: "Reference", color: "#3b82f6" },
];
const COV_LABEL: Record<string, string> = Object.fromEntries(COVERAGE.map(c => [c.key, c.label]));
const COV_COLOR: Record<string, string> = Object.fromEntries(COVERAGE.map(c => [c.key, c.color]));

export type StdRow = { id: string; competency: string; ctx: string | null; body: string; bodyLabel: string; ref: string; title: string | null; coverage: string; coverageLabel: string; coverageColor: string; notes: string | null };

export async function loadStandardsMapping(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const res = await scope(admin.from("competency_standard_mappings").select("id, competency_id, standard_body, standard_ref, standard_title, coverage, notes, created_at").order("created_at", { ascending: false }).limit(8000));
  if (res.error) return { provisioned: false as const };
  const maps = (res.data ?? []) as any[];

  // Total competencies (denominator for the unmapped gap) — real from the framework tree.
  let totalCompetencies = 0;
  try { const t = await admin.from("framework_competencies").select("id", { count: "exact", head: true }); totalCompetencies = t.count ?? 0; } catch { totalCompetencies = 0; }

  const ids = [...new Set(maps.map(m => m.competency_id).filter(Boolean))] as string[];
  const nameById = new Map<string, { name: string; ctx: string | null }>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await admin.from("framework_competencies").select("id, name, framework_domains(name, frameworks(name))").in("id", ids.slice(i, i + 500));
    for (const c of (data ?? []) as any[]) nameById.set(c.id, { name: c.name, ctx: c.framework_domains?.frameworks?.name ?? c.framework_domains?.name ?? null });
  }

  const rows: StdRow[] = maps.map(m => ({
    id: m.id,
    competency: nameById.get(m.competency_id)?.name ?? "Competency",
    ctx: nameById.get(m.competency_id)?.ctx ?? null,
    body: m.standard_body, bodyLabel: BODY_LABEL[m.standard_body] ?? m.standard_body,
    ref: m.standard_ref, title: m.standard_title,
    coverage: m.coverage, coverageLabel: COV_LABEL[m.coverage] ?? m.coverage, coverageColor: COV_COLOR[m.coverage] ?? "#9ca3af",
    notes: m.notes,
  }));

  const competenciesMapped = new Set(maps.map(m => m.competency_id)).size;
  const bodyDist = STANDARD_BODIES.map(b => ({ key: b.key, label: b.label, n: maps.filter(m => m.standard_body === b.key).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  const coverageDist = COVERAGE.map(c => ({ key: c.key, label: c.label, color: c.color, n: maps.filter(m => m.coverage === c.key).length })).filter(x => x.n > 0);

  return {
    provisioned: true as const,
    empty: maps.length === 0,
    kpis: {
      total: maps.length,
      competenciesMapped,
      totalCompetencies,
      unmapped: Math.max(totalCompetencies - competenciesMapped, 0),
      coveragePct: totalCompetencies ? Math.round((competenciesMapped / totalCompetencies) * 100) : 0,
      bodies: bodyDist.length,
    },
    bodyDist, coverageDist, rows,
  };
}
