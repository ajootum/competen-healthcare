/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-107 — Competency Quality Assurance. Computes a REAL completeness / quality score over the
// content the Studio has already authored (frameworks → domains → competencies → criteria / methods
// / skills, and CPUs → blueprints / evidence). This is a linter over authored content, not a new
// store — every figure is derived from the content itself (cf. COMP-022's on-read confidence). It is
// deliberately honest: a thin framework scores low because it *is* thin, not because data is missing.

const NONE = "00000000-0000-0000-0000-000000000000";

export type QaSeverity = "high" | "medium" | "low";
export type QaIssue = { severity: QaSeverity; kind: string; label: string; context?: string | null };
export type QaDomain = { key: string; label: string; pct: number; passed: number; total: number };
export type QaFramework = { id: string; name: string; competencies: number; complete: number; pct: number; flags: string[] };

export async function loadContentQa(admin: any, hid: string | null, isSuper: boolean): Promise<
  | { provisioned: false }
  | {
      provisioned: true;
      empty: boolean;
      kpis: { frameworks: number; competencies: number; avgScore: number; fullyComplete: number; issues: number; high: number };
      domains: QaDomain[];
      frameworks: QaFramework[];
      issues: QaIssue[];
      distribution: { band: string; n: number; color: string }[];
    }
