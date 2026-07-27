// OGS-000 Office Governance System — the horizontal governance platform. This v1 grounds the OGS surface
// in the EXISTING real governance stores: governance_committees = offices, committee_members = appointments,
// adm_delegations = delegations, change_requests = governance decisions, audit_log = governance events.
// The full OGS domain model (ogs_offices + charters + meetings + votes + lifecycle transitions) and the
// write-workflows (constitute / appoint / delegate / dissolve) are the next-phase foundation migration.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/office-governance/_ui";

const LEVEL_TONE: Record<string, string> = { enterprise: "violet", country: "indigo", facility: "teal", department: "blue", specialty: "amber" };
const GOV_RE = /competency|framework|policy|standard|governance|committee|office|accreditation|credential|competen/i;

export async function loadOgsCommandCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Offices = governance_committees.
  const { data: officeRows, error } = await scope(admin.from("governance_committees").select("id, name, level, quorum, is_active, created_at").limit(3000));
  if (error) return { provisioned: false as const };
  const offices = (officeRows ?? []) as any[];
  const ids = offices.map(o => o.id);

  // Appointments = committee_members.
  let members: any[] = [];
  if (ids.length) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from("committee_members").select("committee_id, profile_id, role, created_at").in("committee_id", ids.slice(i, i + 200)).limit(20000);
      members = members.concat(data ?? []);
    }
  }
  const byOffice = new Map<string, { total: number; chairs: string[] }>();
  members.forEach(m => { const r = byOffice.get(m.committee_id) ?? { total: 0, chairs: [] }; r.total++; if (m.role === "chair") r.chairs.push(m.profile_id); byOffice.set(m.committee_id, r); });
  // Resolve names for chairs + recent appointees.
  const nameIds = [...new Set([...members.filter(m => m.role === "chair").map(m => m.profile_id), ...members.slice(0, 40).map(m => m.profile_id)])];
  const nameById = new Map<string, string>();
  if (nameIds.length) { const { data } = await admin.from("profiles").select("id, full_name").in("id", nameIds.slice(0, 400)); (data ?? []).forEach((p: any) => nameById.set(p.id, p.full_name)); }

  // Delegations = adm_delegations.
  let delegations: any[] = [];
  try { const { data } = await scope(admin.from("adm_delegations").select("position, delegate_id, delegated_by, valid_from, valid_to, status, created_at").limit(3000)); delegations = (data ?? []) as any[]; } catch { /* optional */ }
  const activeDelegations = delegations.filter(d => d.status === "active");
  const expiringDelegations = activeDelegations.filter(d => d.valid_to && d.valid_to <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));

  // Decisions = change_requests (governance change register, filtered to governance-relevant entities).
  let decisions: any[] = [];
  try { const { data } = await admin.from("change_requests").select("entity_type, entity_name, change_kind, status, requested_by_name, effective_date, created_at").order("created_at", { ascending: false }).limit(500); decisions = ((data ?? []) as any[]).filter(c => GOV_RE.test(String(c.entity_type))); } catch { /* optional */ }
  const decisionsMade = decisions.filter(c => ["approved", "implemented"].includes(c.status)).length;
  const decisionsPending = decisions.filter(c => c.status === "open").length;

  // Governance events = audit_log (recent).
  let events: any[] = [];
  try { const { data } = await scope(admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(300)); events = ((data ?? []) as any[]).filter(e => GOV_RE.test(`${e.entity_type} ${e.action}`)).slice(0, 8).map(e => ({ actor: e.actor_name, action: String(e.action ?? "").replace(/_/g, " "), entity: e.entity_name ?? e.entity_type, when: e.created_at })); } catch { /* optional */ }

  // Office health + compliance composite: office is "healthy" if active, has a chair and meets quorum.
  const officeCards = offices.map(o => {
    const m = byOffice.get(o.id) ?? { total: 0, chairs: [] };
    const hasChair = m.chairs.length > 0;
    const atQuorum = m.total >= (o.quorum ?? 1);
    const health = Math.round(((o.is_active ? 40 : 0) + (hasChair ? 30 : 0) + (atQuorum ? 30 : 0)));
    return { id: o.id, name: o.name, level: o.level, members: m.total, chair: hasChair ? (nameById.get(m.chairs[0]) ?? "Appointed") : null, active: o.is_active, atQuorum, health, quorum: o.quorum ?? 1 };
  }).sort((a, b) => b.health - a.health);
  const activeOffices = offices.filter(o => o.is_active).length;
  const compliant = officeCards.filter(o => o.active && o.chair && o.atQuorum).length;
  const complianceScore = offices.length ? Math.round((compliant / offices.length) * 100) : null;

  // Portfolio by level (donut).
  const levelMap = new Map<string, number>();
  offices.forEach(o => levelMap.set(o.level, (levelMap.get(o.level) ?? 0) + 1));
  const portfolio = [...levelMap.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label: label[0].toUpperCase() + label.slice(1), value, tone: LEVEL_TONE[label] ?? "slate" }));

  // Office lifecycle (grounded in is_active + quorum; full Constitute→…→Retire states are next-phase).
  const belowQuorum = officeCards.filter(o => o.active && !o.atQuorum).length;
  const lifecycle = [
    { stage: "Constituted", n: offices.length, tone: "slate" },
    { stage: "Populated", n: officeCards.filter(o => o.chair && o.atQuorum).length, tone: "blue" },
    { stage: "Operate", n: activeOffices, tone: "emerald" },
    { stage: "Attention", n: belowQuorum + officeCards.filter(o => o.active && !o.chair).length, tone: "amber" },
    { stage: "Retired", n: offices.filter(o => !o.is_active).length, tone: "rose" },
  ];

  // Alerts.
  const alerts: { title: string; detail: string; tone: string }[] = [];
  const noChair = officeCards.filter(o => o.active && !o.chair).length;
  if (noChair) alerts.push({ title: "Offices without a chair", detail: `${noChair} active office${noChair > 1 ? "s need" : " needs"} a chair appointed`, tone: "rose" });
  if (belowQuorum) alerts.push({ title: "Offices below quorum", detail: `${belowQuorum} active office${belowQuorum > 1 ? "s are" : " is"} below required membership`, tone: "amber" });
  if (expiringDelegations.length) alerts.push({ title: "Delegations expiring", detail: `${expiringDelegations.length} active delegation${expiringDelegations.length > 1 ? "s expire" : " expires"} within 30 days`, tone: "amber" });
  if (decisionsPending) alerts.push({ title: "Decisions pending", detail: `${decisionsPending} governance change request${decisionsPending > 1 ? "s await" : " awaits"} a decision`, tone: "blue" });
  if (!alerts.length) alerts.push({ title: "Governance healthy", detail: "All active offices chaired and at quorum", tone: "emerald" });

  // Recent appointments.
  const recentAppointments = [...members].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 5)
    .map(m => ({ name: nameById.get(m.profile_id) ?? "Member", role: m.role, office: offices.find(o => o.id === m.committee_id)?.name ?? "—", when: m.created_at }));

  // Performance analytics (derived, honest).
  const performance = [
    { label: "Offices chaired", pct: offices.length ? Math.round((officeCards.filter(o => o.chair).length / offices.length) * 100) : 0 },
    { label: "At quorum", pct: offices.length ? Math.round((officeCards.filter(o => o.atQuorum).length / offices.length) * 100) : 0 },
    { label: "Active rate", pct: offices.length ? Math.round((activeOffices / offices.length) * 100) : 0 },
    { label: "Decision throughput", pct: decisions.length ? Math.round((decisionsMade / decisions.length) * 100) : 0 },
  ];

  return {
    provisioned: true as const,
    kpis: { activeOffices, totalOffices: offices.length, members: new Set(members.map(m => m.profile_id)).size, appointments: members.length, delegations: activeDelegations.length, decisionsMade, complianceScore },
    portfolio, officeCards: officeCards.slice(0, 8), lifecycle, alerts, recentAppointments, performance, events,
  };
}
