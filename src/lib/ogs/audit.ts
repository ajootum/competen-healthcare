// OGS-008 Office Audit, Records & Compliance. Real over the immutable audit trail (audit_log, 040 — PRIMARY),
// governance obligations (gov_obligations, 059 — compliance), the domain-event backbone (domain_events, 102 —
// immutable event count) and the quality compliance-score snapshots (quality_score_snapshots, 091 — 6-month
// trend). A dedicated governance-records repository with retention schedules, legal hold and digital signatures
// is the next-phase OGS-008 record-management layer — only the audit TRAIL and obligations are real today.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/office-governance/_ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CAT_TONES = ["teal", "blue", "indigo", "violet", "amber", "emerald"];
const ASSESSED = ["compliant", "at_risk", "non_compliant"]; // obligations with a compliance verdict (excludes not_assessed / waived)

export async function loadOgsAudit(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // PRIMARY: audit_log head count = provisioning probe + total records.
  const totalRes = await scope(admin.from("audit_log").select("id", { count: "exact", head: true }));
  if (totalRes.error) return { provisioned: false as const };
  const totalRecords = totalRes.count ?? 0;

  // Audit-trail events in the last 90 days (head count).
  const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const recentRes = await scope(admin.from("audit_log").select("id", { count: "exact", head: true }).gte("created_at", since90));
  const events90 = recentRes.count ?? 0;

  // Recent audit_log rows → category distribution (by entity_type) + activity feed.
  const { data: logRows } = await scope(admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(4000));
  const logs = (logRows ?? []) as any[];

  const catMap = new Map<string, number>();
  logs.forEach(l => { const key = l.entity_type ?? "—"; catMap.set(key, (catMap.get(key) ?? 0) + 1); });
  const sortedCats = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
  const top = sortedCats.slice(0, 6).map(([label, value], i) => ({ label, value, tone: CAT_TONES[i % CAT_TONES.length] }));
  const otherVal = sortedCats.slice(6).reduce((s, [, v]) => s + v, 0);
  const categories = otherVal > 0 ? [...top, { label: "Other", value: otherVal, tone: "slate" }] : top;
  const catTotal = categories.reduce((s, c) => s + c.value, 0);

  const recentActivity = logs.slice(0, 10).map(l => ({
    when: l.created_at,
    actor: l.actor_name,
    action: String(l.action ?? "").replace(/_/g, " "),
    entityType: l.entity_type,
    entityName: l.entity_name,
  }));

  // Domain-event backbone head count (immutable events) — optional store.
  let domainEvents = 0;
  try { const r = await scope(admin.from("domain_events").select("id", { count: "exact", head: true })); if (!r.error) domainEvents = r.count ?? 0; } catch { /* optional */ }

  // Governance obligations → compliance rate, compliant count, per-domain compliance — optional store.
  let obligations: any[] = [];
  try { const { data } = await scope(admin.from("gov_obligations").select("title, domain, owner_name, review_frequency, effective_date, expiry_date, status, risk_rating, framework_id").limit(5000)); obligations = (data ?? []) as any[]; } catch { /* optional */ }
  const compliantCount = obligations.filter(o => o.status === "compliant").length;
  const assessedCount = obligations.filter(o => ASSESSED.includes(o.status)).length;
  const complianceRate = assessedCount ? Math.round((compliantCount / assessedCount) * 100) : null;

  const domMap = new Map<string, { total: number; compliant: number }>();
  obligations.forEach(o => { const key = o.domain ?? "—"; const r = domMap.get(key) ?? { total: 0, compliant: 0 }; r.total++; if (o.status === "compliant") r.compliant++; domMap.set(key, r); });
  const frameworks = [...domMap.entries()].sort((a, b) => b[1].total - a[1].total)
    .map(([label, v]) => ({ label, total: v.total, compliant: v.compliant, pct: v.total ? Math.round((v.compliant / v.total) * 100) : 0 }));

  // 6-month compliance-score trend from quality_score_snapshots (monthly average) — optional store.
  let snaps: any[] = [];
  try { const { data } = await scope(admin.from("quality_score_snapshots").select("snapshot_date, compliance_score").order("snapshot_date", { ascending: true }).limit(2000)); snaps = (data ?? []) as any[]; } catch { /* optional */ }
  const monthAgg = new Map<string, { sum: number; n: number }>();
  snaps.forEach(s => {
    if (s.compliance_score == null) return;
    const key = String(s.snapshot_date ?? "").slice(0, 7);
    if (!key) return;
    const r = monthAgg.get(key) ?? { sum: 0, n: 0 };
    r.sum += Number(s.compliance_score); r.n++;
    monthAgg.set(key, r);
  });
  const complianceTrend = [...monthAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6)
    .map(([key, v]) => ({ label: MONTHS[Number(key.slice(5, 7)) - 1], value: Math.round(v.sum / v.n) }));

  return {
    provisioned: true as const,
    empty: totalRecords === 0,
    kpis: { totalRecords, events90, complianceRate, compliantCount, assessedCount, domainEvents, frameworkCount: frameworks.length },
    categories, catTotal,
    complianceTrend,
    recentActivity,
    frameworks,
  };
}