> {
  const scope = (q: any, col = "hospital_id") => (isSuper ? q : q.or(`${col}.eq.${hid ?? NONE},${col}.is.null`));
  const today = new Date().toISOString().slice(0, 10);

  const fwRes = await scope(admin.from("frameworks").select("id, name, is_active, review_date, pub_status, version_major, description").eq("is_active", true).limit(3000));
  if (fwRes.error) return { provisioned: false };
  const frameworks = (fwRes.data ?? []) as any[];
  if (!frameworks.length) {
    return { provisioned: true, empty: true, kpis: { frameworks: 0, competencies: 0, avgScore: 0, fullyComplete: 0, issues: 0, high: 0 }, domains: [], frameworks: [], issues: [], distribution: [] };
  }
  const fwIds = frameworks.map(f => f.id);
  const fwById = new Map(frameworks.map(f => [f.id, f]));

  const [domRes, methByFwRes] = await Promise.all([
    admin.from("framework_domains").select("id, framework_id, name").in("framework_id", fwIds).limit(20000),
    admin.from("assessment_method_configs").select("framework_id").in("framework_id", fwIds).limit(20000),
  ]);
  const domains = (domRes.data ?? []) as any[];
  const domToFw = new Map(domains.map(d => [d.id, d.framework_id]));
  const domIds = domains.map(d => d.id);
  const fwHasMethod = new Set((methByFwRes.data ?? []).map((r: any) => r.framework_id).filter(Boolean));

  // Competencies under these frameworks (via their domains).
  const compRes = domIds.length
    ? await admin.from("framework_competencies").select("id, domain_id, name, description, cpu_id").in("domain_id", domIds).limit(40000)
    : { data: [] };
  const comps = (compRes.data ?? []) as any[];
  const compIds = comps.map(c => c.id);
  const cpuIds = [...new Set(comps.map(c => c.cpu_id).filter(Boolean))] as string[];

  // Attribute queries — each a plain existence lookup, fail-soft to empty.
  const chunk = <T,>(a: T[], n = 1000) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  const gather = async (table: string, col: string, ids: string[], sel = col) => {
    if (!ids.length) return new Set<string>();
    const s = new Set<string>();
    for (const part of chunk(ids)) {
      const { data } = await admin.from(table).select(sel).in(col, part).limit(50000);
      for (const r of (data ?? []) as any[]) { const v = r[col]; if (v) s.add(v); }
    }
    return s;
  };
  const [critByComp, methByComp, skillByComp, bpByCpu, evByCpu] = await Promise.all([
    gather("performance_criteria", "competency_id", compIds),
    gather("assessment_method_configs", "competency_id", compIds),
    gather("competency_skills", "competency_id", compIds),
    gather("assessment_blueprints", "cpu_id", cpuIds),
    gather("evidence_matrix", "cpu_id", cpuIds),
  ]);

  // Per-competency completeness — 5 authored-content checks.
  const issues: QaIssue[] = [];
  let sumScore = 0, fullyComplete = 0;
  const perFw = new Map<string, { comps: number; complete: number; scoreSum: number }>();
  let cHasDesc = 0, cHasCrit = 0, cHasMethod = 0, cHasSkill = 0, cLinked = 0;
  for (const c of comps) {
    const fwId = domToFw.get(c.domain_id) ?? null;
    const hasDesc = !!(c.description && String(c.description).trim().length > 10);
    const hasCrit = critByComp.has(c.id);
    const hasMethod = methByComp.has(c.id) || (fwId ? fwHasMethod.has(fwId) : false);
    const hasSkill = skillByComp.has(c.id);
    const linked = !!c.cpu_id;
    const checks = [hasDesc, hasCrit, hasMethod, hasSkill, linked];
    const passed = checks.filter(Boolean).length;
    const score = Math.round((passed / checks.length) * 100);
    if (hasDesc) cHasDesc++; if (hasCrit) cHasCrit++; if (hasMethod) cHasMethod++; if (hasSkill) cHasSkill++; if (linked) cLinked++;
    sumScore += score;
    if (passed === checks.length) fullyComplete++;
    if (fwId) { const g = perFw.get(fwId) ?? { comps: 0, complete: 0, scoreSum: 0 }; g.comps++; g.scoreSum += score; if (passed === checks.length) g.complete++; perFw.set(fwId, g); }
    const fwName = fwId ? (fwById.get(fwId)?.name ?? null) : null;
    if (!hasCrit) issues.push({ severity: "high", kind: "no_criteria", label: `“${c.name}” has no assessment criteria`, context: fwName });
    else if (!hasMethod) issues.push({ severity: "high", kind: "no_method", label: `“${c.name}” has no assessment method`, context: fwName });
    else if (!hasDesc) issues.push({ severity: "medium", kind: "no_desc", label: `“${c.name}” has no description`, context: fwName });
    else if (!hasSkill) issues.push({ severity: "low", kind: "no_skill", label: `“${c.name}” has no linked skills`, context: fwName });
  }

  // CPU-level evidence/blueprint gaps.
  const cpuById = new Map<string, string>();
  if (cpuIds.length) {
    for (const part of chunk(cpuIds)) {
      const { data } = await admin.from("clinical_practice_units").select("id, name").in("id", part).limit(10000);
      for (const r of (data ?? []) as any[]) cpuById.set(r.id, r.name);
    }
  }
  for (const cpuId of cpuIds) {
    if (!bpByCpu.has(cpuId)) issues.push({ severity: "high", kind: "no_blueprint", label: `CPU “${cpuById.get(cpuId) ?? cpuId}” has no assessment blueprint`, context: null });
    else if (!evByCpu.has(cpuId)) issues.push({ severity: "medium", kind: "no_evidence", label: `CPU “${cpuById.get(cpuId) ?? cpuId}” has no evidence matrix`, context: null });
  }

  // Framework-level structural checks + scorecard.
  const fwCards: QaFramework[] = [];
  for (const f of frameworks) {
    const g = perFw.get(f.id) ?? { comps: 0, complete: 0, scoreSum: 0 };
    const flags: string[] = [];
    const domCount = domains.filter(d => d.framework_id === f.id).length;
    if (domCount === 0) { flags.push("no domains"); issues.push({ severity: "medium", kind: "no_domains", label: `Framework “${f.name}” has no domains`, context: null }); }
    if (!f.review_date) flags.push("no review date");
    else if (f.review_date < today) { flags.push("review overdue"); issues.push({ severity: "medium", kind: "review_overdue", label: `Framework “${f.name}” review is overdue`, context: null }); }
    if (!f.pub_status || f.pub_status === "draft") flags.push("unpublished");
    fwCards.push({ id: f.id, name: f.name, competencies: g.comps, complete: g.complete, pct: g.comps ? Math.round(g.scoreSum / g.comps) : 0, flags });
  }
  fwCards.sort((a, b) => a.pct - b.pct);

  const totalComps = comps.length;
  const pctOf = (n: number) => (totalComps ? Math.round((n / totalComps) * 100) : 0);
  const domainScores: QaDomain[] = [
    { key: "metadata", label: "Metadata completeness", pct: pctOf(cHasDesc), passed: cHasDesc, total: totalComps },
    { key: "assessment", label: "Assessment integrity", pct: pctOf(cHasCrit), passed: cHasCrit, total: totalComps },
    { key: "method", label: "Assessment coverage", pct: pctOf(cHasMethod), passed: cHasMethod, total: totalComps },
    { key: "skills", label: "Skill linkage", pct: pctOf(cHasSkill), passed: cHasSkill, total: totalComps },
    { key: "evidence", label: "CPU linkage", pct: pctOf(cLinked), passed: cLinked, total: totalComps },
  ];

  const avgScore = totalComps ? Math.round(sumScore / totalComps) : 0;
  const band = (p: number) => (p >= 90 ? 0 : p >= 75 ? 1 : p >= 50 ? 2 : 3);
  const bands = [0, 0, 0, 0];
  for (const c of comps) {
    const fwId = domToFw.get(c.domain_id) ?? null;
    const passed = [!!(c.description && String(c.description).trim().length > 10), critByComp.has(c.id), methByComp.has(c.id) || (fwId ? fwHasMethod.has(fwId) : false), skillByComp.has(c.id), !!c.cpu_id].filter(Boolean).length;
    bands[band(Math.round((passed / 5) * 100))]++;
  }
  const distribution = [
    { band: "Excellent (90–100%)", n: bands[0], color: "#10b981" },
    { band: "Good (75–89%)", n: bands[1], color: "#3b82f6" },
    { band: "Fair (50–74%)", n: bands[2], color: "#f59e0b" },
    { band: "Poor (<50%)", n: bands[3], color: "#ef4444" },
  ];

  const order = { high: 0, medium: 1, low: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  const high = issues.filter(i => i.severity === "high").length;

  return {
    provisioned: true,
    empty: totalComps === 0,
    kpis: { frameworks: frameworks.length, competencies: totalComps, avgScore, fullyComplete, issues: issues.length, high },
    domains: domainScores,
    frameworks: fwCards,
    issues: issues.slice(0, 60),
    distribution,
  };
}
