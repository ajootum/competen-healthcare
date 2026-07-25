// PW-008 Documents & Knowledge Library — a unified, searchable view over the platform's REAL governed content:
// policies, knowledge_objects, learning_resources, quality_objects, clinical_cases (there is no generic file/blob
// store, so these typed tables ARE the library). Normalises each to a document {name, type, category, modified,
// href}, computes the KPI ribbon, browse tree, category donut, mandatory/review-due list and recent additions.
// Read-only aggregation. Honest gaps: no binary upload / file-size / storage-quota / bookmarks / share store —
// those KPIs are next-phase, and "size" is not shown as a fake number.
/* eslint-disable @typescript-eslint/no-explicit-any */
const dayMs = 86400000;
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };
const count = async (p: Promise<any>) => { try { const r = await p; return r?.count ?? 0; } catch { return 0; } };

export const DOC_TYPE: Record<string, { label: string; color: string; icon: string; href: string }> = {
  policy: { label: "Policy", color: "#3b82f6", icon: "📋", href: "/dashboard/library" },
  knowledge: { label: "Knowledge", color: "#8b5cf6", icon: "📖", href: "/dashboard/knowledge" },
  learning: { label: "Learning Resource", color: "#f59e0b", icon: "🎓", href: "/dashboard/learning" },
  quality: { label: "Quality Standard", color: "#10b981", icon: "🛡️", href: "/dashboard/library" },
  case: { label: "Clinical Case", color: "#ec4899", icon: "🩺", href: "/dashboard/knowledge" },
};

export async function loadDocumentLibrary(admin: any, userId: string, profile: any) {
  const now = Date.now();
  const hid = profile?.hospital_id ?? null;
  const orFilter = hid ? `hospital_id.eq.${hid},hospital_id.is.null` : null;
  const docs: any[] = [];

  // ── Policies ──
  let polQ = admin.from("policies").select("id, title, policy_type, version, review_date, effective_date, created_by, created_at").eq("is_active", true);
  polQ = orFilter ? polQ.or(orFilter) : polQ;
  for (const p of await q(polQ.order("created_at", { ascending: false }).limit(80))) docs.push({ id: p.id, name: p.title, type: "policy", category: (p.policy_type ?? "policy").replace(/_/g, " "), modified: p.created_at, review_date: p.review_date, version: p.version, mandatory: true, createdBy: p.created_by });

  // ── Knowledge objects ──
  for (const k of await q(admin.from("knowledge_objects").select("id, title, knowledge_type, review_date, created_by, created_at").neq("status", "retired").order("created_at", { ascending: false }).limit(80))) docs.push({ id: k.id, name: k.title, type: "knowledge", category: (k.knowledge_type ?? "knowledge").replace(/_/g, " "), modified: k.created_at, review_date: k.review_date, mandatory: false, createdBy: k.created_by });

  // ── Learning resources ──
  let lrQ = admin.from("learning_resources").select("id, title, resource_type, created_at").eq("is_active", true);
  lrQ = orFilter ? lrQ.or(orFilter) : lrQ;
  for (const l of await q(lrQ.order("created_at", { ascending: false }).limit(60))) docs.push({ id: l.id, name: l.title, type: "learning", category: (l.resource_type ?? "resource").replace(/_/g, " "), modified: l.created_at, mandatory: false });

  // ── Quality objects ──
  let qoQ = admin.from("quality_objects").select("id, title, review_date, created_by, created_at").eq("status", "active");
  qoQ = orFilter ? qoQ.or(orFilter) : qoQ;
  for (const qo of await q(qoQ.order("created_at", { ascending: false }).limit(50))) docs.push({ id: qo.id, name: qo.title, type: "quality", category: "quality", modified: qo.created_at, review_date: qo.review_date, mandatory: false, createdBy: qo.created_by });

  // ── Clinical cases ──
  for (const cc of await q(admin.from("clinical_cases").select("id, title, difficulty, created_by, created_at").neq("status", "retired").order("created_at", { ascending: false }).limit(40))) docs.push({ id: cc.id, name: cc.title, type: "case", category: (cc.difficulty ?? "case"), modified: cc.created_at, mandatory: false, createdBy: cc.created_by });

  docs.forEach(dc => { dc.meta = DOC_TYPE[dc.type]; });
  docs.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

  // ── KPIs ──
  const myDocs = docs.filter(dc => dc.createdBy === userId).length;
  const mandatory = docs.filter(dc => dc.mandatory);
  const reviewSoon = docs.filter(dc => dc.review_date && new Date(dc.review_date).getTime() <= now + 30 * dayMs);
  const added7d = docs.filter(dc => new Date(dc.modified).getTime() >= now - 7 * dayMs).length;
  const knowledgeCount = docs.filter(dc => dc.type === "knowledge" || dc.type === "case").length;

  // ── Browse tree (by type) + category donut ──
  const typeCount = new Map<string, number>();
  docs.forEach(dc => typeCount.set(dc.type, (typeCount.get(dc.type) ?? 0) + 1));
  const browse = [...typeCount.entries()].map(([type, n]) => ({ type, ...DOC_TYPE[type], n })).sort((a, b) => b.n - a.n);
  const donut = browse;

  // ── Mandatory / review-due list ──
  const mandatoryList = [...mandatory].sort((a, b) => (a.review_date ?? "9999").localeCompare(b.review_date ?? "9999")).slice(0, 5);

  // ── Recent additions ──
  const recent = docs.slice(0, 5);

  // total across tables (head counts, not just the fetched page).
  const [pc, kc, lc, qc, cc] = await Promise.all([
    count(admin.from("policies").select("id", { count: "exact", head: true }).eq("is_active", true)),
    count(admin.from("knowledge_objects").select("id", { count: "exact", head: true }).neq("status", "retired")),
    count(admin.from("learning_resources").select("id", { count: "exact", head: true }).eq("is_active", true)),
    count(admin.from("quality_objects").select("id", { count: "exact", head: true }).eq("status", "active")),
    count(admin.from("clinical_cases").select("id", { count: "exact", head: true }).neq("status", "retired")),
  ]);
  const totalAll = pc + kc + lc + qc + cc;

  return {
    docs, totalAll, totalShown: docs.length,
    kpis: { total: totalAll, myDocs, mandatory: mandatory.length, reviewSoon: reviewSoon.length, categories: browse.length, added7d, knowledge: knowledgeCount },
    browse, donut, mandatoryList, recent,
  };
}
