// SCHOLAR-ENGAGEMENT-ANALYTICS-01 -- the pure arithmetic. Rows in, numbers out, nothing read, nothing named. Every rule the
// owner asked to be consistent lives here once: what a meaningful activity is, what an active day is, how active time is
// estimated, and how the AI figures are summed. load.ts fetches the rows, the API applies the identity rules.
import { ACTIVITY_LABEL, type Activity, type ActivityKind, type AiAllowance, type AiRequest, type AiSettled, type KindBreakdown, type LearnerAccount, type LearnerDetail, type LearnerRow, type SortKey, type SummaryCards, type WeekPoint } from "./types";
import { dayKey, inRange, weekKey } from "./range";

const MIN = 60_000;
/** A Learn step gap longer than this is idle time, not study. */
export const IDLE_GAP_MS = 30 * MIN;
/** Credit for the last step of a session (the record shows when it started, not when the person finished reading). */
export const LAST_STEP_MS = 5 * MIN;
/** A session record with no end: the time between its start and last activity counts, up to this. */
export const OPEN_SESSION_CAP_MS = 60 * MIN;
/** Started, never finished, nothing for this long: abandoned. */
export const ABANDON_AFTER_MS = 7 * 86_400_000;

export const METHOD = {
  activeTime:
    "Estimated, never measured from an open tab: Learn = the gaps between steps up to 30 minutes each plus 5 minutes for the last step, " +
    "revision and case sessions = start to last activity up to 60 minutes, OSCE = the recorded attempt duration. Uploads, saved " +
    "explanations, flashcard reviews, evaluations and plan edits carry no time.",
  days: "A day is a reporting day in Africa/Nairobi. An active day is a day with at least one meaningful activity started or completed.",
  aiCost:
    "Estimated cost is the gateway's own per-request estimate (plat_ai_requests.cost_usd). Settled cost is the fair-use ledger's " +
    "settled figure where metering has recorded one. The two are never added together.",
  classification:
    "Accounts classified Demo, Test or System in HQ Users are excluded. Human and not-yet-classified accounts holding live Scholar " +
    "access are included, and the number still unclassified is shown so they can be reviewed.",
};

// ── raw rows → activities ─────────────────────────────────────────────────────────────────────────────

export type RawRows = {
  materials: { id: string; user_id: string; created_at: string }[];
  learnSessions: { id: string; user_id: string; created_at: string; last_active_at: string | null; status: string | null }[];
  learnEvents: { session_id: string; user_id: string; action: string; created_at: string }[];
  artefacts: { id: string; user_id: string; created_at: string; action: string | null; superseded_at: string | null }[];
  reviews: { user_id: string; reviewed_at: string }[];
  revisionSessions: { id: string; user_id: string; created_at: string; last_active_at: string | null; completed_at: string | null; status: string | null }[];
  caseSessions: { id: string; user_id: string; created_at: string; last_active_at: string | null; completed_at: string | null; status: string | null }[];
  osceAttempts: { id: string; user_id: string; started_at: string | null; finished_at: string | null; duration_seconds: number | null; created_at: string }[];
  selfAssessments: { id: string; respondent_id: string; subject_user_id: string; started_at: string | null; submitted_at: string | null; status: string | null }[];
  evaluations: { id: string; user_id: string; created_at: string }[];
  planEdits: { user_id: string; at: string }[];
};

const sessionSeconds = (start: string, last: string | null, end: string | null): number | null => {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : last ? new Date(last).getTime() : null;
  if (e == null || e < s) return null;
  return Math.round(Math.min(e - s, OPEN_SESSION_CAP_MS) / 1000);
};

const openStatus = (last: string | null, created: string, now: number): "started" | "abandoned" =>
  now - new Date(last ?? created).getTime() > ABANDON_AFTER_MS ? "abandoned" : "started";

