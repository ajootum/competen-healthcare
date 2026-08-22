"use client";

import { BUTTON, QUEUE_SWATCH } from "@/lib/practice/palette";

// CPR-V5-004 s2 SESSION HEADER -- what this session is, where it is, how long it has been running, and
// the three controls that change it.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A CLIENT COMPONENT ONLY FOR THE THREE BUTTONS, exactly as CurrentActivityPanel is. Nothing here is
// computed: the state, the clock and the labels all arrive already decided by the session engine. A
// header that recomputed "running" from timestamps would eventually disagree with the engine that
// actually owns the lifecycle, and the disagreement would show up as a Pause button on an ended session.
//
// WHY THERE IS NO `goal` PROP, HERE OR ANYWHERE IN THIS FOLDER. The comp prints "Goal: 4h" beside the
// session clock. Nothing in this product stores a session-length goal, so the figure would be invented
// and then attributed to the practice -- and "you are half an hour short of target" is read as a
// judgement somebody made about the morning. The clock is reported; it is not scored.
//
// EVERY FIGURE MAY BE UNKNOWN, AND UNKNOWN IS NOT ZERO. `elapsedMinutes: null` renders an em dash and
// the caller's reason, never "0m" -- "the session started 0 minutes ago" and "I could not work out when
// it started" are different sentences and only one of them is ever true.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The lifecycle states the engine can be in. Nothing else is renderable, so nothing else is accepted. */
export type SessionLifecycleState = "NOT_STARTED" | "RUNNING" | "PAUSED" | "ENDED";

export type SessionHeaderProps = {
  /** The session in the practitioner's words -- "Morning Clinic". */
  title: string;
  /** Activity type, already in words. Null when the record does not carry one. */
  activityLabel: string | null;
  facilityName: string | null;
  room: string | null;
  state: SessionLifecycleState;
  /** Formatted by the caller in the practice's timezone -- this component owns no clock. */
  startedAtLabel: string | null;
  /** The planned window, e.g. "08:00 - 13:00". Null when nothing was planned. */
  plannedWindowLabel: string | null;

  /** Wall-clock minutes since the session started. Null with a reason whenever it is not knowable. */
  elapsedMinutes: number | null;
  elapsedReason: string | null;
  /** Minutes the session has spent paused, and how many pauses that was. Null with a reason. */
  pausedMinutes: number | null;
  pausedReason: string | null;
  pauseCount: number | null;
  /** Minutes past the planned end. Null when it has not passed, or is not knowable. */
  overrunMinutes: number | null;

  /** False hides all three controls -- a reader without the capability sees the state, not the buttons. */
  canControl: boolean;
  /** Disables the controls while an action is in flight, so one click cannot become three. */
  busy: boolean;
  /** The engine's own refusal, shown rather than swallowed. */
  error: string | null;
  onPause?: () => void;
  onResume?: () => void;
  onEnd?: () => void;
};

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

