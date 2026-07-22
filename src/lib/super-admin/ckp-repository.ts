// Clinical Knowledge Repository (CKP-001.3) loader — the knowledge warehouse
// dashboard. Aggregates every stored asset (CKOs by type/status, CPUs, evidence,
// guidelines, policies, cases), the knowledge-graph shape (distinct nodes,
// relationships, semantic index), and terminology/taxonomy. Recent knowledge
// feed is real; "most accessed" needs usage telemetry → honest state. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };

export async function loadRepository(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });

  const [koRows, cpuCount, cpuPub, polCount, guideCount, caseCount, edgeRows, embCount, taxCount, termCount, tagCount, recentKo] = await Promise.all([
    admin.from("knowledge_objects").select("knowledge_type, status").limit(10000),
    head("clinical_practice_units"),
    admin.from("clinical_practice_units").select("*", { count: "exact", head: true }).eq("pub_status", "published"),
    head("policies"),
    admin.from("learning_resources").select("*", { count: "exact", head: true }).eq("resource_type", "guideline"),
    head("clinical_cases"),
    admin.from("knowledge_edges").select("source_id, target_id, relationship").limit(50000),
    head("knowledge_embeddings"),
    head("taxonomies"),
    head("taxonomy_terms"),
    head("tags"),
    admin.from("knowledge_objects").select("title, knowledge_type, status, created_at").order("created_at", { ascending: false }).limit(10),
  ]);

  const kos = (koRows.error ? [] : koRows.data ?? []) as any[];
  const koByType = bucket(kos, "knowledge_type");
  const koByStatus = bucket(kos, "status");
  const koTotal = kos.length;
  const evidence = koByType.evidence ?? 0;

  // Knowledge graph shape.
  const edges = (edgeRows.error ? [] : edgeRows.data ?? []) as any[];
  const nodeSet = new Set<string>();
  for (const e of edges) { if (e.source_id) nodeSet.add(e.source_id); if (e.target_id) nodeSet.add(e.target_id); }
  const relTypes = new Set(edges.map(e => e.relationship).filter(Boolean));

  const cpuTotal = num(cpuCount) ?? 0;
  const policies = num(polCount) ?? 0;
  const guidelines = num(guideCount) ?? 0;

  const categories = [
    { label: "CKO Library", icon: "🧠", n: koTotal, href: "/super-admin/studio/knowledge" },
    { label: "CPU Library", icon: "🧩", n: cpuTotal, href: "/super-admin/studio/cpus" },
    { label: "Evidence Library", icon: "🔬", n: evidence, href: "/super-admin/studio/knowledge" },
    { label: "Clinical Guidelines", icon: "📖", n: guidelines, href: "/super-admin/policy-manager" },
    { label: "Policies", icon: "📋", n: policies, href: "/super-admin/policy-manager" },
    { label: "Clinical Cases", icon: "🩹", n: num(caseCount) ?? 0, href: "/super-admin/studio/cases" },
    { label: "Knowledge Graph", icon: "🕸️", n: edges.length, href: "/super-admin/knowledge-graph" },
    { label: "Terminology & Taxonomy", icon: "🏷️", n: num(termCount) ?? 0, href: "/super-admin/metadata" },
  ];

  const recent = (recentKo.error ? [] : recentKo.data ?? []).map((r: any) => ({ title: r.title, type: (r.knowledge_type ?? "").replace(/_/g, " "), status: r.status, at: r.created_at }));

  return {
    kpis: {
      knowledgeObjects: koTotal, cpus: cpuTotal, cpusPublished: num(cpuPub) ?? 0,
      policies, guidelines, evidence, cases: num(caseCount) ?? 0,
      taxonomies: num(taxCount) ?? 0, terms: num(termCount) ?? 0, tags: num(tagCount) ?? 0,
    },
    koByType: Object.entries(koByType).map(([type, n]) => ({ type: type.replace(/_/g, " "), n })).sort((a, b) => (b.n as number) - (a.n as number)),
    koByStatus,
    graph: { nodes: nodeSet.size, relationships: edges.length, relationshipTypes: relTypes.size, embeddings: num(embCount) ?? 0 },
    categories, recent,
    generatedAt: new Date().toISOString(),
  };
}
