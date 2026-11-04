// ── THE DETERIORATION TIMELINE ── LEARNING-CLOSE-2026-11 CE-04C (SALE-2026-11 SALE-13) ──────────────────────────────
//
// A case version may carry an AUTHORED timeline: the patient's observations change as simulated time passes, and the
// case names escalation windows (when escalating is expected, and by when). PURE. No I/O, no AI, no wall clock.
//
// ⚠ A GOVERNED SIMULATION MECHANISM, NOT A CLINICAL DECISION SYSTEM. Every changed value, every reveal, every window and
// every cost in minutes is written by the case author inside the blueprint, so it is approved with the exact version by
// the existing content hash (422). No AI writes, extends or changes a timeline. A private case (written by AI from a
// student's notes) never carries one: blueprintFromDraft never produces one and the private play ignores it.
// ⚠ SIMULATED TIME COMES FROM WHAT THE LEARNER DID, NEVER FROM A CLOCK. The minutes are the sum of authored costs of the
// actions recorded on the session (each answer, each finding asked for, each question to the patient, and any extra
// minutes an option costs, such as "recheck in 30 minutes"). The same record always gives the same minute, on any device,
// at any time. Nothing runs while the learner is away.
// ⚠ NOTHING AHEAD IS SHOWN. A learner sees the current simulated minute, the events already passed and the values they
// changed. A future event, its time, a window and when it closes are never in a learner projection before the case ends
// (the debrief) or before the escalation is answered (its own feedback).
// ⚠ FORMATIVE. Recognition and timeliness are practice marks, never verified competence.

export const TIMELINE_LABEL = "Simulated time: it moves on with what you do in the case (each decision, each finding you ask for and each question to the patient takes time). It is practice, not a real clock.";
export const TIMELINE_DEFAULT_COSTS = { answer: 5, reveal: 2, talkTurn: 1 } as const;
export const TIMELINE_CAPS = { events: 20, updatesPerEvent: 12, windows: 8, optionMinutes: 40, maxMinutes: 24 * 60, label: 200, cost: 240 } as const;

export type TimelineEvent = {
  id: string;
  /** Simulated minute at which it happens (from the start of the case). */
  at: number;
  /** What a learner reads once it has happened, e.g. "His breathing is faster". */
  label: string;
  /** Governed facts whose value changes at this minute. Only an observation, examination or result may change. */
  updates: { factId: string; value: string }[];
  /** Facts that become visible at this minute (a finding that appears, such as new confusion). */
  reveals?: string[];
};
/** Options that count as escalating (or recognising) at a decision. */
export type OptionRef = { decisionPointId: string; optionIds: string[] };
export type EscalationWindow = {
  id: string;
  /** What escalation is expected, e.g. "Call for an urgent medical review". */
  label: string;
  /** The choices that escalate. The earliest answered one counts. */
  escalate: OptionRef[];
  /** Optional: the choices that show the deterioration was recognised. Without them, escalating at all counts as recognising. */
  recognise?: OptionRef[];
  /** Simulated minute by which escalation is expected. Later is late. */
  closesAt: number;
  /** A late or missed escalation is unsafe practice in the debrief (not only a missed point). */
  safetyCritical: boolean;
};
export type Timeline = {
  costs?: { answer?: number; reveal?: number; talkTurn?: number };
  /** Extra simulated minutes a particular choice takes (e.g. "Recheck the observations in 30 minutes"). */
  optionMinutes?: { decisionPointId: string; optionId: string; minutes: number }[];
  events: TimelineEvent[];
  escalation: EscalationWindow[];
};

type B = {
  facts: { id: string; kind: string; value: string; label: string }[];
  stages: { id: string }[];
  decisionPoints: { id: string; stageId: string; kind: string; options: { id: string; text: string }[]; permittedReveals: string[] }[];
  progression: { consequenceFactIds: string[] }[];
  timeline?: Timeline | null;
};

const ID = /^[a-z][a-z0-9_-]{0,30}$/;
const minute = (v: unknown, max: number = TIMELINE_CAPS.maxMinutes) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []); // eslint-disable-line @typescript-eslint/no-explicit-any
const CHANGEABLE = new Set(["observation", "examination", "result"]);

