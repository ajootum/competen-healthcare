// OGS-003 Authority & Delegation Centre — manage office authority roles, delegations and approval powers.
// Grounds in the EXISTING real stores: adm_delegations (delegations, hospital/position-scoped),
// governance_committees = offices, committee_members = authority holders (role='chair' ⇒ full authority).
// Delegation "type" is DERIVED honestly from the data (open-ended valid_to ⇒ Permanent, else Time-limited);
// acting / emergency / scope-limited types, approval chains and conflict-of-interest checks do NOT exist in
// the data and are the next-phase OGS-003 engine (an office-scoped delegation table).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/office-governance/_ui";

const STATUS_ORDER: Record<string, number> = { active: 0, scheduled: 1, expired: 2, revoked: 3 };

export async function loadOgsDelegation(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // PRIMARY read — adm_delegations. If it errors the module is not provisioned.
  const { data: delRows, error } = await scope(admin.from("adm_delegations").select("id, position, delegate_id, delegated_by, valid_from, valid_to, status, created_at").limit(3000));
  if (error) return { provisioned: false as const };
  const del = (delRows ?? []) as any[];

  // Offices = governance_committees (authority hierarchy).
  const { data: officeRows } = await scope(admin.from("governance_committees").select("id, name, level, quorum, is_active").limit(3000));
  const offices = (officeRows ?? []) as any[];
  const officeIds = offices.map(o => o.id);

  // Authority holders = committee_members (chairs = full authority). Scoped via committee_id ∈ scoped offices.
  let members: any[] = [];
  if (officeIds.length) {
    for (let i = 0; i < officeIds.length; i += 200) {
      const { data } = await admin.from("committee_members").select("committee_id, profile_id, role").in("committee_id", officeIds.slice(i, i + 200)).limit(20000);
      members = members.concat(data ?? []);
    }
  }
  const byOffice = new Map<string, { total: number; chair: string | null }>();
  members.forEach((m: any) => { const r = byOffice.get(m.committee_id) ?? { total: 0, chair: null }; r.total++; if (m.role === "chair" && !r.chair) r.chair = m.profile_id; byOffice.set(m.committee_id, r); });

  // Resolve profile names for delegates, delegators and office chairs.
  const nameIds = [...new Set([...del.map(d => d.delegate_id), ...del.map(d => d.delegated_by), ...members.filter((m: any) => m.role === "chair").map((m: any) => m.profile_id)].filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  for (let i = 0; i < nameIds.length; i += 300) {
    const { data } = await admin.from("profiles").select("id, full_name").in("id", nameIds.slice(i, i + 300));
    (data ?? []).forEach((p: any) => nameById.set(p.id, p.full_name));
  }
  const nameOf = (id: any) => (id ? (nameById.get(id) ?? "—") : "—");

  // Date horizons (dates are 'YYYY-MM-DD' strings — compare lexically, diff via Date.parse UTC midnight).
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const active = del.filter(d => d.status === "active");
  const expiringSoon = active.filter(d => d.valid_to && d.valid_to >= today && d.valid_to <= in30).length;
  const delegatedApprovers = new Set(active.map(d => d.delegate_id).filter(Boolean)).size;

  // Authority coverage — % of ACTIVE offices that have a chair appointed (committee_members role='chair').
  const activeOffices = offices.filter(o => o.is_active);
  const activeChaired = activeOffices.filter(o => byOffice.get(o.id)?.chair).length;
  const authorityCoverage = activeOffices.length ? Math.round((activeChaired / activeOffices.length) * 100) : null;

  // Office authority structure — chair (full authority) + contributing member count.
  const officeCards = offices.map(o => {
    const m = byOffice.get(o.id) ?? { total: 0, chair: null };
    return { id: o.id, name: o.name, level: o.level, members: m.total, chair: m.chair ? (nameById.get(m.chair) ?? "Appointed") : null, active: o.is_active };
  }).sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.members - a.members);

  // Delegation register — active first, then scheduled / expired / revoked. Type derived from valid_to.
  const delegationRows = del.map(d => ({
    position: d.position ?? "—",
    delegate: nameOf(d.delegate_id),
    delegatedBy: nameOf(d.delegated_by),
    type: d.valid_to ? "Time-limited" : "Permanent",
    validFrom: d.valid_from ?? "—",
    validTo: d.valid_to ?? "—",
    status: d.status ?? "—",
  })).sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || String(b.validFrom).localeCompare(String(a.validFrom)));

  // Delegation-by-type (derived, real): Permanent (open-ended) vs Time-limited (has valid_to).
  const permanent = del.filter(d => !d.valid_to).length;
  const timeLimited = del.filter(d => d.valid_to).length;
  const byType = [
    { label: "Permanent", value: permanent, tone: "indigo" },
    { label: "Time-limited", value: timeLimited, tone: "amber" },
  ];

  // Upcoming expirations — active delegations with a valid_to in the next 60 days, soonest first.
  const expirations = active
    .filter(d => d.valid_to && d.valid_to >= today && d.valid_to <= in60)
    .sort((a, b) => String(a.valid_to).localeCompare(String(b.valid_to)))
    .map(d => {
      const daysLeft = Math.max(0, Math.round((Date.parse(d.valid_to) - Date.parse(today)) / 86400000));
      return { position: d.position ?? "—", delegate: nameOf(d.delegate_id), validTo: d.valid_to, daysLeft, tone: daysLeft <= 7 ? "rose" : daysLeft <= 30 ? "amber" : "blue" };
    });

  return {
    provisioned: true as const,
    kpis: { activeDelegations: active.length, expiringSoon, delegatedApprovers, authorityCoverage, totalDelegations: del.length },
    offices: officeCards.slice(0, 8),
    delegationRows: delegationRows.slice(0, 14),
    byType,
    expirations: expirations.slice(0, 7),
  };
}
