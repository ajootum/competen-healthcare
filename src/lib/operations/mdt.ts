// Multidisciplinary Team (MDT) Coordination (SSW-CCR-005) — migration 160.
//
// The last genuinely unbacked SSW module. Every other supervisor surface is a lens over stores that already
// existed; this one needed persistence, so it sat in the sidebar as a muted "soon" entry rather than a
// fabricated page. Five stores back it: referrals (the complex-case register), meetings, participants,
// decisions, actions.
//
// Design notes that matter for honesty:
//   - ATTENDANCE IS A STATUS ON AN INVITATION. A participant row is created when someone is invited, so
//     "invited but did not attend" is a recorded fact. Attendance rates are never inferred from silence,
//     and a meeting with no participant rows reports "not recorded", not 0%.
//   - QUORUM is measured against the REQUIRED participants of that meeting, not a global rule.
//   - The AI case summary field is persisted but NOT generated here; the page states plainly when a meeting
//     has no summary rather than inventing one.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const DAY = 86400000;

// The spec's Participating Services list, in the order it appears there.
export const MDT_SERVICES = [
  { key: "medical", label: "Medical Officers" },
  { key: "surgery", label: "Surgery" },
  { key: "anaesthesia", label: "Anaesthesia" },
  { key: "nursing", label: "Nursing" },
  { key: "physiotherapy", label: "Physiotherapy" },
  { key: "nutrition", label: "Nutrition" },
  { key: "pharmacy", label: "Pharmacy" },
  { key: "laboratory", label: "Laboratory" },
  { key: "radiology", label: "Radiology" },
  { key: "social_work", label: "Social Work" },
  { key: "biomedical", label: "Biomedical" },
  { key: "spiritual_care", label: "Spiritual Care" },
  { key: "case_management", label: "Case Management" },
  { key: "quality", label: "Quality Representative" },
  { key: "family", label: "Family / Carer" },
  { key: "other", label: "Other" },
] as const;

export const MEETING_TYPES = [
  { key: "ward_mdt", label: "Ward MDT" },
  { key: "complex_case", label: "Complex Case Review" },
  { key: "discharge_planning", label: "Discharge Planning" },
  { key: "family_conference", label: "Family Conference" },
  { key: "ethics", label: "Ethics" },
  { key: "specialty_review", label: "Specialty Review" },
  { key: "safeguarding", label: "Safeguarding" },
  { key: "other", label: "Other" },
] as const;

export const DECISION_CATEGORIES = [
  "care_plan", "treatment", "discharge", "escalation", "referral",
  "investigation", "goals_of_care", "family_communication", "safeguarding", "other",
] as const;

export const REFERRAL_PRIORITIES = ["immediate", "urgent", "this_week", "routine"] as const;
const PRI_RANK: Record<string, number> = { immediate: 3, urgent: 2, this_week: 1, routine: 0 };
export const OPEN_ACTION_STATUSES = ["open", "in_progress", "blocked", "escalated"];
const ATTENDED = ["attended", "delegated"];

// How long a referral may wait before it is overdue, by priority. Mirrors the concern-queue convention.
const REFERRAL_SLA_H: Record<string, number> = { immediate: 4, urgent: 24, this_week: 168, routine: 336 };
export function referralOverdue(r: { priority: string; raised_at: string | null; status: string }, now = Date.now()): boolean {
  if (r.status !== "awaiting_review" || !r.raised_at) return false;
  const sla = REFERRAL_SLA_H[r.priority];
  return sla != null && now - new Date(r.raised_at).getTime() > sla * 3.6e6;
}

export function validateMeeting(b: any): string[] {
  const errs: string[] = [];
  if (!String(b?.title ?? "").trim()) errs.push("title is required");
  if (!b?.scheduled_at || Number.isNaN(new Date(b.scheduled_at).getTime())) errs.push("scheduled_at must be a valid date/time");
  if (b?.meeting_type && !MEETING_TYPES.some(t => t.key === b.meeting_type)) errs.push(`meeting_type must be one of: ${MEETING_TYPES.map(t => t.key).join(", ")}`);
  return errs;
}

export function validateReferral(b: any): string[] {
  const errs: string[] = [];
  if (!b?.patient_id) errs.push("patient_id is required");
  if (!String(b?.reason ?? "").trim()) errs.push("reason is required");
  if (b?.priority && !REFERRAL_PRIORITIES.includes(b.priority)) errs.push(`priority must be one of: ${REFERRAL_PRIORITIES.join(", ")}`);
  return errs;
}

