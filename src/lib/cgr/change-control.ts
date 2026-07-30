/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-004 — Competency Change Control & Lifecycle Management Engine.
// "What changed, why, who is affected, and how is it safely implemented?" — the change-control + impact +
// versioning workspace over real stores:
//   • change_requests (mig 012)  — the change log: change_kind (major/minor/revision), rationale, impact_summary
//     (jsonb), status (open/approved/rejected/implemented), effective_date. The controlled-change register.
//   • frameworks (mig 012/127)   — semantic version (major.minor.revision) + pub_status lifecycle + review_date.
//   • frameworkImpact() (engines/impact) — the Impact Assessment Engine (§8): downstream blast radius of a
//     change (domains→CPUs→competencies→skills→blueprints→evidence→cycles→decisions + knowledge_edges).
// It joins change control to impact analysis — which no surface does today. Impact is computed for the frameworks
// with OPEN change requests first (the changes actually in flight), topped up with the largest frameworks.
// No migration; read model. Nothing fabricated — absent impact_summary / versions render as gaps.

import { frameworkImpact, type ImpactReport } from "@/lib/engines/impact";

type Admin = any;
const todayISO = () => new Date().toISOString().slice(0, 10);
const PUB_ORDER = ["draft", "in_review", "approved", "published", "archived"] as const;
const IMPACT_TARGETS = 5;

export async function loadChangeControl(admin: Admin) {
  const today = todayISO();

  const [crRes, fwRes] = await Promise.all([
    admin.from("change_requests").select("id, entity_type, entity_id, entity_name, change_kind, status, rationale, impact_summary, requested_by_name, effective_date, created_at").order("created_at", { ascending: false }).limit(500),
    admin.from("frameworks").select("id, name, version_major, version_minor, version_revision, version_num, pub_status, review_date").limit(300),
  ]);

  const crs = (crRes.error ? [] : crRes.data ?? []) as any[];
  const fws = (fwRes.error ? [] : fwRes.data ?? []) as any[];
  const provisioned = crs.length > 0 || fws.length > 0;

  // Change log aggregates.
  const byStatus = { open: 0, approved: 0, rejected: 0, implemented: 0 };
  const byKind = { major: 0, minor: 0, revision: 0 };
  for (const c of crs) {
    if (c.status in byStatus) (byStatus as any)[c.status]++;
    if (c.change_kind in byKind) (byKind as any)[c.change_kind]++;
  }
  const closed = byStatus.approved + byStatus.rejected + byStatus.implemented;
  const throughWorkflowPct = crs.length ? Math.round(((byStatus.approved + byStatus.implemented) / crs.length) * 100) : null;
  const withImpact = crs.filter((c) => c.impact_summary && Object.keys(c.impact_summary).length > 0).length;

  const changeLog = crs.slice(0, 14).map((c) => ({
    id: c.id,
    name: c.entity_name ?? "—",
    entityType: c.entity_type,
    kind: c.change_kind ?? "revision",
    status: c.status,
    rationale: c.rationale ?? null,
    hasImpact: !!(c.impact_summary && Object.keys(c.impact_summary).length > 0),
    requestedBy: c.requested_by_name ?? null,
    effectiveDate: c.effective_date ?? null,
    createdAt: c.created_at,
  }));

  // Framework lifecycle funnel + version integrity.
  const lifecycle = PUB_ORDER.map((s) => ({ status: s, count: fws.filter((f) => (f.pub_status ?? "draft") === s).length }));
  const versioned = fws.filter((f) => (f.version_major ?? 0) > 0 || (f.version_minor ?? 0) > 0 || (f.version_revision ?? 0) > 0).length;
  const overdueReviews = fws.filter((f) => f.review_date && f.review_date < today).length;
  const retired = fws.filter((f) => f.pub_status === "archived").length;

  const versions = fws
    .map((f) => ({ id: f.id, name: f.name, version: `${f.version_major ?? 1}.${f.version_minor ?? 0}.${f.version_revision ?? 0}`, pubStatus: f.pub_status ?? "draft", reviewDate: f.review_date ?? null, reviewOverdue: !!(f.review_date && f.review_date < today) }))
    .sort((a, b) => Number(b.reviewOverdue) - Number(a.reviewOverdue) || a.name.localeCompare(b.name))
    .slice(0, 12);

  // Impact assessment — frameworks with open changes first, then largest.
  const openFwIds = [...new Set(crs.filter((c) => c.status === "open" && c.entity_type === "framework" && c.entity_id).map((c) => c.entity_id))];
  const targetIds = [...new Set([...openFwIds, ...fws.map((f) => f.id)])].slice(0, IMPACT_TARGETS);
  const reports = await Promise.all(
    targetIds.map((id) => frameworkImpact(admin, id).catch(() => null as ImpactReport | null)),
  );
  const impacts = reports
    .filter((r): r is ImpactReport => !!r)
    .map((r) => ({
      id: r.entity.id,
      name: r.entity.name,
      hasOpenChange: openFwIds.includes(r.entity.id),
      blastRadius: r.affected.reduce((s, a) => s + a.count, 0),
      affected: r.affected.map((a) => ({ label: a.label, count: a.count })),
      edges: r.edges.length,
    }))
    .sort((a, b) => Number(b.hasOpenChange) - Number(a.hasOpenChange) || b.blastRadius - a.blastRadius);

  return {
    provisioned,
    kpis: {
      totalChanges: crs.length,
      open: byStatus.open,
      implemented: byStatus.implemented + byStatus.approved,
      throughWorkflowPct,
      withImpactPct: crs.length ? Math.round((withImpact / crs.length) * 100) : null,
      frameworks: fws.length,
      versioned,
      overdueReviews,
      retired,
    },
    byStatus,
    byKind,
    closed,
    changeLog,
    lifecycle,
    versions,
    impacts,
  };
}