/** Every meaningful activity in the rows, one per source record, bundles per day where a record is an item not a session. */
export function buildActivities(raw: RawRows, now: Date): Activity[] {
  const nowMs = now.getTime();
  const out: Activity[] = [];
  const seen = new Set<string>();
  const push = (a: Activity) => { const k = `${a.kind}:${a.ref}`; if (!seen.has(k)) { seen.add(k); out.push(a); } };

  for (const m of raw.materials) push({ userId: m.user_id, kind: "upload", ref: m.id, at: m.created_at, endedAt: m.created_at, status: "completed", resumed: 0, seconds: null, items: 1 });

  const eventsBySession = new Map<string, { action: string; at: number }[]>();
  for (const e of raw.learnEvents) eventsBySession.set(e.session_id, [...(eventsBySession.get(e.session_id) ?? []), { action: e.action, at: new Date(e.created_at).getTime() }]);
  for (const s of raw.learnSessions) {
    const ev = (eventsBySession.get(s.id) ?? []).sort((a, b) => a.at - b.at);
    const completed = s.status === "completed";
    if (!ev.length && !completed) continue; // created and never taught: not a learning activity
    const stamps = [new Date(s.created_at).getTime(), ...ev.map(e => e.at)];
    let active = 0;
    for (let i = 1; i < stamps.length; i++) active += Math.min(Math.max(stamps[i] - stamps[i - 1], 0), IDLE_GAP_MS);
    active += LAST_STEP_MS;
    const resumed = ev.filter(e => e.action === "resume").length;
    push({ userId: s.user_id, kind: "learn", ref: s.id, at: s.created_at, endedAt: completed ? s.last_active_at : null,
      status: completed ? "completed" : openStatus(s.last_active_at, s.created_at, nowMs), resumed, seconds: Math.round(active / 1000), items: ev.filter(e => e.action === "teach").length });
  }

  for (const a of raw.artefacts) if (!a.superseded_at && ["teach", "explain", "deeper"].includes(a.action ?? ""))
    push({ userId: a.user_id, kind: "explanation", ref: a.id, at: a.created_at, endedAt: a.created_at, status: "completed", resumed: 0, seconds: null, items: 1 });

  const reviewsByDay = new Map<string, { user: string; day: string; n: number; first: string; last: string }>();
  for (const r of raw.reviews) {
    const day = dayKey(r.reviewed_at), k = `${r.user_id}:${day}`;
    const cur = reviewsByDay.get(k);
    if (!cur) reviewsByDay.set(k, { user: r.user_id, day, n: 1, first: r.reviewed_at, last: r.reviewed_at });
    else { cur.n++; if (r.reviewed_at < cur.first) cur.first = r.reviewed_at; if (r.reviewed_at > cur.last) cur.last = r.reviewed_at; }
  }
  for (const b of reviewsByDay.values()) push({ userId: b.user, kind: "flashcards", ref: `${b.user}:${b.day}`, at: b.first, endedAt: b.last, status: "completed", resumed: 0, seconds: null, items: b.n });

  for (const r of raw.revisionSessions) {
    const done = !!r.completed_at || r.status === "completed";
    push({ userId: r.user_id, kind: "revise", ref: r.id, at: r.created_at, endedAt: r.completed_at, status: done ? "completed" : openStatus(r.last_active_at, r.created_at, nowMs),
      resumed: 0, seconds: sessionSeconds(r.created_at, r.last_active_at, r.completed_at), items: 1 });
  }
  for (const c of raw.caseSessions) {
    const done = !!c.completed_at || c.status === "completed";
    push({ userId: c.user_id, kind: "case", ref: c.id, at: c.created_at, endedAt: c.completed_at, status: done ? "completed" : openStatus(c.last_active_at, c.created_at, nowMs),
      resumed: 0, seconds: sessionSeconds(c.created_at, c.last_active_at, c.completed_at), items: 1 });
  }
  for (const o of raw.osceAttempts) {
    const at = o.started_at ?? o.created_at;
    push({ userId: o.user_id, kind: "osce", ref: o.id, at, endedAt: o.finished_at, status: o.finished_at ? "completed" : openStatus(null, at, nowMs),
      resumed: 0, seconds: o.duration_seconds ?? sessionSeconds(at, null, o.finished_at), items: 1 });
  }
  for (const s of raw.selfAssessments) {
    if (s.respondent_id !== s.subject_user_id || !s.started_at) continue;
    push({ userId: s.subject_user_id, kind: "self_assessment", ref: s.id, at: s.started_at, endedAt: s.submitted_at, status: s.submitted_at ? "completed" : openStatus(null, s.started_at, nowMs),
      resumed: 0, seconds: null, items: 1 });
  }
  for (const e of raw.evaluations) push({ userId: e.user_id, kind: "evaluate", ref: e.id, at: e.created_at, endedAt: e.created_at, status: "completed", resumed: 0, seconds: null, items: 1 });

  const planByDay = new Map<string, { user: string; day: string; n: number; first: string; last: string }>();
  for (const p of raw.planEdits) {
    const day = dayKey(p.at), k = `${p.user_id}:${day}`;
    const cur = planByDay.get(k);
    if (!cur) planByDay.set(k, { user: p.user_id, day, n: 1, first: p.at, last: p.at }); else { cur.n++; if (p.at > cur.last) cur.last = p.at; if (p.at < cur.first) cur.first = p.at; }
  }
  for (const b of planByDay.values()) push({ userId: b.user, kind: "plan", ref: `${b.user}:${b.day}`, at: b.first, endedAt: b.last, status: "completed", resumed: 0, seconds: null, items: b.n });

  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// ── per learner ───────────────────────────────────────────────────────────────────────────────────────

const SESSION_KINDS: ActivityKind[] = ["learn", "revise", "case", "osce", "self_assessment"];

/** The activity touches the range when it started or ended inside it. */
export const touches = (a: Activity, r: { from: string; to: string }): boolean => inRange(a.at, r) || inRange(a.endedAt, r);

export function activeDaysOf(acts: readonly Activity[], r: { from: string; to: string }): Set<string> {
  const days = new Set<string>();
  for (const a of acts) { if (inRange(a.at, r)) days.add(dayKey(a.at)); if (inRange(a.endedAt, r)) days.add(dayKey(a.endedAt!)); }
  return days;
}

export type PerLearnerInput = {
  userId: string; activities: readonly Activity[]; ai: readonly AiRequest[]; settled: readonly AiSettled[]; range: { from: string; to: string };
};

export function learnerRow(input: PerLearnerInput, key: string, label: string): LearnerRow {
  const acts = input.activities.filter(a => a.userId === input.userId && touches(a, input.range));
  const ai = input.ai.filter(x => x.userId === input.userId && inRange(x.at, input.range));
  const settled = input.settled.filter(x => x.userId === input.userId && x.settled && inRange(x.at, input.range));
  const timed = acts.filter(a => a.seconds != null);
  const last = [...acts.map(a => a.endedAt ?? a.at), ...ai.map(x => x.at)].sort().at(-1) ?? null;
  return {
    key, label,
    activeDays: activeDaysOf(acts, input.range).size,
    sessions: acts.filter(a => SESSION_KINDS.includes(a.kind) && inRange(a.at, input.range)).length,
    activeMinutes: timed.length ? Math.round(timed.reduce((n, a) => n + (a.seconds ?? 0), 0) / 60) : null,
    activities: acts.length,
    completed: acts.filter(a => a.status === "completed").length,
    aiRequests: ai.length,
    aiCostUsd: round4(ai.reduce((n, x) => n + (x.costUsd ?? 0), 0)),
    aiSettledUsd: round4(settled.reduce((n, x) => n + (x.costUsd ?? 0), 0)),
    lastActive: last,
  };
}

export const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function sortRows(rows: LearnerRow[], sort: SortKey): LearnerRow[] {
  const num = (r: LearnerRow, k: SortKey): number => k === "lastActive" ? (r.lastActive ? new Date(r.lastActive).getTime() : 0) : (r[k] ?? -1) as number;
  return [...rows].sort((a, b) => num(b, sort) - num(a, sort) || b.activities - a.activities || b.activeDays - a.activeDays || a.label.localeCompare(b.label));
}

export function kindBreakdown(acts: readonly Activity[]): KindBreakdown[] {
  const out: KindBreakdown[] = [];
  for (const kind of Object.keys(ACTIVITY_LABEL) as ActivityKind[]) {
    const xs = acts.filter(a => a.kind === kind);
    if (!xs.length) continue;
    out.push({ kind, label: ACTIVITY_LABEL[kind], started: xs.length, completed: xs.filter(a => a.status === "completed").length,
      abandoned: xs.filter(a => a.status === "abandoned").length, resumed: xs.reduce((n, a) => n + a.resumed, 0), items: xs.reduce((n, a) => n + a.items, 0) });
  }
  return out;
}

export function weeklyTrend(acts: readonly Activity[], ai: readonly AiRequest[], r: { from: string; to: string }): WeekPoint[] {
  const weeks = new Map<string, WeekPoint & { days: Set<string> }>();
  const bump = (day: string) => { const w = weekKey(day); const cur = weeks.get(w) ?? { week: w, activities: 0, activeDays: 0, aiCostUsd: 0, days: new Set<string>() }; weeks.set(w, cur); return cur; };
  for (const a of acts) if (inRange(a.at, r)) { const w = bump(dayKey(a.at)); w.activities++; w.days.add(dayKey(a.at)); }
  for (const x of ai) if (inRange(x.at, r)) { const w = bump(dayKey(x.at)); w.aiCostUsd = round4(w.aiCostUsd + (x.costUsd ?? 0)); }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).map(w => ({ week: w.week, activities: w.activities, activeDays: w.days.size, aiCostUsd: w.aiCostUsd }));
}