// Quorum = every REQUIRED participant attended (or sent a delegate). A meeting with no participant rows has
// no quorum to measure — that is `null`, not false, and the page says so.
export function quorum(participants: any[]): { required: number; present: number; met: boolean | null } {
  const required = participants.filter(p => p.required);
  if (!required.length) return { required: 0, present: 0, met: null };
  const present = required.filter(p => ATTENDED.includes(p.attendance)).length;
  return { required: required.length, present, met: present === required.length };
}

export async function loadMdt(admin: any, hid: string | null, isSuper: boolean, now = Date.now()) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: true }));

  // A head:true count probe does NOT error on a missing table — probe with a real select.
  const probe = await admin.from("op_mdt_meetings").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { provisioned: false as const };

  const [meetRes, refRes] = await Promise.all([
    soft(scope(admin.from("op_mdt_meetings")
      .select("*, op_patients!patient_id(id, label, acuity_level, op_beds!bed_id(label)), units!unit_id(name), chair:profiles!chaired_by(full_name)")
      .gte("scheduled_at", new Date(now - 30 * DAY).toISOString())
      .order("scheduled_at", { ascending: true }).limit(300))),
    soft(scope(admin.from("op_mdt_referrals")
      .select("*, op_patients!patient_id(id, label, acuity_level, isolation_status, op_beds!bed_id(label)), raiser:profiles!raised_by(full_name)")
      .order("raised_at", { ascending: false }).limit(200))),
  ]);

  const meetings = (meetRes.data ?? []) as any[];
  const mids = meetings.map(m => m.id);

  const [partRes, decRes, actRes] = await Promise.all([
    mids.length ? soft(admin.from("op_mdt_participants").select("*, profiles!staff_id(full_name)").in("meeting_id", mids).limit(2000)) : { data: [] },
    mids.length ? soft(admin.from("op_mdt_decisions").select("*, op_patients!patient_id(label)").in("meeting_id", mids).order("decided_at", { ascending: false }).limit(500)) : { data: [] },
    mids.length ? soft(admin.from("op_mdt_actions").select("*, op_patients!patient_id(label), owner:profiles!owner_id(full_name)").in("meeting_id", mids).order("due_at", { ascending: true }).limit(800)) : { data: [] },
  ]);

  const participants = (partRes.data ?? []) as any[];
  const decisions = (decRes.data ?? []) as any[];
  const actions = (actRes.data ?? []) as any[];
  const referrals = (refRes.data ?? []) as any[];

  // ── Meetings decorated with their own participants / decisions / actions ──
  const decorated = meetings.map(m => {
    const ps = participants.filter(p => p.meeting_id === m.id);
    const ds = decisions.filter(d => d.meeting_id === m.id);
    const as = actions.filter(a => a.meeting_id === m.id);
    const q = quorum(ps);
    return {
      ...m,
      participants: ps, decisions: ds, actions: as,
      invited: ps.length,
      attended: ps.filter(p => ATTENDED.includes(p.attendance)).length,
      apologies: ps.filter(p => p.attendance === "apologies").length,
      // null when nobody was invited on the record — "not recorded", not 0%.
      attendanceRate: ps.length ? Math.round((ps.filter(p => ATTENDED.includes(p.attendance)).length / ps.length) * 100) : null,
      quorum: q,
      signedOff: ps.filter(p => p.signed_off).length,
      openActions: as.filter(a => OPEN_ACTION_STATUSES.includes(a.status)).length,
      overdueActions: as.filter(a => OPEN_ACTION_STATUSES.includes(a.status) && a.due_at && new Date(a.due_at).getTime() < now).length,
      patientLabel: m.op_patients?.label ?? null,
      bed: m.op_patients?.op_beds?.label ?? null,
      unit: m.units?.name ?? null,
      chair: m.chair?.full_name ?? m.chaired_by_name ?? null,
    };
  });

  const dayStart = new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z").getTime();
  const inDay = (m: any) => {
    const t = new Date(m.scheduled_at).getTime();
    return t >= dayStart && t < dayStart + DAY;
  };
  const today = decorated.filter(inDay);
  const upcoming = decorated.filter(m => new Date(m.scheduled_at).getTime() >= now && m.status === "scheduled");
  const recent = decorated.filter(m => m.status === "completed").sort((a, b) => +new Date(b.completed_at ?? b.scheduled_at) - +new Date(a.completed_at ?? a.scheduled_at)).slice(0, 10);
  const familyMeetings = decorated.filter(m => m.meeting_type === "family_conference" && ["scheduled", "in_progress"].includes(m.status));

  // ── Complex Case Register ──
  const awaiting = referrals.filter(r => r.status === "awaiting_review")
    .map(r => ({ ...r, overdue: referralOverdue(r, now), waitingHours: r.raised_at ? Math.round((now - new Date(r.raised_at).getTime()) / 3.6e6) : null }))
    .sort((a, b) => (PRI_RANK[b.priority] ?? 0) - (PRI_RANK[a.priority] ?? 0) || +new Date(a.raised_at) - +new Date(b.raised_at));

  // ── Action tracker ──
  const openActions = actions.filter(a => OPEN_ACTION_STATUSES.includes(a.status))
    .map(a => ({
      ...a,
      overdue: !!a.due_at && new Date(a.due_at).getTime() < now,
      dueInH: a.due_at ? Math.round((new Date(a.due_at).getTime() - now) / 3.6e6) : null,
      ownerName: a.owner?.full_name ?? a.owner_name ?? null,
      patientLabel: a.op_patients?.label ?? null,
    }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due_at ? +new Date(a.due_at) : Infinity) - (b.due_at ? +new Date(b.due_at) : Infinity));

  const completedActions = actions.filter(a => a.status === "completed");
  const decidedActions = actions.filter(a => a.status !== "cancelled");

  // ── Attendance by service, across meetings that RECORDED participants ──
  const byService = MDT_SERVICES.map(s => {
    const rows = participants.filter(p => p.service === s.key);
    const att = rows.filter(p => ATTENDED.includes(p.attendance)).length;
    return { service: s.key, label: s.label, invited: rows.length, attended: att, rate: rows.length ? Math.round((att / rows.length) * 100) : null };
  }).filter(s => s.invited > 0).sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));

  const withParticipants = decorated.filter(m => m.invited > 0);
  const completedWithParticipants = withParticipants.filter(m => m.status === "completed");

  // ── Recurring themes: decision categories, for the spec's organisational-learning widget ──
  const themes = [...new Set(decisions.map(d => d.category))]
    .map(c => ({ category: c as string, n: decisions.filter(d => d.category === c).length }))
    .sort((a, b) => b.n - a.n);

  const kpis = {
    todayMeetings: today.length,
    todayCompleted: today.filter(m => m.status === "completed").length,
    awaitingReview: awaiting.length,
    awaitingOverdue: awaiting.filter(r => r.overdue).length,
    openActions: openActions.length,
    overdueActions: openActions.filter(a => a.overdue).length,
    // Completion is measured over actions that were actually raised, excluding cancellations.
    completionRate: decidedActions.length ? Math.round((completedActions.length / decidedActions.length) * 100) : null,
    familyMeetings: familyMeetings.length,
    // Attendance across meetings that recorded an invitation list; null when none have.
    attendanceRate: withParticipants.length
      ? Math.round((participants.filter(p => ATTENDED.includes(p.attendance)).length / participants.length) * 100)
      : null,
    quorumMet: completedWithParticipants.filter(m => m.quorum.met === true).length,
    quorumMeasured: completedWithParticipants.filter(m => m.quorum.met !== null).length,
    escalatedCases: awaiting.filter(r => r.complexity === "highly_complex" || r.priority === "immediate").length,
  };

  // ── Coordination signals (rule-based, each traceable to a row) ──
  const signals: { severity: "high" | "medium"; text: string }[] = [];
  for (const r of awaiting.filter(x => x.overdue)) {
    signals.push({ severity: r.priority === "immediate" ? "high" : "medium", text: `${r.op_patients?.label ?? "Patient"} has waited ${r.waitingHours}h for MDT review (${r.priority.replace(/_/g, " ")}).` });
  }
  const overdueA = openActions.filter(a => a.overdue);
  if (overdueA.length) signals.push({ severity: "high", text: `${overdueA.length} MDT action(s) past their due date.` });
  const noQuorum = decorated.filter(m => m.status === "completed" && m.quorum.met === false);
  if (noQuorum.length) signals.push({ severity: "medium", text: `${noQuorum.length} completed meeting(s) did not have every required service present.` });
  const unrecorded = decorated.filter(m => m.status === "completed" && m.invited === 0);
  if (unrecorded.length) signals.push({ severity: "medium", text: `${unrecorded.length} completed meeting(s) recorded no attendance — attendance cannot be reported for them.` });
  const noDecisions = decorated.filter(m => m.status === "completed" && m.decisions.length === 0);
  if (noDecisions.length) signals.push({ severity: "medium", text: `${noDecisions.length} completed meeting(s) captured no decisions.` });

  return {
    provisioned: true as const,
    kpis, today, upcoming: upcoming.slice(0, 12), recent, familyMeetings,
    awaiting, referrals, openActions: openActions.slice(0, 25), actions,
    decisions: decisions.slice(0, 20), byService, themes, signals,
    counts: { meetings: decorated.length, referrals: referrals.length, decisions: decisions.length, actions: actions.length },
  };
}