/** Pure: problems with a timeline as an author wrote it. Empty when sound. */
export function timelineProblems(t: unknown, b: B): string[] {
  const p: string[] = [];
  const o = t as Timeline | null | undefined;
  if (!o || typeof o !== "object") return ["timeline: events and escalation windows (lists, possibly empty)"];
  if (!Array.isArray(o.events) || !Array.isArray(o.escalation)) return ["timeline: events and escalation windows (lists, possibly empty)"];
  if (!o.events.length && !o.escalation.length) p.push("timeline: at least one event or one escalation window");
  if (o.events.length > TIMELINE_CAPS.events) p.push(`timeline: at most ${TIMELINE_CAPS.events} events`);
  if (o.escalation.length > TIMELINE_CAPS.windows) p.push(`timeline: at most ${TIMELINE_CAPS.windows} escalation windows`);
  const facts = new Map(b.facts.map(f => [f.id, f]));
  const dps = new Map(b.decisionPoints.map(d => [d.id, d]));
  for (const k of ["answer", "reveal", "talkTurn"] as const) {
    const v = o.costs?.[k];
    if (v !== undefined && !minute(v, TIMELINE_CAPS.cost)) p.push(`timeline: the ${k} cost is a whole number of minutes, 0 to ${TIMELINE_CAPS.cost}`);
  }
  const seen = new Set<string>();
  for (const e of o.events) {
    if (!e || !ID.test(e.id ?? "") || seen.has(e.id)) { p.push("timeline: every event needs its own id"); continue; }
    seen.add(e.id);
    if (!minute(e.at)) p.push(`timeline event ${e.id}: its minute is a whole number, 0 to ${TIMELINE_CAPS.maxMinutes}`);
    if (typeof e.label !== "string" || !e.label.trim() || e.label.length > TIMELINE_CAPS.label) p.push(`timeline event ${e.id}: a label up to ${TIMELINE_CAPS.label} characters`);
    if (arr(e.updates).length > TIMELINE_CAPS.updatesPerEvent) p.push(`timeline event ${e.id}: at most ${TIMELINE_CAPS.updatesPerEvent} changed values`);
    if (!arr(e.updates).length && !arr(e.reveals).length) p.push(`timeline event ${e.id}: it changes a value or reveals a finding`);
    for (const u of arr(e.updates)) {
      const f = facts.get(u?.factId);
      if (!f) p.push(`timeline event ${e.id}: changes unknown fact ${u?.factId}`);
      else if (!CHANGEABLE.has(f.kind)) p.push(`timeline event ${e.id}: only an observation, examination or result changes over time (${f.id} is ${f.kind})`);
      if (typeof u?.value !== "string" || !u.value.trim() || u.value.length > 200) p.push(`timeline event ${e.id}: each changed value is a short text`);
    }
    for (const r of arr(e.reveals)) if (!facts.has(r)) p.push(`timeline event ${e.id}: reveals unknown fact ${r}`);
  }
  const optionOk = (r: OptionRef, where: string) => {
    const d = dps.get(r?.decisionPointId);
    if (!d) { p.push(`${where}: unknown decision ${r?.decisionPointId}`); return; }
    if (d.kind !== "single" && d.kind !== "multiple") p.push(`${where}: decision ${d.id} is not a choice`);
    if (!arr(r.optionIds).length || !arr(r.optionIds).every(id => d.options.some(x => x.id === id))) p.push(`${where}: options of decision ${d.id} that exist`);
  };
  const wseen = new Set<string>();
  for (const w of o.escalation) {
    if (!w || !ID.test(w.id ?? "") || wseen.has(w.id) || seen.has(w.id)) { p.push("timeline: every escalation window needs its own id"); continue; }
    wseen.add(w.id);
    if (typeof w.label !== "string" || !w.label.trim() || w.label.length > TIMELINE_CAPS.label) p.push(`escalation window ${w.id}: a label up to ${TIMELINE_CAPS.label} characters`);
    if (!minute(w.closesAt)) p.push(`escalation window ${w.id}: closesAt is a whole number of minutes`);
    if (typeof w.safetyCritical !== "boolean") p.push(`escalation window ${w.id}: safetyCritical is true or false`);
    if (!arr(w.escalate).length) p.push(`escalation window ${w.id}: the choices that escalate`);
    for (const r of arr(w.escalate)) optionOk(r, `escalation window ${w.id}`);
    for (const r of arr(w.recognise)) optionOk(r, `escalation window ${w.id} recognition`);
  }
  if (o.optionMinutes !== undefined) {
    if (!Array.isArray(o.optionMinutes) || o.optionMinutes.length > TIMELINE_CAPS.optionMinutes) p.push(`timeline: at most ${TIMELINE_CAPS.optionMinutes} option costs`);
    else for (const m of o.optionMinutes) {
      const d = dps.get(m?.decisionPointId);
      if (!d || !d.options.some(x => x.id === m?.optionId)) p.push(`timeline: an option cost names an option that does not exist (${m?.decisionPointId}/${m?.optionId})`);
      if (!minute(m?.minutes, TIMELINE_CAPS.cost)) p.push(`timeline: an option cost is a whole number of minutes, 0 to ${TIMELINE_CAPS.cost}`);
    }
  }
  return p;
}

