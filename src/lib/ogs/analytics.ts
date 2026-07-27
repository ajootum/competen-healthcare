// OGS-005 Office Performance & Governance Analytics — the measurement lens over the Office Governance
// System. This v1 grounds the analytics surface in the EXISTING real governance stores: governance_committees
// = offices, committee_members = appointments (chair + quorum), change_requests = governance decisions,
// adm_delegations = delegations, and quality_score_snapshots = the immutable score history used for the
// governance performance trend. Every metric is a transparent composite over those rows — no fabricated
// numbers. Meeting attendance, quorum-achievement and decision-cycle-time metrics require the next-phase
// meetings + ogs_offices model; peer benchmarking is next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/office-governance/_ui";

// change_requests is a global register; scope it to governance-relevant entities like the command centre does
// so "Decisions made" reconciles with OGS-000.
const GOV_RE = /competency|framework|policy|standard|governance|committee|office|accreditation|credential|competen/i;
const KIND_TONE: Record<string, string> = { major: "rose", minor: "blue", revision: "amber" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function loadOgsAnalytics(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Offices = governance_committees (primary read — provisioned gate).
  const { data: officeRows, error } = await scope(admin.from("governance_committees").select("id, name, level, quorum, is_active").limit(3000));
  if (error) return { provisioned: false as const };
  const offices = (officeRows ?? []) as any[];
  const ids = offices.map(o => o.id);

  // Appointments = committee_members (scoped via committee_id ∈ scoped offices).
  let members: any[] = [];
  if (ids.length) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from("committee_members").select("committee_id, role").in("committee_id", ids.slice(i, i + 200)).limit(20000);
      members = members.concat(data ?? []);
    }
  }
  const byOffice = new Map<string, { total: number; chairs: number }>();
  members.forEach(m => { const r = byOffice.get(m.committee_id) ?? { total: 0, chairs: 0 }; r.total++; if (m.role === "chair") r.chairs++; byOffice.set(m.committee_id, r); });

  // Office Health Score composite (transparent): active(40) + hasChair(30) + atQuorum(30).
  const officeCards = offices.map(o => {
    const m = byOffice.get(o.id) ?? { total: 0, chairs: 0 };
    const hasChair = m.chairs > 0;
    const atQuorum = m.total >= (Number(o.quorum) || 1);
    const active = !!o.is_active;
    const health = (active ? 40 : 0) + (hasChair ? 30 : 0) + (atQuorum ? 30 : 0);
    return { id: o.id, name: o.name, level: o.level ?? null, members: m.total, quorum: Number(o.quorum) || 1, active, hasChair, atQuorum, health };
  }).sort((a, b) => b.health - a.health);

  const total = offices.length;
  const activeOffices = officeCards.filter(o => o.active).length;
  const overallHealth = total ? Math.round(officeCards.reduce((a, o) => a + o.health, 0) / total) : null;

  // Compliance: compliant = active + chaired + at-quorum; partial = active missing one; non = inactive.
  const compliant = officeCards.filter(o => o.active && o.hasChair && o.atQuorum).length;
  const nonCompliant = officeCards.filter(o => !o.active).length;
  const partial = total - compliant - nonCompliant;
  const complianceRate = total ? Math.round((compliant / total) * 100) : null;
  const attention = officeCards.filter(o => o.active && (!o.hasChair || !o.atQuorum)).length;

  // Decisions = change_requests (global register, governance-relevant only — reconciles with OGS-000).
  let decisions: any[] = [];
  try { const { data } = await admin.from("change_requests").select("entity_type, change_kind, status, created_at").order("created_at", { ascending: false }).limit(500); decisions = ((data ?? []) as any[]).filter(c => GOV_RE.test(String(c.entity_type))); } catch { /* optional */ }
  const decisionsMade = decisions.filter(c => ["approved", "implemented"].includes(c.status)).length;
  const kindMap = new Map<string, number>();
  decisions.forEach(c => { const k = c.change_kind ?? "minor"; kindMap.set(k, (kindMap.get(k) ?? 0) + 1); });
  const decisionsByType = [...kindMap.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k[0].toUpperCase() + k.slice(1), value: v, tone: KIND_TONE[k] ?? "slate" }));

  // Delegations = adm_delegations (scoped).
  let delegations: any[] = [];
  try { const { data } = await scope(admin.from("adm_delegations").select("status").limit(3000)); delegations = (data ?? []) as any[]; } catch { /* optional */ }
  const activeDelegations = delegations.filter(d => d.status === "active").length;

  // Composite dimensions (0-100) that roll up into the Office Health Score.
  const rate = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const healthDimensions = [
    { label: "Active rate", pct: rate(activeOffices), tone: "emerald" },
    { label: "Chaired rate", pct: rate(officeCards.filter(o => o.hasChair).length), tone: "violet" },
    { label: "At-quorum rate", pct: rate(officeCards.filter(o => o.atQuorum).length), tone: "blue" },
    { label: "Decision throughput", pct: decisions.length ? Math.round((decisionsMade / decisions.length) * 100) : 0, tone: "teal" },
  ];

  // Governance performance trend = quality_score_snapshots health_score by month (scoped). Honest if < 2 months.
  let snaps: any[] = [];
  try { const { data } = await scope(admin.from("quality_score_snapshots").select("snapshot_date, health_score, compliance_score").order("snapshot_date", { ascending: true }).limit(5000)); snaps = (data ?? []) as any[]; } catch { /* optional */ }
  const monthMap = new Map<string, { sum: number; n: number }>();
  snaps.forEach(s => {
    const v = s.health_score ?? s.compliance_score;
    if (v == null) return;
    const ym = String(s.snapshot_date ?? "").slice(0, 7);
    if (ym.length !== 7) return;
    const r = monthMap.get(ym) ?? { sum: 0, n: 0 };
    r.sum += Number(v); r.n++; monthMap.set(ym, r);
  });
  const monthsSorted = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const trendPoints = monthsSorted.map(([, v]) => Math.round(v.sum / v.n));
  const trendLabels = monthsSorted.map(([ym]) => { const [y, m] = ym.split("-"); return `${MONTHS[Number(m) - 1] ?? m} ${y.slice(2)}`; });
  const hasTrend = trendPoints.length >= 2;

  return {
    provisioned: true as const,
    kpis: { overallHealth, offices: total, decisionsMade, complianceRate, activeDelegations, attention },
    healthDimensions,
    topOffices: officeCards.slice(0, 8),
    compliance: { rate: complianceRate, compliant, partial, nonCompliant, total },
    hasTrend, trendPoints, trendLabels,
    decisionsByType, totalDecisions: decisions.length,
  };
}
