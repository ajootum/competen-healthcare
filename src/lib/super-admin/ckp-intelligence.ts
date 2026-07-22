// Knowledge Intelligence (CKP-001.6) loader — the analytics & AI layer over the
// clinical knowledge base. Computes real signals: mapping coverage, per-framework
// coverage, gap analysis (unmapped competencies, empty domains, blueprint-less
// CPUs), basic duplicate detection (exact normalised-title matches), a multi-
// dimension knowledge-health composite, and derived AI recommendations. Usage /
// search analytics need telemetry the platform doesn't collect → honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };
const normTitle = (s: any) => String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const dupCount = (titles: string[]) => { const m = new Map<string, number>(); for (const t of titles) if (t) m.set(t, (m.get(t) ?? 0) + 1); let groups = 0, items = 0; for (const n of m.values()) if (n > 1) { groups++; items += n; } return { groups, items }; };

export async function loadKnowledgeIntelligence(admin: any) {
  const [compRows, koRows, domRows, frRows, cpuRows, bpRows, polRows, decisionRows, commActive] = await Promise.all([
    admin.from("framework_competencies").select("name, cpu_id, domain_id").limit(30000),
    admin.from("knowledge_objects").select("title, status, review_date").limit(10000),
    admin.from("framework_domains").select("id, framework_id").limit(5000),
    admin.from("frameworks").select("id, name").limit(1000),
    admin.from("clinical_practice_units").select("id, pub_status").limit(5000),
    admin.from("assessment_blueprints").select("cpu_id").limit(20000),
    admin.from("policies").select("review_date, is_active").limit(4000),
    admin.from("competency_decisions").select("validation_outcome").limit(20000),
    admin.from("governance_committees").select("*", { count: "exact", head: true }).eq("is_active", true),
  ]);

  const comps = (compRows.error ? [] : compRows.data ?? []) as any[];
  const kos = (koRows.error ? [] : koRows.data ?? []) as any[];
  const domains = (domRows.error ? [] : domRows.data ?? []) as any[];
  const frameworks = (frRows.error ? [] : frRows.data ?? []) as any[];
  const cpus = (cpuRows.error ? [] : cpuRows.data ?? []) as any[];
  const now = Date.now();

  // Coverage & gaps.
  const totalComp = comps.length;
  const mapped = comps.filter(c => c.cpu_id).length;
  const coverage = pct(mapped, totalComp);
  const missingCompetencies = totalComp - mapped;

  const domCompCount = new Map<string, number>();
  for (const c of comps) domCompCount.set(c.domain_id, (domCompCount.get(c.domain_id) ?? 0) + 1);
  const emptyDomains = domains.filter(d => (domCompCount.get(d.id) ?? 0) === 0).length;

  const domFramework = new Map<string, string>(domains.map(d => [d.id, d.framework_id]));
  const frTotal = new Map<string, number>(), frMapped = new Map<string, number>();
  for (const c of comps) { const f = domFramework.get(c.domain_id); if (f) { frTotal.set(f, (frTotal.get(f) ?? 0) + 1); if (c.cpu_id) frMapped.set(f, (frMapped.get(f) ?? 0) + 1); } }
  const lowCoverageFrameworks = frameworks
    .map(f => ({ name: f.name, cov: pct(frMapped.get(f.id) ?? 0, frTotal.get(f.id) ?? 0) ?? 0, n: frTotal.get(f.id) ?? 0 }))
    .filter(f => f.n > 0 && f.cov < 50).sort((a, b) => a.cov - b.cov);

  const bpCpus = new Set((bpRows.error ? [] : bpRows.data ?? []).map((r: any) => r.cpu_id).filter(Boolean));
  const cpusNoBlueprint = cpus.filter(c => !bpCpus.has(c.id)).length;

  // Duplicate detection (exact normalised-title matches).
  const koDup = dupCount(kos.map(k => normTitle(k.title)));
  const compDup = dupCount(comps.map(c => normTitle(c.name)));
  const duplicateItems = koDup.items + compDup.items;

  // Currency — assets with a review date that isn't overdue.
  const dated = [...kos.filter(k => k.review_date).map(k => k.review_date), ...(polRows.error ? [] : polRows.data ?? []).filter((p: any) => p.review_date).map((p: any) => p.review_date)];
  const current = dated.filter((d: any) => new Date(d).getTime() >= now).length;
  const currency = dated.length ? pct(current, dated.length) : null;
  const outdatedPolicies = (polRows.error ? [] : polRows.data ?? []).filter((p: any) => p.review_date && new Date(p.review_date).getTime() < now).length;

  // Quality — validated share of recorded competency decisions.
  const decisions = bucket(decisionRows.error ? [] : decisionRows.data ?? [], "validation_outcome");
  const decTotal = (decisionRows.error ? [] : decisionRows.data ?? []).length;
  const validated = (decisions.validated ?? 0) + (decisions.passed ?? 0);
  const quality = decTotal ? pct(validated, decTotal) : null;

  // Completeness — published share of the flagship assets.
  const koStatus = bucket(kos, "status");
  const cpuStatus = bucket(cpus, "pub_status");
  const liveAssets = (cpuStatus.published ?? 0) + (koStatus.active ?? 0);
  const completeness = pct(liveAssets, cpus.length + kos.length);

  // Governance — active committees present is a base signal (honest null if none).
  const activeComms = num(commActive) ?? 0;
  const governance = activeComms > 0 ? Math.min(100, 40 + activeComms * 20) : null;

  const dimensions = [
    { label: "Coverage", value: coverage },
    { label: "Completeness", value: completeness },
    { label: "Quality", value: quality },
    { label: "Currency", value: currency },
    { label: "Governance", value: governance },
    { label: "Usage", value: null }, // no usage telemetry — honest
  ];
  const computable = dimensions.map(d => d.value).filter((v): v is number => v != null);
  const health = computable.length ? Math.round(computable.reduce((a, b) => a + b, 0) / computable.length) : null;

  // Derived AI insights — each deep-links to the surface where it gets fixed.
  const insights = [
    missingCompetencies > 0 && { text: `Map ${missingCompetencies} unmapped competenc${missingCompetencies === 1 ? "y" : "ies"} to a CPU`, impact: "High", href: "/super-admin/ckp/competency" },
    koDup.items > 0 && { text: `Review ${koDup.items} possible duplicate knowledge object title${koDup.items === 1 ? "" : "s"}`, impact: "High", href: "/super-admin/studio/knowledge" },
    compDup.items > 0 && { text: `Review ${compDup.items} possible duplicate competency name${compDup.items === 1 ? "" : "s"}`, impact: "High", href: "/super-admin/ckp/competency" },
    lowCoverageFrameworks.length > 0 && { text: `Low coverage in ${lowCoverageFrameworks[0].name} (${lowCoverageFrameworks[0].cov}%)`, impact: "Medium", href: "/super-admin/ckp/competency" },
    emptyDomains > 0 && { text: `${emptyDomains} domain${emptyDomains === 1 ? "" : "s"} have no competencies`, impact: "Medium", href: "/super-admin/ckp/competency" },
    cpusNoBlueprint > 0 && { text: `${cpusNoBlueprint} CPU${cpusNoBlueprint === 1 ? "" : "s"} lack an assessment blueprint`, impact: "Medium", href: "/super-admin/ckp/assessment" },
    outdatedPolicies > 0 && { text: `${outdatedPolicies} polic${outdatedPolicies === 1 ? "y is" : "ies are"} past review date`, impact: "High", href: "/super-admin/policy-manager" },
    (koStatus.draft ?? 0) > 0 && { text: `Publish ${koStatus.draft} draft knowledge object${koStatus.draft === 1 ? "" : "s"}`, impact: "Low", href: "/super-admin/ckp/publishing" },
  ].filter(Boolean).slice(0, 6) as { text: string; impact: string; href: string }[];

  return {
    kpis: { health, coverage, duplicates: duplicateItems, recommendations: insights.length, missingCompetencies, gaps: emptyDomains + cpusNoBlueprint + lowCoverageFrameworks.length },
    dimensions, insights,
    coverage: { score: coverage, mapped, total: totalComp, missing: missingCompetencies, lowCoverageFrameworks: lowCoverageFrameworks.slice(0, 5) },
    duplicates: { knowledgeObjects: koDup, competencies: compDup, total: duplicateItems },
    gaps: { emptyDomains, cpusNoBlueprint, lowCoverageFrameworks: lowCoverageFrameworks.length, outdatedPolicies },
    generatedAt: new Date().toISOString(),
  };
}
