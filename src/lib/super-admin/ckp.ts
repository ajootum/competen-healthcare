// Clinical Knowledge Platform (CKP-001) overview loader. Aggregates the CKP
// landing dashboard from the real knowledge schema — frameworks, competencies,
// CPUs, CKOs, cases, assessments, policies, learning resources, graph edges,
// taxonomy and governance. Live counts + a normalised publishing pipeline and
// derived intelligence signals; metrics the platform doesn't track (duplicate
// detection, usage telemetry) surface as honest "not computed" states rather
// than fabricated numbers. Everything is fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };

export async function loadCkp(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });

  const [
    frRes, frActiveRes, domRes, pracRes, compRes, cpuCountRes, koCountRes, caseRes, bpRes, chkRes,
    qbRes, lrCountRes, polRes, polActiveRes, commRes, crRes, crOpenRes, edgeRes, taxRes, tagRes, asmtRes,
  ] = await Promise.all([
    head("frameworks"), admin.from("frameworks").select("*", { count: "exact", head: true }).eq("is_active", true),
    head("framework_domains"), head("practices"), head("framework_competencies"),
    head("clinical_practice_units"), head("knowledge_objects"), head("clinical_cases"),
    head("assessment_blueprints"), head("skill_checklists"), head("question_banks"), head("learning_resources"),
    head("policies"), admin.from("policies").select("*", { count: "exact", head: true }).eq("is_active", true),
    head("governance_committees"), head("change_requests"),
    admin.from("change_requests").select("*", { count: "exact", head: true }).eq("status", "open"),
    head("knowledge_edges"), head("taxonomies"), head("tags"), head("assessments"),
  ]);

  // Status breakdowns (small selects).
  const [cpuRows, koRows, lrRows, compMapRows, crListRes, auditRes] = await Promise.all([
    admin.from("clinical_practice_units").select("pub_status").limit(5000),
    admin.from("knowledge_objects").select("status").limit(8000),
    admin.from("learning_resources").select("resource_type").limit(8000),
    admin.from("framework_competencies").select("cpu_id").limit(20000),
    admin.from("change_requests").select("id, entity_type, entity_name, change_kind, status, requested_by_name, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(8),
    admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").in("entity_type", ["framework", "competency", "cpu", "knowledge_object", "policy", "assessment", "clinical_case", "guideline", "change_request", "approval"]).order("created_at", { ascending: false }).limit(10),
  ]);

  const cpu = cpuRows.error ? {} : bucket(cpuRows.data ?? [], "pub_status");
  const ko = koRows.error ? {} : bucket(koRows.data ?? [], "status");
  const lr = lrRows.error ? {} : bucket(lrRows.data ?? [], "resource_type");
  const compMap = compMapRows.error ? [] : (compMapRows.data ?? []);
  const mappedComp = compMap.filter((r: any) => r.cpu_id).length;
  const totalComp = compMap.length;

  const cpuTotal = num(cpuCountRes) ?? 0;
  const publishedCPUs = cpu.published ?? 0;
  const koTotal = num(koCountRes) ?? 0;
  const activeKO = ko.active ?? 0;
  const guidelines = lr.guideline ?? 0;
  const simulations = (lr.simulation ?? 0);
  const policiesN = num(polRes) ?? 0;

  const draftAssets = (cpu.draft ?? 0) + (ko.draft ?? 0);
  const pendingReviews = (cpu.in_review ?? 0) + (num(crOpenRes) ?? 0);

  // Derived Knowledge Health: share of flagship assets that are live (published/
  // active) vs in-progress. Honest — reflects real content state.
  const liveAssets = publishedCPUs + activeKO + (num(polActiveRes) ?? 0) + (num(frActiveRes) ?? 0);
  const totalTracked = cpuTotal + koTotal + policiesN + (num(frRes) ?? 0);
  const healthPct = totalTracked ? Math.round((liveAssets / totalTracked) * 100) : null;
  const healthLabel = healthPct == null ? "—" : healthPct >= 80 ? "Excellent" : healthPct >= 50 ? "Healthy" : healthPct >= 25 ? "Developing" : "Building";
  const healthTone = healthPct == null ? "text-gray-400" : healthPct >= 50 ? "text-green-600" : healthPct >= 25 ? "text-amber-600" : "text-orange-600";

  // Publishing pipeline (5 stages, mapped from CPU pub_status; educational review
  // has no distinct field yet → honest 0).
  const pipeline = [
    { stage: "Draft", count: (cpu.draft ?? 0) + (ko.draft ?? 0), icon: "📝" },
    { stage: "Clinical Review", count: cpu.in_review ?? 0, icon: "🩺" },
    { stage: "Educational Review", count: 0, icon: "🎓" },
    { stage: "Governance", count: cpu.approved ?? 0, icon: "⚖️" },
    { stage: "Published", count: publishedCPUs + activeKO, icon: "✅" },
  ];

  // Knowledge Intelligence — derived where real, honest where not.
  const coverageScore = totalComp ? Math.round((mappedComp / totalComp) * 100) : null;
  const missingCompetencies = totalComp - mappedComp;
  const recommendations = [
    (ko.draft ?? 0) > 0 && { text: `Publish ${ko.draft} draft knowledge object${ko.draft === 1 ? "" : "s"}`, impact: "High" },
    missingCompetencies > 0 && { text: `Map ${missingCompetencies} competenc${missingCompetencies === 1 ? "y" : "ies"} to a CPU`, impact: "High" },
    (cpu.draft ?? 0) > 0 && { text: `Advance ${cpu.draft} draft CPU${cpu.draft === 1 ? "" : "s"} through review`, impact: "Medium" },
    policiesN === 0 && { text: "No policies authored yet — add clinical policies", impact: "Medium" },
  ].filter(Boolean).slice(0, 4) as { text: string; impact: string }[];

  const assessments = num(asmtRes) ?? 0;

  const assetsByType = [
    { label: "Competencies", n: totalComp, color: "#8b5cf6" },
    { label: "CPUs", n: cpuTotal, color: "#3b82f6" },
    { label: "CKOs", n: koTotal, color: "#14b8a6" },
    { label: "Assessments", n: assessments, color: "#f59e0b" },
    { label: "Clinical Cases", n: num(caseRes) ?? 0, color: "#ef4444" },
    { label: "Policies", n: policiesN, color: "#6b7280" },
    { label: "Learning", n: num(lrCountRes) ?? 0, color: "#0ea5e9" },
  ].filter(a => a.n > 0);
  const assetsTotal = assetsByType.reduce((s, a) => s + a.n, 0);

  // Recent activity (audit) — fail-soft.
  const ICON: Record<string, string> = { framework: "📐", competency: "🎯", cpu: "🧩", knowledge_object: "🧠", policy: "📋", assessment: "📝", clinical_case: "🩹", guideline: "📖", change_request: "✏️", approval: "✅" };
  const activity = (auditRes.error ? [] : auditRes.data ?? []).map((a: any) => ({ icon: ICON[a.entity_type] ?? "•", title: a.entity_name || (a.action ?? "").replace(/_/g, " "), detail: [(a.action ?? "").replace(/_/g, " "), a.actor_name].filter(Boolean).join(" · "), at: a.created_at }));

  const tasks = (crListRes.error ? [] : crListRes.data ?? []).map((r: any) => ({ title: r.entity_name || "Change request", detail: `${(r.entity_type ?? "").replace(/_/g, " ")} · ${r.change_kind ?? "revision"}`, by: r.requested_by_name, at: r.created_at }));

  // 6-module directory — links to the closest live surface until each module ships.
  const modules = [
    { n: 1, name: "Knowledge Studio", desc: "Author every knowledge asset — competencies, CPUs, CKOs, assessments, policies", icon: "🏭", href: "/super-admin/ckp/studio", stat: `${draftAssets} in progress`, subs: ["Competency Builder", "CPU Builder", "CKO Builder", "Learning Builder", "Assessment Builder", "AI Authoring"] },
    { n: 2, name: "Competency & Framework Centre", desc: "Competency architecture — libraries, frameworks, domains, crosswalks", icon: "📐", href: "/super-admin/ckp/competency", stat: `${num(frRes) ?? 0} frameworks`, subs: ["Competency Library", "Framework Library", "Domains", "Role Frameworks", "Crosswalks", "Version History"] },
    { n: 3, name: "Clinical Knowledge Repository", desc: "The knowledge warehouse — CKOs, CPUs, evidence, guidelines, graph", icon: "🗄️", href: "/super-admin/ckp/repository", stat: `${koTotal} objects`, subs: ["CKO Library", "CPU Library", "Evidence", "Clinical Guidelines", "Knowledge Graph", "Terminology"] },
    { n: 4, name: "Assessment & Validation Centre", desc: "Assessment governance — methods, rubrics, blueprints, psychometrics", icon: "🎯", href: "/super-admin/ckp/assessment", stat: `${assessments} assessments`, subs: ["Assessment Methods", "Rubrics & Checklists", "Blueprints", "Validation", "Psychometrics", "Certification Rules"] },
    { n: 5, name: "Knowledge Publishing & Governance", desc: "Move knowledge safely into production — review, approve, publish", icon: "🚦", href: "/super-admin/ckp/publishing", stat: `${pendingReviews} in review`, subs: ["Review Workspace", "Clinical Review", "Governance Approval", "Publishing Pipeline", "Version Control", "Audit & Archive"] },
    { n: 6, name: "Knowledge Intelligence", desc: "Analytics and AI insight over the clinical knowledge base", icon: "📡", href: "/super-admin/ckp/intelligence", stat: coverageScore == null ? "—" : `${coverageScore}% coverage`, subs: ["Knowledge Analytics", "AI Recommendations", "Coverage Analysis", "Duplicate Detection", "Gap Analysis", "Usage Analytics"] },
  ];

  return {
    kpis: {
      health: { pct: healthPct, label: healthLabel, tone: healthTone },
      draftAssets, pendingReviews, publishedCPUs,
      frameworks: num(frRes) ?? 0, assessments, policiesGuidelines: policiesN + guidelines, knowledgeObjects: koTotal,
    },
    pipeline,
    intelligence: {
      coverageScore, coverageReady: coverageScore != null,
      duplicates: null, // not computed — honest
      missingCompetencies, lowUsage: null, // no usage telemetry — honest
      recommendations,
    },
    assetsByType, assetsTotal,
    activity, activityReady: !auditRes.error,
    tasks,
    modules,
    counts: { domains: num(domRes) ?? 0, practices: num(pracRes) ?? 0, cases: num(caseRes) ?? 0, blueprints: num(bpRes) ?? 0, checklists: num(chkRes) ?? 0, questionBanks: num(qbRes) ?? 0, learning: num(lrCountRes) ?? 0, edges: num(edgeRes) ?? 0, taxonomies: num(taxRes) ?? 0, tags: num(tagRes) ?? 0, committees: num(commRes) ?? 0, guidelines, simulations },
    generatedAt: new Date().toISOString(),
  };
}
