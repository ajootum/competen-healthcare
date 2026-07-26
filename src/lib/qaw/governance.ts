// QAW-011 Quality Governance & Committee Centre — committees, decisions, oversight.
// Grounded in governance_committees + committee_members (012, hospital-scoped) and change_requests
// (012, the global governance change/decision register — no tenant column by design). Meeting minutes,
// board reporting and a governance-maturity model have no store yet → reported honestly as next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEVEL_TONE: Record<string, string> = { enterprise: "violet", country: "indigo", facility: "teal", department: "blue", specialty: "amber" };

export async function loadGovernance(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const { data: cmtRows, error } = await scope(admin.from("governance_committees").select("id, name, level, quorum, is_active").limit(2000));
  if (error) return { provisioned: false as const };
  const committees = (cmtRows ?? []) as any[];
  const cmtIds = committees.map(c => c.id);

  let members: any[] = [];
  if (cmtIds.length) {
    for (let i = 0; i < cmtIds.length; i += 200) {
      const { data } = await admin.from("committee_members").select("committee_id, profile_id, role").in("committee_id", cmtIds.slice(i, i + 200)).limit(20000);
      members = members.concat(data ?? []);
    }
  }
  const memByCmt = new Map<string, { total: number; chairs: number }>();
  members.forEach(m => { const r = memByCmt.get(m.committee_id) ?? { total: 0, chairs: 0 }; r.total++; if (m.role === "chair") r.chairs++; memByCmt.set(m.committee_id, r); });

  // Governance change/decision register (global).
  const { data: crRows } = await admin.from("change_requests").select("entity_type, entity_name, change_kind, status, requested_by_name, effective_date, created_at").order("created_at", { ascending: false }).limit(3000);
  const changes = (crRows ?? []) as any[];

  // Policies under review (reuse controlled-doc store; optional).
  let policiesUnderReview = 0;
  try { const { data } = await scope(admin.from("adm_documents").select("status").in("status", ["in_review", "pending_approval"]).limit(3000)); policiesUnderReview = (data ?? []).length; } catch { /* optional */ }

  const activeCommittees = committees.filter(c => c.is_active).length;
  const distinctMembers = new Set(members.map(m => m.profile_id)).size;
  const st = (s: string) => changes.filter(c => c.status === s).length;

  const levelDonut = ["enterprise", "country", "facility", "department", "specialty"].map(l => ({ label: l[0].toUpperCase() + l.slice(1), value: committees.filter(c => c.level === l).length, tone: LEVEL_TONE[l] })).filter(x => x.value > 0);
  const kindDonut = ["major", "minor", "revision"].map((k, i) => ({ label: k[0].toUpperCase() + k.slice(1), value: changes.filter(c => c.change_kind === k).length, tone: ["rose", "blue", "amber"][i] })).filter(x => x.value > 0);
  const statusBars = [
    { label: "Open", value: st("open"), tone: "amber" },
    { label: "Approved", value: st("approved"), tone: "blue" },
    { label: "Implemented", value: st("implemented"), tone: "emerald" },
    { label: "Rejected", value: st("rejected"), tone: "rose" },
  ];

  // Decisions trend (per month).
  const now = new Date();
  const buckets: { key: string; label: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()], value: 0 }); }
  const bk = new Map(buckets.map(b => [b.key, b]));
  changes.forEach(c => { const b = bk.get(String(c.created_at).slice(0, 7)); if (b) b.value++; });

  return {
    provisioned: true as const,
    kpis: { committees: activeCommittees, totalCommittees: committees.length, members: distinctMembers, decisions: changes.length, pending: st("open"), implemented: st("implemented"), policiesUnderReview },
    committees: committees.map(c => ({ name: c.name, level: c.level, members: memByCmt.get(c.id)?.total ?? 0, chairs: memByCmt.get(c.id)?.chairs ?? 0, quorum: c.quorum, active: c.is_active })).sort((a, b) => b.members - a.members),
    levelDonut, kindDonut, statusBars, trend: buckets,
    recent: changes.slice(0, 7).map(c => ({ entity: c.entity_name ?? c.entity_type, kind: c.change_kind, status: c.status, by: c.requested_by_name, when: c.effective_date ?? c.created_at })),
  };
}