/** What the clock is computed from: the session's own record. Answers in the order they were made. */
export type ClockInput = {
  answers: readonly { decisionPointId: string; chosen?: readonly string[] | null }[];
  revealed: readonly string[];
  /** Questions to the simulated patient, by stage (880). Optional: none counts as none. */
  turns?: readonly { stageId: string }[];
};
export type Clock = {
  /** The simulated minute now. */
  now: number;
  /** The simulated minute at which each answered decision was made (before its own cost). */
  atAnswer: Record<string, number>;
};

/**
 * Pure: the simulated minute, from the record only. A finding asked for (not a consequence, not an event reveal) is placed
 * at the decision that permitted it (a reveal is only allowed for an unanswered decision on the current stage); a stage's
 * questions to the patient before its first answer. The same record always gives the same minutes.
 */
export function simClock(b: B, x: ClockInput): Clock {
  const t = b.timeline;
  if (!t) return { now: 0, atAnswer: {} };
  const cost = { ...TIMELINE_DEFAULT_COSTS, ...(t.costs ?? {}) };
  const consequences = new Set(b.progression.flatMap(p => p.consequenceFactIds ?? []));
  const eventReveals = new Set(t.events.flatMap(e => e.reveals ?? []));
  const order = x.answers.map(a => a.decisionPointId);
  const requested = x.revealed.filter(id => !consequences.has(id) && !eventReveals.has(id) && b.decisionPoints.some(d => d.permittedReveals.includes(id)));
  const revealsAt = new Map<string, number>();
  let pendingReveals = 0;
  for (const f of requested) {
    const at = order.find(dp => b.decisionPoints.find(d => d.id === dp)?.permittedReveals.includes(f));
    if (at) revealsAt.set(at, (revealsAt.get(at) ?? 0) + 1); else pendingReveals++;
  }
  const turnsBy = new Map<string, number>();
  for (const tr of x.turns ?? []) turnsBy.set(tr.stageId, (turnsBy.get(tr.stageId) ?? 0) + 1);
  const stageOf = (dp: string) => b.decisionPoints.find(d => d.id === dp)?.stageId ?? "";
  const extra = new Map((t.optionMinutes ?? []).map(m => [`${m.decisionPointId}\u0000${m.optionId}`, m.minutes]));
  const stagesSpent = new Set<string>();
  const atAnswer: Record<string, number> = {};
  let now = 0;
  for (const a of x.answers) {
    const st = stageOf(a.decisionPointId);
    if (!stagesSpent.has(st)) { now += (turnsBy.get(st) ?? 0) * cost.talkTurn; stagesSpent.add(st); }
    now += (revealsAt.get(a.decisionPointId) ?? 0) * cost.reveal;
    atAnswer[a.decisionPointId] = Math.min(now, TIMELINE_CAPS.maxMinutes);
    now += cost.answer + (a.chosen ?? []).reduce((s, o) => s + (extra.get(`${a.decisionPointId}\u0000${o}`) ?? 0), 0);
  }
  for (const [st, n] of turnsBy) if (!stagesSpent.has(st)) now += n * cost.talkTurn;
  now += pendingReveals * cost.reveal;
  return { now: Math.min(now, TIMELINE_CAPS.maxMinutes), atAnswer };
}

