// OGS-000 Office Governance Command Centre loader. Phase 2: now consumes the FIRST-CLASS ogs_offices model
// via resolveOffices (fail-soft — falls back to the governance_committees mapping until migrations 116/117 are
// applied), so lifecycle states, charter versions and immutable transitions are the real office record.
// Delegations (adm_delegations), decisions (change_requests) and events (audit_log) remain their own stores.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/office-governance/_ui";
import { resolveOffices } from "@/lib/ogs/office";

const LEVEL_TONE: Record<string, string> = { enterprise: "violet", country: "indigo", facility: "teal", hospital: "teal", organisation: "indigo", department: "blue", specialty: "amber" };
const GOV_RE = /competency|framework|policy|standard|governance|committee|office|accreditation|credential|competen/i;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export async function loadOgsCommandCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Offices — first-class ogs_offices when constituted, else the committee mapping (fail-soft).
  const { source, offices } = await resolveOffices(admin, hid, isSuper);
  if (!offices.length) return { provisioned: false as const };

  // Delegations = adm_delegations.
  let delegations: any[] = [];
  try { const { data } = await scope(admin.from("adm_delegations").select("position, delegate_id, delegated_by, valid_from, valid_to, status, created_at").limit(3000)); delegations = (data ?? []) as any[]; } catch { /* optional */ }
  const activeDelegations = delegations.filter(d => d.status === "active");
  const expiringDelegations = activeDelegations.filter(d => d.valid_to && d.valid_to <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));

  // Decisions = change_requests (governance-relevant entities).
  let decisions: any[] = [];
  try { const { data } = await admin.from("change_requests").select("entity_type, status, created_at").order("created_at", { ascending: false }).limit(500); decisions = ((data ?? []) as any[]).filter(c => GOV_RE.test(String(c.entity_type))); } catch { /* optional */ }
  const decisionsMade = decisions.filter(c => ["approved", "implemented"].includes(c.status)).length;
  const decisionsPending = decisions.filter(c => c.status === "open").length;

  // Governance events = audit_log (recent, governance-relevant).
  let events: any[] = [];
  try { const { data } = await scope(admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").order("created_at", { ascending: false }).limit(300)); events = ((data ?? []) as any[]).filter(e => GOV_RE.test(`${e.entity_type} ${e.action}`)).slice(0, 8).map(e => ({ actor: e.actor_name, action: String(e.action ?? "").replace(/_/g, " "), entity: e.entity_name ?? e.entity_type, when: e.created_at })); } catch { /* optional */ }

  // Office health composite: active + chaired + at-quorum.
  const officeCards = offices.map(o => {
    const hasChair = !!o.chairName;
    const atQuorum = o.memberCount >= (o.quorum || 1);
    const health = (o.active ? 40 : 0) + (hasChair ? 30 : 0) + (atQuorum ? 30 : 0);
    return { id: o.id, name: o.name, level: o.scopeType, members: o.memberCount, chair: hasChair ? o.chairName : null, active: o.active, status: o.status, atQuorum, health, quorum: o.quorum || 1 };
  }).sort((a, b) => b.health - a.health);

  const activeOffices = offices.filter(o => o.active).length;
  const compliant = officeCards.filter(o => o.active && o.chair && o.atQuorum).length;
  const complianceScore = offices.length ? Math.round((compliant / offices.length) * 100) : null;
  const distinctMembers = new Set(offices.flatMap(o => o.appointments.map(a => a.personId)).filter(Boolean)).size;
  const totalAppointments = offices.reduce((s, o) => s + o.appointments.length, 0);

  // Portfolio by scope level (donut).
  const levelMap = new Map<string, number>();
  offices.forEach(o => levelMap.set(o.scopeType, (levelMap.get(o.scopeType) ?? 0) + 1));
  const portfolio = [...levelMap.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label: cap(label), value, tone: LEVEL_TONE[label] ?? "slate" }));

  // Real lifecycle distribution (12-state model folded into 5 command buckets).
  const inState = (...s: string[]) => offices.filter(o => s.includes(o.status)).length;
  const lifecycle = [
    { stage: "Constituted", n: offices.length, tone: "slate" },
    { stage: "Active", n: inState("active", "approved"), tone: "emerald" },
    { stage: "In review", n: inState("proposed", "in_design", "pending_approval", "under_review", "restructuring"), tone: "amber" },
    { stage: "Suspended", n: inState("suspended", "closing"), tone: "rose" },
    { stage: "Retired", n: inState("dissolved", "archived"), tone: "slate" },
  ];

  // Alerts.
  const alerts: { title: string; detail: string; tone: string }[] = [];
  const noChair = officeCards.filter(o => o.active && !o.chair).length;
  const belowQuorum = officeCards.filter(o => o.active && !o.atQuorum).length;
  if (noChair) alerts.push({ title: "Offices without a chair", detail: `${noChair} active office${noChair > 1 ? "s need" : " needs"} a chair appointed`, tone: "rose" });
  if (belowQuorum) alerts.push({ title: "Offices below quorum", detail: `${belowQuorum} active office${belowQuorum > 1 ? "s are" : " is"} below required membership`, tone: "amber" });
  if (expiringDelegations.length) alerts.push({ title: "Delegations expiring", detail: `${expiringDelegations.length} active delegation${expiringDelegations.length > 1 ? "s expire" : " expires"} within 30 days`, tone: "amber" });
  if (decisionsPending) alerts.push({ title: "Decisions pending", detail: `${decisionsPending} governance change request${decisionsPending > 1 ? "s await" : " awaits"} a decision`, tone: "blue" });
  if (!alerts.length) alerts.push({ title: "Governance healthy", detail: "All active offices chaired and at quorum", tone: "emerald" });

  // Recent appointments (flattened across offices, newest first).
  const recentAppointments = offices.flatMap(o => o.appointments.map(a => ({ name: a.personName ?? "Member", role: a.role, office: o.name, when: a.createdAt })))
    .sort((a, b) => String(b.when ?? "").localeCompare(String(a.when ?? ""))).slice(0, 5);

  // Governance performance (derived, honest).
  const pctOf = (n: number) => (offices.length ? Math.round((n / offices.length) * 100) : 0);
  const performance = [
    { label: "Offices chaired", pct: pctOf(officeCards.filter(o => o.chair).length) },
    { label: "At quorum", pct: pctOf(officeCards.filter(o => o.atQuorum).length) },
    { label: "Active rate", pct: pctOf(activeOffices) },
    { label: "Decision throughput", pct: decisions.length ? Math.round((decisionsMade / decisions.length) * 100) : 0 },
  ];

  // Immutable lifecycle transitions (first-class model only).
  let transitions: { office: string; from: string | null; to: string; actor: string | null; when: string | null }[] = [];
  if (source === "ogs") {
    try {
      const ids = offices.map(o => o.id);
      const { data } = await admin.from("ogs_lifecycle_transitions").select("office_id, from_state, to_state, reason, actor_name, occurred_at").in("office_id", ids.slice(0, 400)).order("occurred_at", { ascending: false }).limit(8);
      const nameById = new Map<string, string>(offices.map(o => [o.id, o.name] as [string, string]));
      transitions = (data ?? []).map((t: any) => ({ office: nameById.get(t.office_id) ?? "Office", from: t.from_state, to: t.to_state, actor: t.actor_name, when: t.occurred_at }));
    } catch { /* optional */ }
  }

  return {
    provisioned: true as const,
    source,
    kpis: { activeOffices, totalOffices: offices.length, members: distinctMembers, appointments: totalAppointments, delegations: activeDelegations.length, decisionsMade, complianceScore },
    portfolio, officeCards: officeCards.slice(0, 8), lifecycle, alerts, recentAppointments, performance, events, transitions,
  };
}
