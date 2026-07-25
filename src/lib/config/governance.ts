// Configuration Governance & Release Management (WCE-004) — the governed change pathway. `classifyChange`
// derives the risk level + required reviews from the WCE-002 registry (an object's safety_classification and
// type drive the review routing, §11/§13/§43) — governance never invents risk. `loadGovernance` powers the
// dashboard (§7). MVP: change requests + reviews + audit; release packaging, test gates, change freezes and
// progressive rollout are next-phase. Fail-soft (pre-migration → empty).
/* eslint-disable @typescript-eslint/no-explicit-any */
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export const REVIEW_LABEL: Record<string, string> = { product: "Product", technical: "Technical", clinical_safety: "Clinical Safety", security: "Security", privacy: "Privacy", data_governance: "Data Governance", ai_governance: "AI Governance", tenant_approval: "Tenant Approval", enterprise_approval: "Enterprise Approval", release_manager: "Release Manager" };
export const RISK_TONE: Record<string, string> = { low: "bg-emerald-50 text-emerald-700", moderate: "bg-amber-50 text-amber-700", high: "bg-orange-50 text-orange-700", critical: "bg-rose-50 text-rose-700" };

const SCOPE_BREADTH: Record<string, number> = { platform: 5, enterprise: 4, tenant: 3, hospital: 3, facility: 3, department: 2, unit: 2, role: 1, user: 1 };

// Risk + review routing derived from the registry metadata of the affected objects (§11 weighted model, §13 routing).
export function classifyChange(registryByKey: Map<string, any>, affectedKeys: string[], scopeType: string, changeType: string) {
  const objs = affectedKeys.map(k => registryByKey.get(k)).filter(Boolean);
  const safeties = objs.map(o => o.safety_classification);
  const types = objs.map(o => o.object_type);
  const has = (fn: (o: any) => boolean) => objs.some(fn);

  const clinicalSafety = safeties.includes("clinical_safety_critical") ? 5 : safeties.includes("clinical_safety_relevant") ? 4 : safeties.includes("clinical_support") ? 2 : 1;
  const security = safeties.includes("security_critical") ? 5 : types.includes("PERMISSION") ? 4 : 1;
  const privacy = safeties.includes("security_critical") ? 3 : 1;
  const dataIntegrity = types.some(t => ["DATA_SOURCE", "METRIC"].includes(t)) ? 4 : 1;
  const regulatory = safeties.includes("regulatory_critical") ? 5 : 1;
  const scope = SCOPE_BREADTH[scopeType] ?? 1;
  const operational = safeties.includes("operational") ? 3 : 2;
  const complexity = Math.min(5, Math.max(1, objs.length));
  const dependency = Math.min(5, objs.reduce((n, o) => n + ((o.dependencies ?? []).length), 0) || 1);
  const reversibility = 2; // configuration changes are inherently reversible (draft/publish/rollback)

  // §11 weighted score.
  const score = clinicalSafety * 3 + security * 3 + privacy * 2 + dataIntegrity * 2 + regulatory * 2 + scope + operational + complexity + dependency + reversibility;
  const riskLevel = changeType === "emergency" ? "critical" : score >= 55 ? "critical" : score >= 38 ? "high" : score >= 22 ? "moderate" : "low";

  const reviews = new Set<string>(["product", "technical"]);
  if (clinicalSafety >= 4) reviews.add("clinical_safety");
  if (security >= 4 || has(o => o.object_type === "PERMISSION")) reviews.add("security");
  if (privacy >= 3) reviews.add("privacy");
  if (dataIntegrity >= 4) reviews.add("data_governance");
  if (has(o => o.object_type === "AI_CAPABILITY" || /\bai\b|\.ai\.|ai_/i.test(o.object_key)) || changeType === "ai") reviews.add("ai_governance");
  if (["tenant", "hospital", "facility", "department", "unit"].includes(scopeType)) reviews.add("tenant_approval");
  if (["platform", "enterprise"].includes(scopeType)) reviews.add("enterprise_approval");
  if (["high", "critical"].includes(riskLevel)) reviews.add("release_manager");

  return { riskLevel, riskScore: score, requiredReviews: [...reviews] };
}

export async function loadGovernance(admin: any) {
  const res = await admin.from("configuration_change_requests")
    .select("id, cr_ref, title, scope_type, scope_ref, change_type, risk_level, risk_score, affected_objects, required_reviews, status, planned_release_date, requested_by_name, created_at, updated_at")
    .order("created_at", { ascending: false }).limit(500);
  if (res.error && missing(res.error)) return { provisioned: false as const };
  const crs = (res.error ? [] : res.data ?? []) as any[];

  let reviews: any[] = [];
  try {
    const ids = crs.map(c => c.id);
    if (ids.length) { const { data } = await admin.from("configuration_change_reviews").select("cr_id, review_type, decision, reviewer_name, created_at").in("cr_id", ids).limit(5000); reviews = data ?? []; }
  } catch { /* fail-soft */ }
  const completedByCr = new Map<string, Set<string>>();
  reviews.filter(r => r.decision !== "pending").forEach(r => { if (!completedByCr.has(r.cr_id)) completedByCr.set(r.cr_id, new Set()); completedByCr.get(r.cr_id)!.add(r.review_type); });

  const OPEN = ["draft", "submitted", "under_review", "changes_requested", "approved", "scheduled", "publishing", "verification"];
  const open = crs.filter(c => OPEN.includes(c.status));
  const st = (s: string) => crs.filter(c => c.status === s).length;
  const risk = (r: string) => crs.filter(c => c.risk_level === r && OPEN.includes(c.status)).length;

  // Review workload — pending review types across open CRs (required minus completed).
  const workload = new Map<string, number>();
  open.forEach(c => { const done = completedByCr.get(c.id) ?? new Set(); (c.required_reviews ?? []).forEach((rt: string) => { if (!done.has(rt)) workload.set(rt, (workload.get(rt) ?? 0) + 1); }); });

  const stats = {
    openChangeRequests: open.length,
    draft: st("draft"), awaitingReview: st("submitted") + st("under_review"), awaitingApproval: crs.filter(c => c.status === "under_review").length,
    approvedAwaitingRelease: st("approved") + st("scheduled"),
    published: st("published") + st("verified") + st("closed"),
    emergency: crs.filter(c => c.change_type === "emergency" && OPEN.includes(c.status)).length,
    rolledBack: st("rolled_back"), failed: st("failed"),
    highRisk: crs.filter(c => ["high", "critical"].includes(c.risk_level) && OPEN.includes(c.status)).length,
    byRisk: { low: risk("low"), moderate: risk("moderate"), high: risk("high"), critical: risk("critical") },
    reviewWorkload: [...workload.entries()].map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n),
    // Health indicators (§7.5) — honest from the store.
    rollbackRate: crs.length ? Math.round((st("rolled_back") / crs.length) * 100) : 0,
    emergencyRate: crs.length ? Math.round((crs.filter(c => c.change_type === "emergency").length / crs.length) * 100) : 0,
  };

  const list = crs.slice(0, 30).map(c => ({ ...c, reviewsDone: (completedByCr.get(c.id)?.size ?? 0), reviewsTotal: (c.required_reviews ?? []).length }));

  let auditRecent: any[] = [];
  try { const { data } = await admin.from("configuration_governance_audit").select("cr_ref, action, actor_name, created_at").order("created_at", { ascending: false }).limit(8); auditRecent = data ?? []; } catch { /* fail-soft */ }

  return { provisioned: true as const, stats, list, auditRecent };
}