export function learnerDetail(input: PerLearnerInput & { allowance: AiAllowance | null; row: LearnerRow }): LearnerDetail {
  const acts = input.activities.filter(a => a.userId === input.userId && touches(a, input.range));
  const ai = input.ai.filter(x => x.userId === input.userId && inRange(x.at, input.range));
  const settled = input.settled.filter(x => x.userId === input.userId && x.settled && inRange(x.at, input.range));
  const byOp = new Map<string, { operation: string; requests: number; costUsd: number }>();
  for (const x of ai) { const cur = byOp.get(x.operation) ?? { operation: x.operation, requests: 0, costUsd: 0 }; cur.requests++; cur.costUsd = round4(cur.costUsd + (x.costUsd ?? 0)); byOp.set(x.operation, cur); }
  const done = (k: ActivityKind) => acts.filter(a => a.kind === k && a.status === "completed").length;
  return {
    row: input.row,
    kinds: kindBreakdown(acts),
    weeks: weeklyTrend(acts, ai, input.range),
    ai: { requests: ai.length, tokens: ai.reduce((n, x) => n + x.tokens, 0), costUsd: round4(ai.reduce((n, x) => n + (x.costUsd ?? 0), 0)),
      settledUsd: round4(settled.reduce((n, x) => n + (x.costUsd ?? 0), 0)), byOperation: [...byOp.values()].sort((a, b) => b.costUsd - a.costUsd),
      allowance: input.allowance ? { includedCau: input.allowance.includedCau, usedCau: input.allowance.usedCau, periodEnd: input.allowance.periodEnd } : null },
    progress: { selfAssessmentsSubmitted: done("self_assessment"), osceCompleted: done("osce"), casesCompleted: done("case"), revisionCompleted: done("revise"), learnCompleted: done("learn") },
    recent: [...acts].sort((a, b) => ((b.endedAt ?? b.at) < (a.endedAt ?? a.at) ? -1 : 1)).slice(0, 20)
      .map(a => ({ at: a.endedAt ?? a.at, kind: a.kind, label: ACTIVITY_LABEL[a.kind], status: a.status, items: a.items })),
  };
}

