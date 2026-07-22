// Knowledge Studio (CKP-001.1) loader — the authoring factory dashboard.
// Aggregates authoring status across every knowledge asset type (CPUs, CKOs,
// clinical cases, competencies, question banks, learning resources, policies)
// into a draft → review → published lifecycle, and merges a cross-type "recent
// work" feed. Live counts; fail-soft throughout.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };

export async function loadKnowledgeStudio(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });
  const active = (t: string) => admin.from(t).select("*", { count: "exact", head: true }).eq("is_active", true);

  const [cpuRows, koRows, caseRows, compCount, qbActive, lrActive, polActive, crOpen, caPending, recentCpu, recentKo, recentCase, recentComp, domainRows, frameworkRows] = await Promise.all([
    admin.from("clinical_practice_units").select("pub_status").limit(5000),
    admin.from("knowledge_objects").select("status").limit(8000),
    admin.from("clinical_cases").select("status").limit(5000),
    head("framework_competencies"),
    active("question_banks"), active("learning_resources"), active("policies"),
    admin.from("change_requests").select("*", { count: "exact", head: true }).eq("status", "open"),
    admin.from("content_approvals").select("*", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("clinical_practice_units").select("name, pub_status, created_at").order("created_at", { ascending: false }).limit(6),
    admin.from("knowledge_objects").select("title, status, created_at").order("created_at", { ascending: false }).limit(6),
    admin.from("clinical_cases").select("title, status, created_at").order("created_at", { ascending: false }).limit(6),
    admin.from("framework_competencies").select("name, created_at").order("created_at", { ascending: false }).limit(6),
    admin.from("framework_domains").select("id, name, framework_id").order("name").limit(500),
    admin.from("frameworks").select("id, name").limit(500),
  ]);

  const cpu = cpuRows.error ? {} : bucket(cpuRows.data ?? [], "pub_status");
  const ko = koRows.error ? {} : bucket(koRows.data ?? [], "status");
  const cs = caseRows.error ? {} : bucket(caseRows.data ?? [], "status");
  const competencies = num(compCount) ?? 0;

  const drafts = (cpu.draft ?? 0) + (ko.draft ?? 0) + (cs.draft ?? 0);
  const awaitingReview = (cpu.in_review ?? 0) + (cpu.approved ?? 0) + (num(crOpen) ?? 0) + (num(caPending) ?? 0);
  const published = (cpu.published ?? 0) + (ko.active ?? 0) + (cs.active ?? 0) + (num(qbActive) ?? 0) + (num(lrActive) ?? 0) + (num(polActive) ?? 0) + competencies;
  const archived = (cpu.archived ?? 0) + (ko.retired ?? 0) + (cs.retired ?? 0);
  const total = drafts + awaitingReview + published + archived;

  // Cross-type recent work feed.
  const norm = (rows: any[], type: string, icon: string, titleKey: string, statusKey?: string) =>
    (rows ?? []).map((r: any) => ({ type, icon, title: r[titleKey] || `${type}`, status: statusKey ? r[statusKey] : "published", at: r.created_at }));
  const recent = [
    ...norm(recentCpu.error ? [] : recentCpu.data, "CPU", "🧩", "name", "pub_status"),
    ...norm(recentKo.error ? [] : recentKo.data, "CKO", "🧠", "title", "status"),
    ...norm(recentCase.error ? [] : recentCase.data, "Case", "🩹", "title", "status"),
    ...norm(recentComp.error ? [] : recentComp.data, "Competency", "🎯", "name"),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 10);

  // AI authoring suggestions (derived from real gaps).
  const suggestions = [
    (ko.draft ?? 0) > 0 && `Draft AI review for ${ko.draft} knowledge object${ko.draft === 1 ? "" : "s"}`,
    (cpu.draft ?? 0) > 0 && `Generate assessment blueprint for ${cpu.draft} draft CPU${cpu.draft === 1 ? "" : "s"}`,
    (cs.draft ?? 0) > 0 && `Enrich ${cs.draft} draft clinical case${cs.draft === 1 ? "" : "s"} with an OSCE station`,
  ].filter(Boolean) as string[];

  // Domain picker for the in-Studio Competency builder (labelled with framework).
  const fwName: Record<string, string> = {};
  for (const f of frameworkRows.error ? [] : (frameworkRows.data ?? [])) fwName[f.id] = f.name;
  const domains = (domainRows.error ? [] : (domainRows.data ?? [])).map((d: any) => ({
    id: d.id,
    label: fwName[d.framework_id] ? `${fwName[d.framework_id]} › ${d.name}` : d.name,
  }));

  return {
    kpis: { total, drafts, awaitingReview, published, archived, suggestions: suggestions.length },
    recent, suggestions, domains,
    generatedAt: new Date().toISOString(),
  };
}