/** Pure: the events that have happened by this minute, in time order. */
export const eventsBy = (t: Timeline | null | undefined, clock: number): TimelineEvent[] =>
  (t?.events ?? []).filter(e => e.at <= clock).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

/** Pure: the facts the timeline has revealed by this minute. */
export const timelineReveals = (t: Timeline | null | undefined, clock: number): string[] => eventsBy(t, clock).flatMap(e => e.reveals ?? []);

/** Pure: a fact's value at this minute, and every earlier value it had (oldest first). */
export function valueAt(t: Timeline | null | undefined, fact: { id: string; value: string }, clock: number): { value: string; history: { at: number; value: string }[] } {
  const history = [{ at: 0, value: fact.value }];
  for (const e of eventsBy(t, clock)) for (const u of e.updates) if (u.factId === fact.id && u.value !== history[history.length - 1].value) history.push({ at: e.at, value: u.value });
  return { value: history[history.length - 1].value, history };
}

/** Pure: every value this fact takes AFTER this minute. What the patient voice must not say yet. */
export const futureValues = (t: Timeline | null | undefined, factId: string, clock: number): string[] =>
  (t?.events ?? []).filter(e => e.at > clock).flatMap(e => e.updates.filter(u => u.factId === factId).map(u => u.value));

/** What a learner sees of the timeline during play: the minute, and what has happened so far. Nothing ahead. */
export type TimelineView = { label: string; minute: number; happened: { at: number; label: string }[] };
export const timelineView = (t: Timeline | null | undefined, clock: number): TimelineView | null =>
  t ? { label: TIMELINE_LABEL, minute: clock, happened: eventsBy(t, clock).map(e => ({ at: e.at, label: e.label })) } : null;

export type EscalationOutcome = {
  windowId: string; label: string; closesAt: number; safetyCritical: boolean;
  recognised: boolean;
  /** on_time: escalated by closesAt. late: after it. missed: never (the case ended without it). pending: not yet, case open. */
  timeliness: "on_time" | "late" | "missed" | "pending";
  escalatedAt: number | null;
  /** The decision where it happened, if it did. */
  decisionPointId: string | null;
  /** 0 to 1, formative: half for recognising, half for escalating in time (a quarter if late). */
  score: number;
};

const hit = (refs: readonly OptionRef[] | undefined, answers: ClockInput["answers"]) =>
  answers.find(a => (refs ?? []).some(r => r.decisionPointId === a.decisionPointId && (a.chosen ?? []).some(o => r.optionIds.includes(o))));

/** Pure: recognition and timeliness for every window. Code, never an AI judgement. */
export function escalationOutcomes(b: B, x: ClockInput, clock: Clock, completed: boolean): EscalationOutcome[] {
  return (b.timeline?.escalation ?? []).map(w => {
    const esc = hit(w.escalate, x.answers);
    const at = esc ? clock.atAnswer[esc.decisionPointId] ?? null : null;
    const recognised = w.recognise?.length ? !!hit(w.recognise, x.answers) || !!esc : !!esc;
    const timeliness: EscalationOutcome["timeliness"] = at !== null ? (at <= w.closesAt ? "on_time" : "late") : completed ? "missed" : "pending";
    const score = (recognised ? 0.5 : 0) + (timeliness === "on_time" ? 0.5 : timeliness === "late" ? 0.25 : 0);
    return { windowId: w.id, label: w.label, closesAt: w.closesAt, safetyCritical: w.safetyCritical, recognised, timeliness, escalatedAt: at, decisionPointId: esc?.decisionPointId ?? null, score };
  });
}

/** Pure: the plain sentence for one outcome, for feedback and the debrief. */
export function escalationSentence(o: EscalationOutcome): string {
  if (o.timeliness === "on_time") return `${o.label}: done at simulated minute ${o.escalatedAt}, in time (it was needed by minute ${o.closesAt}).`;
  if (o.timeliness === "late") return `${o.label}: done at simulated minute ${o.escalatedAt}, LATE (it was needed by minute ${o.closesAt}).`;
  if (o.timeliness === "missed") return `${o.label}: not done (it was needed by simulated minute ${o.closesAt}).`;
  return `${o.label}: not yet done.`;
}
