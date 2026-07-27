// CMO-003 Office Membership & Role Management — the Competency Office as a governed OBJECT: establish,
// staff, govern and empower competency offices (governance_committees) via their members
// (committee_members: chair / member / reviewer) plus acting-authority delegations (adm_delegations).
// Read model over the real committee substrate; tenant-scoped (committees + delegations carry hospital_id;
// members scope via committee_id ∈ the scoped committees). Appointment / delegation write-engines are next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
// governance_committees.level → tone.
const LEVEL_TONE: Record<string, string> = { enterprise: "violet", country: "blue", facility: "teal", department: "emerald", specialty: "amber" };
// committee_members.role → tone (only the 3 real enum roles).
const ROLE_TONE: Record<string, string> = { chair: "violet", member: "teal", reviewer: "blue" };

export async function loadCmoMembership(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Provisioning probe = governance_committees (the "Competency Office" object). Error or empty → not provisioned.
  let committees: any[] = [];
  try {
    const { data, error } = await scope(admin.from("governance_committees").select("id, name, level, organisation_id, hospital_id, quorum, is_active, created_at").order("created_at", { ascending: true }));
    if (error) return { provisioned: false as const };
    committees = (data ?? []) as any[];
  } catch {
    return { provisioned: false as const };
  }
  if (!committees.length) return { provisioned: false as const };
  const committeeIds = committees.map(c => c.id);

  // Members — committee_members has no hospital_id, so scope via committee_id ∈ the scoped committees.
  let members: any[] = [];
  try {
    const { data } = await admin.from("committee_members").select("id, committee_id, profile_id, role, created_at").in("committee_id", committeeIds).order("created_at", { ascending: false });
    members = (data ?? []) as any[];
  } catch { /* members optional */ }

  // Delegations — adm_delegations (acting managers / temporary authority). Fail-soft → 0 if the table is absent.
  let delegations: any[] = [];
  let delegationsTableOk = false;
  try {
    const { data, error } = await scope(admin.from("adm_delegations").select("id, position, delegate_id, delegated_by, valid_from, valid_to, status, created_at").order("created_at", { ascending: false }));
    if (!error) { delegations = (data ?? []) as any[]; delegationsTableOk = true; }
  } catch { /* delegations store optional */ }

  // Resolve names for members + delegates in one lookup.
  const pids = [...new Set([
    ...members.map(m => m.profile_id),
    ...delegations.map(dg => dg.delegate_id),
    ...delegations.map(dg => dg.delegated_by),
  ].filter(Boolean))];
  const nameById = new Map<string, string>();
  if (pids.length) {
    try {
      const { data } = await admin.from("profiles").select("id, full_name").in("id", pids);
      (data ?? []).forEach((p: any) => nameById.set(p.id, p.full_name));
    } catch { /* names optional */ }
  }

  // Per-office rollup: members, chair, quorum health.
  const memByCommittee = new Map<string, any[]>();
  members.forEach(m => { const arr = memByCommittee.get(m.committee_id) ?? []; arr.push(m); memByCommittee.set(m.committee_id, arr); });
  const offices = committees.map(c => {
    const cm = memByCommittee.get(c.id) ?? [];
    const chairMembers = cm.filter(m => m.role === "chair");
    const quorum = Number(c.quorum ?? 0) || 0;
    const memberCount = cm.length;
    const meetsQuorum = memberCount >= quorum;
    const hasChair = chairMembers.length > 0;
    return {
      id: c.id, name: c.name, level: c.level ?? "facility", quorum,
      active: c.is_active !== false, memberCount, hasChair,
      chairCount: chairMembers.length,
      chairName: chairMembers[0] ? (nameById.get(chairMembers[0].profile_id) ?? "—") : null,
      established: c.created_at, meetsQuorum, compliant: hasChair && meetsQuorum,
    };
  });

  // Role tallies (only the 3 real enum roles; strays fall into the operational "member" bucket so the donut sums to total).
  const chairs = members.filter(m => m.role === "chair").length;
  const reviewers = members.filter(m => m.role === "reviewer").length;
  const regularMembers = members.length - chairs - reviewers;
  const distinctMembers = new Set(members.map(m => m.profile_id).filter(Boolean)).size;

  const officesNoChair = offices.filter(o => !o.hasChair).length;
  const belowQuorum = offices.filter(o => !o.meetsQuorum).length;
  const compliantOffices = offices.filter(o => o.compliant).length;
  const compliancePct = offices.length ? Math.round((compliantOffices / offices.length) * 100) : 0;
  const delegationsActive = delegationsTableOk ? delegations.filter(d => d.status === "active").length : null;

  // Membership-by-role donut (Governance / Operational / Reviewers → the 3 real roles).
  const roleDonut = [
    { label: "Governance · Chairs", value: chairs, color: "#a855f7" },
    { label: "Operational · Members", value: regularMembers, color: "#14b8a6" },
    { label: "Reviewers", value: reviewers, color: "#3b82f6" },
  ];

  // Recent membership activity — committee_members appointments + adm_delegations, merged & sorted desc.
  const nameOfCommittee = new Map<string, string>(committees.map(c => [c.id, c.name]));
  const activity: { who: string; role: string; what: string; when: string; kind: string }[] = [];
  members.forEach(m => activity.push({ who: nameById.get(m.profile_id) ?? "—", role: m.role ?? "member", what: nameOfCommittee.get(m.committee_id) ?? "office", when: m.created_at, kind: "membership" }));
  delegations.forEach(dg => activity.push({ who: nameById.get(dg.delegate_id) ?? "—", role: "delegation", what: dg.position ?? "authority", when: dg.created_at, kind: "delegation" }));
  activity.sort((a, b) => String(b.when ?? "").localeCompare(String(a.when ?? "")));
  const recentActivity = activity.slice(0, 6);

  // AI Office Administration Copilot — rule-based, explainable, derived from live signals.
  const copilot: { title: string; detail: string; impact: string; tone: string }[] = [];
  if (officesNoChair) copilot.push({ title: "Appoint chairs to uncovered offices", detail: `${officesNoChair} office${officesNoChair > 1 ? "s have" : " has"} no chair — governance coverage gap`, impact: "high", tone: "rose" });
  if (belowQuorum) copilot.push({ title: "Staff offices below quorum", detail: `${belowQuorum} office${belowQuorum > 1 ? "s are" : " is"} below the configured quorum — membership gap`, impact: "high", tone: "amber" });
  const singleChair = offices.filter(o => o.chairCount === 1).length;
  if (singleChair) copilot.push({ title: "Mitigate chair succession risk", detail: `${singleChair} office${singleChair > 1 ? "s rely" : " relies"} on a single chair — appoint a deputy`, impact: "medium", tone: "amber" });
  const busiest = [...offices].sort((a, b) => b.memberCount - a.memberCount)[0];
  if (busiest && busiest.memberCount > 0) copilot.push({ title: "Review workload concentration", detail: `${busiest.name} carries the most members (${busiest.memberCount}) — consider rebalancing`, impact: "low", tone: "blue" });
  if (!copilot.length) copilot.push({ title: "Membership governance healthy", detail: "Every office has a chair and meets its quorum", impact: "low", tone: "emerald" });

  // Optional: surface a couple of stored AI recommendations if the table exists (fail-soft).
  let aiRecs: any[] = [];
  try {
    const { data } = await scope(admin.from("adm_ai_recommendations").select("title, detail, category, impact, status, created_at").order("created_at", { ascending: false }));
    aiRecs = ((data ?? []) as any[]).filter(r => r.status === "open").slice(0, 3);
  } catch { /* AI store optional */ }

  return {
    provisioned: true as const,
    kpis: { offices: offices.length, members: distinctMembers, chairs, reviewers, delegationsActive, compliancePct, officesNoChair, belowQuorum },
    primaryOffice: offices[0] ?? null,
    roleDonut, roleTotal: members.length,
    offices, recentActivity, copilot, aiRecs,
    delegationsTableOk,
    levelTone: LEVEL_TONE, roleTone: ROLE_TONE,
  };
}
