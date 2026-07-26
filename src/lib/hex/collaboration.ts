// HEX-011 Executive Collaboration & Governance — committees, decisions, approvals, governance priorities.
// Grounded in governance_committees + committee_members (012, scoped) + change_requests (012, global
// decision register) + the ppe_* approval/objective substrate (fetchFramework). Board management, meeting
// minutes and attendance have no store yet → reported honestly as next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchFramework } from "@/lib/priorities/engine";

const NONE = "00000000-0000-0000-0000-000000000000";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEVEL_TONE: Record<string, string> = { enterprise: "violet", country: "indigo", facility: "teal", department: "blue", specialty: "amber" };

export async function loadExecCollaboration(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Committees + membership.
  let committees: any[] = [], members: any[] = [];
  try {
    const { data } = await scope(admin.from("governance_committees").select("id, name, level, is_active").limit(2000));
    committees = (data ?? []) as any[];
    if (committees.length) {
      const ids = committees.map(c => c.id);
      for (let i = 0; i < ids.length; i += 200) { const { data: m } = await admin.from("committee_members").select("committee_id, profile_id").in("committee_id", ids.slice(i, i + 200)).limit(20000); members = members.concat(m ?? []); }
    }
  } catch { /* optional */ }

  // Decision / change register (global).
  const { data: crRows } = await admin.from("change_requests").select("entity_type, entity_name, change_kind, status, requested_by_name, effective_date, created_at").order("created_at", { ascending: false }).limit(3000);
  const changes = (crRows ?? []) as any[];
  const decisionsMade = changes.filter(c => ["approved", "implemented"].includes(c.status)).length;

  // Framework — objectives (governance priorities) + approvals.
  const fw = await fetchFramework(admin).catch(() => ({ provisioned: false }) as any);
  const objectives = fw.provisioned ? (fw.objectives ?? []).filter((o: any) => o.status === "published") : [];
  const fwApprovalsPending = fw.provisioned ? (fw.approvals ?? []).filter((a: any) => a.state === "pending").length : 0;
  const pendingApprovals = changes.filter(c => c.status === "open").length + fwApprovalsPending;

  // Governance health — committees active + decision throughput + priorities on-track.
  const parts: number[] = [];
  if (committees.length) parts.push((committees.filter(c => c.is_active).length / committees.length) * 100);
  if (changes.length) parts.push((decisionsMade / changes.length) * 100);
  if (objectives.length) parts.push((objectives.filter((o: any) => Number(o.progress_pct) >= 60).length / objectives.length) * 100);
  const health = parts.length ? Math.round(parts.reduce((s, x) => s + x, 0) / parts.length) : null;

  // Activity trend — decisions logged per month.
  const now = new Date();
  const buckets: { key: string; label: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()], value: 0 }); }
  const bk = new Map(buckets.map(b => [b.key, b]));
  changes.forEach(c => { const b = bk.get(String(c.created_at).slice(0, 7)); if (b) b.value++; });

  const st = (s: string) => changes.filter(c => c.status === s).length;
  const levelDonut = ["enterprise", "country", "facility", "department", "specialty"].map(l => ({ label: l[0].toUpperCase() + l.slice(1), value: committees.filter(c => c.level === l).length, tone: LEVEL_TONE[l] })).filter(x => x.value > 0);

  return {
    provisioned: true as const,
    kpis: {
      health, decisionsMade, pendingApprovals,
      committees: committees.filter(c => c.is_active).length, totalCommittees: committees.length,
      members: new Set(members.map(m => m.profile_id)).size,
      prioritiesOnTrack: objectives.length ? Math.round((objectives.filter((o: any) => Number(o.progress_pct) >= 60).length / objectives.length) * 100) : null,
    },
    trend: buckets,
    pipeline: [
      { label: "Needs decision", value: st("open"), tone: "amber" },
      { label: "Approved", value: st("approved"), tone: "blue" },
      { label: "Implemented", value: st("implemented"), tone: "emerald" },
      { label: "Rejected", value: st("rejected"), tone: "rose" },
    ],
    levelDonut,
    recentDecisions: changes.slice(0, 7).map(c => ({ item: c.entity_name ?? c.entity_type, kind: c.change_kind, status: c.status, by: c.requested_by_name, when: c.effective_date ?? c.created_at })),
    priorities: objectives.slice(0, 6).map((o: any) => ({ title: o.title, progress: Math.round(Number(o.progress_pct)), onTrack: Number(o.progress_pct) >= 60 })),
  };
}