// ── the summary ───────────────────────────────────────────────────────────────────────────────────────

export function summaryCards(input: {
  learners: readonly LearnerAccount[]; activities: readonly Activity[]; ai: readonly AiRequest[]; settled: readonly AiSettled[];
  range: { from: string; to: string }; now: Date;
}): SummaryCards {
  const ids = new Set(input.learners.map(l => l.userId));
  const acts = input.activities.filter(a => ids.has(a.userId));
  const ai = input.ai.filter(x => ids.has(x.userId));
  const activeIn = (r: { from: string; to: string }) => new Set(acts.filter(a => touches(a, r)).map(a => a.userId).concat(ai.filter(x => inRange(x.at, r)).map(x => x.userId)));
  const nowIso = input.now.toISOString();
  const back = (days: number) => ({ from: new Date(input.now.getTime() - days * 86_400_000).toISOString(), to: nowIso });
  const inRangeIds = activeIn(input.range);
  const before = new Set(acts.filter(a => a.at < input.range.from).map(a => a.userId).concat(ai.filter(x => x.at < input.range.from).map(x => x.userId)));
  const rangeActs = acts.filter(a => touches(a, input.range));
  const rangeAi = ai.filter(x => inRange(x.at, input.range));
  const cost = round4(rangeAi.reduce((n, x) => n + (x.costUsd ?? 0), 0));
  return {
    learners: ids.size,
    unclassifiedIncluded: input.learners.filter(l => l.classification === "unclassified").length,
    dau: activeIn(back(1)).size, wau: activeIn(back(7)).size, mau: activeIn(back(30)).size,
    newLearners: input.learners.filter(l => inRange(l.createdAt, input.range)).length,
    returningLearners: [...inRangeIds].filter(id => before.has(id)).length,
    activeInRange: inRangeIds.size,
    activities: rangeActs.length,
    aiCostUsd: cost,
    aiSettledUsd: round4(input.settled.filter(x => ids.has(x.userId) && x.settled && inRange(x.at, input.range)).reduce((n, x) => n + (x.costUsd ?? 0), 0)),
    aiCostPerActiveLearner: inRangeIds.size ? round4(cost / inRangeIds.size) : null,
    aiRequests: rangeAi.length,
  };
}

export function costByActivity(ai: readonly AiRequest[], r: { from: string; to: string }): { operation: string; requests: number; costUsd: number }[] {
  const m = new Map<string, { operation: string; requests: number; costUsd: number }>();
  for (const x of ai) if (inRange(x.at, r)) { const cur = m.get(x.operation) ?? { operation: x.operation, requests: 0, costUsd: 0 }; cur.requests++; cur.costUsd = round4(cur.costUsd + (x.costUsd ?? 0)); m.set(x.operation, cur); }
  return [...m.values()].sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);
}