/** The state chip. Running is the success token; paused reuses the queue's own slate, not a new grey. */
const STATE_CHIP: Record<SessionLifecycleState, { label: string; chip: string }> = {
  NOT_STARTED: { label: "Not started", chip: "bg-gray-100 text-gray-500" },
  RUNNING: { label: "Running", chip: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" },
  PAUSED: { label: "Paused", chip: QUEUE_SWATCH.PAUSED.chip },
  ENDED: { label: "Ended", chip: "bg-gray-100 text-gray-500" },
};

/** Minutes as a clinician reads them. Formatting only -- the number itself is never adjusted. */
function minutesLabel(m: number): string {
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/** One clock figure, or an em dash and the reason there is not one. */
function Clock({ label, minutes, reason }: { label: string; minutes: number | null; reason: string | null }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-gray-400">{label}</dt>
      {minutes === null ? (
        <>
          <dd className="text-[13px] font-bold text-gray-300">—</dd>
          {/* Three different reasons stand behind one em dash -- could not read, not permitted, nothing
              yet. The caller knows which; this only has to print it. */}
          <dd className="text-[9.5px] leading-tight text-gray-400">{reason ?? "No figure available."}</dd>
        </>
      ) : (
        <dd className="text-[13px] font-bold tabular-nums text-gray-900">{minutesLabel(minutes)}</dd>
      )}
    </div>
  );
}

export default function SessionHeader(props: SessionHeaderProps) {
  const {
    title, activityLabel, facilityName, room, state, startedAtLabel, plannedWindowLabel,
    elapsedMinutes, elapsedReason, pausedMinutes, pausedReason, pauseCount, overrunMinutes,
    canControl, busy, error, onPause, onResume, onEnd,
  } = props;

  const chip = STATE_CHIP[state];
  const place = [activityLabel, facilityName, room].filter(Boolean).join(" · ");
  // A control is drawn only when the state can reach it AND somebody handed us something to call. A
  // button that cannot do anything is the failure this whole file is guarding against.
  const showPause = canControl && state === "RUNNING" && Boolean(onPause);
  const showResume = canControl && state === "PAUSED" && Boolean(onResume);
  const showEnd = canControl && (state === "RUNNING" || state === "PAUSED") && Boolean(onEnd);

  return (
    <section className={card} aria-labelledby="session-header-h">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 id="session-header-h" className="text-[17px] font-bold leading-tight text-gray-900">{title}</h1>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${chip.chip}`}>
              {chip.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-gray-600">
            {/* A missing location is SAID, not left blank: a session with no recorded place is a real
                state of the record, and an empty line reads as a rendering bug. */}
            {place || "No activity, place or room recorded"}
          </p>
          <p className="mt-1 text-[12px] tabular-nums text-gray-500">
            {startedAtLabel ? `Started ${startedAtLabel}` : "Start time not recorded"}
            {plannedWindowLabel ? ` · planned ${plannedWindowLabel}` : ""}
          </p>
        </div>

        {/* ── THE THREE CONTROLS ─────────────────────────────────────────────────────────────────── */}
        {/* End is the danger button because it is the only one of the three that cannot be undone by
            clicking the other one. Pause and Resume are the same act in two directions. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {showPause && (
            <button type="button" disabled={busy} onClick={onPause}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${BUTTON.quiet}`}>
              Pause
            </button>
          )}
          {showResume && (
            <button type="button" disabled={busy} onClick={onResume}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${BUTTON.primary}`}>
              Resume
            </button>
          )}
          {showEnd && (
            <button type="button" disabled={busy} onClick={onEnd}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${BUTTON.danger}`}>
              End session
            </button>
          )}
        </div>
      </div>

      {/* ── THE CLOCKS ───────────────────────────────────────────────────────────────────────────── */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gray-100 pt-3 sm:grid-cols-4">
        <Clock label="Running for" minutes={elapsedMinutes} reason={elapsedReason} />
        <Clock label="Paused for" minutes={pausedMinutes} reason={pausedReason} />
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">Pauses</dt>
          {pauseCount === null ? (
            <>
              <dd className="text-[13px] font-bold text-gray-300">—</dd>
              <dd className="text-[9.5px] leading-tight text-gray-400">{pausedReason ?? "No figure available."}</dd>
            </>
          ) : (
            <dd className="text-[13px] font-bold tabular-nums text-gray-900">{pauseCount}</dd>
          )}
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">Past planned end</dt>
          {/* Absent rather than zero when the end has not passed: "0m over" is a claim about a session
              that is still inside its window, which is not a thing worth saying. */}
          <dd className={`text-[13px] font-bold tabular-nums ${overrunMinutes === null ? "text-gray-400" : "text-[var(--cmp-text-warning)]"}`}>
            {overrunMinutes === null ? "Not yet" : minutesLabel(overrunMinutes)}
          </dd>
        </div>
      </dl>

      {/* Overrunning is reported, never corrected. A clinic that runs long is a clinic, not an error. */}
      {overrunMinutes !== null && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--cmp-text-warning)]">
          This session is {minutesLabel(overrunMinutes)} past its planned end.
        </p>
      )}

      {/* THE ERROR IS SHOWN, NOT SWALLOWED. A control that silently did nothing is indistinguishable
          from a broken one, and the practitioner is the person who can act on the refusal. */}
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
          {error}
        </p>
      )}
    </section>
  );
}
