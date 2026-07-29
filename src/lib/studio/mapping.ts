/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-104 — Competency Mapping Studio. A traceability view over the cross-object links that already
// exist: competency ↔ CPU, ↔ assessment method, ↔ evidence (via CPU), ↔ learning resource, ↔ skills.
// Renders per-dimension coverage (how many competencies are traced to each object type), a per-framework
// coverage heatmap, and the competencies with the thinnest traceability. Dimensions with no persistence
// yet (clinical role, job description, standards, objectives, career) are surfaced honestly as pending —
// standards mapping is CST-108. Everything shown is computed on read from real links; nothing fabricated.

const NONE = "00000000-0000-0000-0000-000000000000";

export type Dimension = { key: string; label: string; links: number; coverage: number; color: string; pending?: boolean };
export type FwMatrix = { id: string; name: string; competencies: number; cells: Record<string, number> };

const chunk = <T,>(a: T[], n = 900) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

export async function loadMappingStudio(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const fwRes = await scope(admin.from("frameworks").select("id, name, is_active").eq("is_active", true).limit(3000));
  if (fwRes.error) return { provisioned: false as const };
  const frameworks = (fwRes.data ?? []) as any[];
  if (!frameworks.length) return { provisioned: true as const, empty: true, total: 0, dimensions: [], matrix: [], gaps: [] };

  const fwIds = frameworks.map(f => f.id);
  const { data: domData } = await admin.from("framework_domains").select("id, framework_id").in("framework_id", fwIds).limit(20000);
  const domains = (domData ?? []) as any[];
  const domToFw = new Map(domains.map(d => [d.id, d.framework_id]));
  const domIds = domains.map(d => d.id);

  const { data: compData } = domIds.length
    ? await admin.from("framework_competencies").select("id, domain_id, name, cpu_id").in("domain_id", domIds).limit(40000)
    : { data: [] };
  const comps = (compData ?? []) as any[];
  const compIds = comps.map(c => c.id);
  const cpuIds = [...new Set(comps.map(c => c.cpu_id).filter(Boolean))] as string[];

  // Gather link sets (each fail-soft to empty). methByFw handles framework-scoped assessment configs.
  const gatherSet = async (table: string, col: string, ids: string[]) => {
    const s = new Set<string>(); const counter = { n: 0 };
    if (!ids.length) return { set: s, count: 0 };
    for (const part of chunk(ids)) {
      const { data } = await admin.from(table).select(col).in(col, part).limit(60000);
      for (const r of (data ?? []) as any[]) { const v = r[col]; counter.n++; if (v) s.add(v); }
    }
    return { set: s, count: counter.n };
  };
  const [meth, evid, learn, skill, methFw, stdMap] = await Promise.all([
    gatherSet("assessment_method_configs", "competency_id", compIds),
    gatherSet("evidence_matrix", "cpu_id", cpuIds),
    gatherSet("resource_competencies", "competency_id", compIds),
    gatherSet("competency_skills", "competency_id", compIds),
    gatherSet("assessment_method_configs", "framework_id", fwIds),
    gatherSet("competency_standard_mappings", "competency_id", compIds),
  ]);

  const total = comps.length;
  const hasAssessment = (c: any) => meth.set.has(c.id) || (domToFw.get(c.domain_id) ? methFw.set.has(domToFw.get(c.domain_id)) : false);
  const hasEvidence = (c: any) => !!c.cpu_id && evid.set.has(c.cpu_id);
  const hasLearning = (c: any) => learn.set.has(c.id);
  const hasSkills = (c: any) => skill.set.has(c.id);
  const hasCpu = (c: any) => !!c.cpu_id;

  const cov = (pred: (c: any) => boolean) => (total ? Math.round((comps.filter(pred).length / total) * 100) : 0);
  const dimensions: Dimension[] = [
    { key: "cpu", label: "Competency ↔ CPU", links: cpuIds.length, coverage: cov(hasCpu), color: "#3b82f6" },
    { key: "assessment", label: "Competency ↔ Assessment", links: meth.count + methFw.count, coverage: cov(hasAssessment), color: "#8b5cf6" },
    { key: "evidence", label: "Competency ↔ Evidence", links: evid.count, coverage: cov(hasEvidence), color: "#14b8a6" },
    { key: "learning", label: "Competency ↔ Learning", links: learn.count, coverage: cov(hasLearning), color: "#f59e0b" },
    { key: "skills", label: "Competency ↔ Skills", links: skill.count, coverage: cov(hasSkills), color: "#0ea5e9" },
    { key: "standards", label: "Competency ↔ Standards", links: stdMap.count, coverage: cov((c: any) => stdMap.set.has(c.id)), color: "#ec4899" },
    { key: "role", label: "Competency ↔ Clinical Role", links: 0, coverage: 0, color: "#94a3b8", pending: true },
  ];

  // Per-framework coverage heatmap over the real dimensions.
  const dimKeys = ["cpu", "assessment", "evidence", "learning", "skills"] as const;
  const predByKey: Record<string, (c: any) => boolean> = { cpu: hasCpu, assessment: hasAssessment, evidence: hasEvidence, learning: hasLearning, skills: hasSkills };
  const compsByFw = new Map<string, any[]>();
  for (const c of comps) { const fw = domToFw.get(c.domain_id); if (!fw) continue; const a = compsByFw.get(fw) ?? []; a.push(c); compsByFw.set(fw, a); }
  const matrix: FwMatrix[] = frameworks.map(f => {
    const list = compsByFw.get(f.id) ?? [];
    const cells: Record<string, number> = {};
    for (const k of dimKeys) cells[k] = list.length ? Math.round((list.filter(predByKey[k]).length / list.length) * 100) : 0;
    return { id: f.id, name: f.name, competencies: list.length, cells };
  }).filter(m => m.competencies > 0).sort((a, b) => {
    const avg = (m: FwMatrix) => dimKeys.reduce((s, k) => s + m.cells[k], 0) / dimKeys.length;
    return avg(a) - avg(b);
  });

  // Thinnest traceability — competencies mapped to the fewest object types.
  const gaps = comps.map(c => {
    const mapped = [hasCpu(c), hasAssessment(c), hasEvidence(c), hasLearning(c), hasSkills(c)].filter(Boolean).length;
    const missing: string[] = [];
    if (!hasAssessment(c)) missing.push("assessment");
    if (!hasEvidence(c)) missing.push("evidence");
    if (!hasLearning(c)) missing.push("learning");
    return { name: c.name, framework: (() => { const fw = domToFw.get(c.domain_id); return fw ? (frameworks.find(f => f.id === fw)?.name ?? null) : null; })(), mapped, missing };
  }).filter(g => g.mapped < 5).sort((a, b) => a.mapped - b.mapped).slice(0, 40);

  return { provisioned: true as const, empty: total === 0, total, dimensions, matrix, gaps };
}
