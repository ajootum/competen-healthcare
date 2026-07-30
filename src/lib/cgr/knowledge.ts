/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-012 — Competency Governance Knowledge Repository & Evidence Intelligence.
// "What evidence supports this competency, how reliable is it, and when should it be reviewed?" The GOVERNANCE
// lens on evidence (distinct from the CKP knowledge browser and CAPA's assessment-evidence integrity):
//   • knowledge_objects (mig 025) — the knowledge/evidence inventory (typed: evidence / clinical_reasoning /
//     procedure / …), with evidence_level + source_ref (traceability §4.2) + cpu_id.
//   • Evidence-to-competency COVERAGE (§8) — the genuinely-new governance metric: knowledge_objects link to CPUs
//     (cpu_id) and framework_competencies link to CPUs (cpu_id), so a competency is "evidence-linked" when its
//     CPU carries ≥1 knowledge object. Surfaces the evidence-linkage gap (§4.1 "evidence before decision").
//   • knowledge_edges (mig 012) — the governed knowledge graph (supports / references / validates / assesses …).
// Repository authoring + the knowledge browser stay owned by CKP; assessment-evidence integrity by CAPA. No migration.

type Admin = any;

const typeLabel = (t: string) => (t || "other").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export async function loadKnowledgeEvidence(admin: Admin) {
  const [koRes, fcRes, cpuRes, keRes] = await Promise.all([
    admin.from("knowledge_objects").select("id, title, knowledge_type, cpu_id, evidence_level, source_ref").limit(5000),
    admin.from("framework_competencies").select("id, cpu_id").limit(6000),
    admin.from("clinical_practice_units").select("id, name").limit(3000),
    admin.from("knowledge_edges").select("relationship").limit(5000),
  ]);

  const kos = (koRes.error ? [] : koRes.data ?? []) as any[];
  const fcs = (fcRes.error ? [] : fcRes.data ?? []) as any[];
  const cpuName = new Map<string, string>((cpuRes.error ? [] : cpuRes.data ?? []).map((c: any) => [c.id, c.name]));
  const kes = (keRes.error ? [] : keRes.data ?? []) as any[];

  const byType = new Map<string, number>();
  const koByCpu = new Map<string, number>();
  let withSource = 0, withLevel = 0, evidenceObjs = 0;
  for (const k of kos) {
    const t = k.knowledge_type || "other";
    byType.set(t, (byType.get(t) ?? 0) + 1);
    if (k.cpu_id) koByCpu.set(k.cpu_id, (koByCpu.get(k.cpu_id) ?? 0) + 1);
    if (k.source_ref) withSource++;
    if (k.evidence_level) withLevel++;
    if (t === "evidence") evidenceObjs++;
  }
  const inventory = [...byType.entries()].map(([type, count]) => ({ type, label: typeLabel(type), count })).sort((a, b) => b.count - a.count);

  const cpusWithKo = new Set(koByCpu.keys());
  const compsWithCpu = fcs.filter((c) => c.cpu_id);
  const linkedComps = compsWithCpu.filter((c) => cpusWithKo.has(c.cpu_id)).length;

  const topCpus = [...koByCpu.entries()]
    .map(([id, count]) => ({ name: cpuName.get(id) ?? "—", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const byRel = new Map<string, number>();
  for (const e of kes) byRel.set(e.relationship || "references", (byRel.get(e.relationship || "references") ?? 0) + 1);
  const relationships = [...byRel.entries()].map(([rel, count]) => ({ rel, count })).sort((a, b) => b.count - a.count);

  return {
    provisioned: kos.length > 0 || kes.length > 0,
    kpis: {
      objects: kos.length,
      evidenceObjs,
      totalComps: fcs.length,
      groupedComps: compsWithCpu.length,
      linkedComps,
      coveragePct: fcs.length ? Math.round((linkedComps / fcs.length) * 100) : 0,
      coverageOfGrouped: compsWithCpu.length ? Math.round((linkedComps / compsWithCpu.length) * 100) : 0,
      edges: kes.length,
      sourcePct: kos.length ? Math.round((withSource / kos.length) * 100) : 0,
      levelPct: kos.length ? Math.round((withLevel / kos.length) * 100) : 0,
    },
    inventory,
    topCpus,
    relationships,
  };
}
