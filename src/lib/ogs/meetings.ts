// OGS-004 meetings & votes loader. Reads the real ogs_meetings / attendance / agenda / decisions / actions
// model (migrations 118/119) tenant-scoped, and computes live quorum per meeting. provisioned:false until the
// migration is applied. Children are batched by meeting id (no N+1). The management surface expands one
// meeting at a time; all detail is loaded up-front for the in-scope window (bounded).
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const todayISO = () => new Date().toISOString();

export async function loadOgsMeetings(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const mRes = await scope(admin.from("ogs_meetings").select("id, office_id, hospital_id, title, meeting_type, scheduled_at, location, status, required_quorum, chaired_by_name, minutes, held_at").order("scheduled_at", { ascending: false, nullsFirst: false }).limit(200));
  if (mRes.error) return { provisioned: false as const };
  const meetingsRaw = (mRes.data ?? []) as any[];
  const ids = meetingsRaw.map(m => m.id);

  // Office names for the meetings + the schedulable-office dropdown.
  const oRes = await scope(admin.from("ogs_offices").select("id, name, quorum, status").order("name").limit(2000));
  const offices = ((oRes.data ?? []) as any[]).map(o => ({ id: o.id, name: o.name, quorum: o.quorum ?? 3, status: o.status }));
  const officeName = new Map<string, string>(offices.map(o => [o.id, o.name] as [string, string]));

  const child = async (table: string, cols: string) => {
    let rows: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      if (!ids.length) break;
      const { data } = await admin.from(table).select(cols).in("meeting_id", ids.slice(i, i + 200)).limit(20000);
      rows = rows.concat(data ?? []);
    }
    return rows;
  };
  const attAll = await child("ogs_meeting_attendance", "id, meeting_id, person_id, person_name, role, status");
  const agAll = await child("ogs_agenda_items", "id, meeting_id, seq, title, description, item_type, status");
  const decAll = await child("ogs_decisions", "id, meeting_id, title, description, decision_type, outcome, votes_for, votes_against, votes_abstain, decided_at, recorded_by_name");
  const actAll = await child("ogs_office_actions", "id, meeting_id, title, owner_name, due_date, status");

  const group = (rows: any[]) => { const m = new Map<string, any[]>(); rows.forEach(r => { const a = m.get(r.meeting_id) ?? []; a.push(r); m.set(r.meeting_id, a); }); return m; };
  const attBy = group(attAll), agBy = group(agAll), decBy = group(decAll), actBy = group(actAll);

  const meetings = meetingsRaw.map(m => {
    const att = (attBy.get(m.id) ?? []).map(a => ({ id: a.id, personId: a.person_id, personName: a.person_name, role: a.role, status: a.status }));
    const present = att.filter(a => a.status === "present").length;
    const agenda = (agBy.get(m.id) ?? []).map(a => ({ id: a.id, seq: a.seq, title: a.title, description: a.description, itemType: a.item_type, status: a.status })).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const decisions = (decBy.get(m.id) ?? []).map(d => ({ id: d.id, title: d.title, description: d.description, decisionType: d.decision_type, outcome: d.outcome, votesFor: d.votes_for ?? 0, votesAgainst: d.votes_against ?? 0, votesAbstain: d.votes_abstain ?? 0, decidedAt: d.decided_at, recordedByName: d.recorded_by_name }));
    const actions = (actBy.get(m.id) ?? []).map(a => ({ id: a.id, title: a.title, ownerName: a.owner_name, dueDate: a.due_date, status: a.status }));
    const requiredQuorum = m.required_quorum ?? 3;
    return {
      id: m.id, officeId: m.office_id, officeName: officeName.get(m.office_id) ?? "Office", title: m.title,
      meetingType: m.meeting_type, scheduledAt: m.scheduled_at, location: m.location, status: m.status,
      requiredQuorum, chairedByName: m.chaired_by_name, minutes: m.minutes, heldAt: m.held_at,
      attendance: att, invited: att.length, present, quorumMet: present >= requiredQuorum,
      agenda, decisions, actions,
    };
  });

  const now = todayISO();
  const upcoming = meetings.filter(m => m.status === "scheduled" && m.scheduledAt && m.scheduledAt >= now).length;
  const held = meetings.filter(m => m.status === "held").length;
  const decisionsTotal = decAll.length;
  const openActions = actAll.filter(a => a.status === "open" || a.status === "in_progress").length;
  const heldMeetings = meetings.filter(m => m.status === "held");
  const quorumRate = heldMeetings.length ? Math.round((heldMeetings.filter(m => m.quorumMet).length / heldMeetings.length) * 100) : null;

  return {
    provisioned: true as const,
    kpis: { total: meetings.length, upcoming, held, decisions: decisionsTotal, openActions, quorumRate },
    offices, meetings,
  };
}

// The formal office-decision log — every ogs_decisions row across meetings, with office + vote tally, for the
// OGS-004 Decisions Register. provisioned:false until migrations 118/119 are applied.
export async function loadFormalDecisions(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const res = await scope(admin.from("ogs_decisions").select("id, office_id, meeting_id, title, decision_type, outcome, votes_for, votes_against, votes_abstain, decided_at, recorded_by_name").order("decided_at", { ascending: false, nullsFirst: false }).limit(100));
  if (res.error) return { provisioned: false as const, decisions: [] as any[], kpis: { total: 0, carried: 0, carriedRate: null as number | null } };
  const rows = (res.data ?? []) as any[];
  const offIds = [...new Set(rows.map(r => r.office_id).filter(Boolean))];
  const nameById = new Map<string, string>();
  if (offIds.length) { const { data } = await admin.from("ogs_offices").select("id, name").in("id", offIds); ((data ?? []) as any[]).forEach(o => nameById.set(o.id, o.name)); }
  const decisions = rows.map(r => ({ id: r.id, office: nameById.get(r.office_id) ?? "Office", title: r.title, type: r.decision_type, outcome: r.outcome, votesFor: r.votes_for ?? 0, votesAgainst: r.votes_against ?? 0, votesAbstain: r.votes_abstain ?? 0, decidedAt: r.decided_at, recordedByName: r.recorded_by_name }));
  const carried = rows.filter(r => r.outcome === "carried").length;
  return { provisioned: true as const, decisions, kpis: { total: rows.length, carried, carriedRate: rows.length ? Math.round((carried / rows.length) * 100) : null } };
}
