"use client";

import Link from "next/link";
import { BUTTON, QUICK_SWATCH } from "@/lib/practice/palette";

// CPR-V5-004 s2 CURRENT ENCOUNTER -- who is in the room, how long they have been, and the actions that
// exist for them.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ TWO OF THE COMP'S QUICK ACTIONS ARE NOT BUILDABLE AND ARE NOT DRAWN: "Lab Order" and "Imaging
// Order". There is no order table in this product -- no practice_order, no practice_investigation, no
// practice_lab, no practice_imaging anywhere in supabase/migrations. practice_procedure records
// something that was performed and practice_incoming_document records a result that arrived; neither is
// a request sent to anybody. A button that opens nothing is worse than an absent one, because the
// practitioner believes the lab was told.
//
// The actions this card renders therefore arrive as props with real destinations. It invents none of
// them, so it can never grow a button ahead of the store behind it.
//
// ⚠ NOTHING HERE IS PREDICTED OR COMPARED. The elapsed minutes are the clock. There is no expected
// duration, no goal, and no remark about how this consultation is going -- the product stores no such
// standard, and a figure under the word "target" would be invented and then read as a judgement.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** An action with somewhere to go. No handler, no href, no button. */
export type EncounterAction = { key: string; label: string; href: string };

export type CurrentEncounterCardProps = {
  /** Null when nothing is open; `emptyReason` then says whether that is a fact or a failed read. */
  patientName: string | null;
  patientHref: string | null;
  encounterHref: string | null;
  /** The encounter state in the practitioner's words -- "In progress", "Paused". */
  statusLabel: string | null;
  /** True dims the card and swaps Pause for Resume. Decided by the engine, never inferred here. */
  paused: boolean;
  /** Already formatted by the caller in the practice's timezone. */
  startedAtLabel: string | null;
  /** Minutes since the consultation started. Null with a reason whenever it is not knowable. */
  elapsedMinutes: number | null;
  elapsedReason: string | null;
  /** Minutes this consultation has spent paused -- the interruption, disclosed rather than absorbed. */
  pausedMinutes: number | null;
  pausedReason: string | null;
  /** As the patient or the desk put it. Never a diagnosis, and never rewritten. */
  reasonForVisit: string | null;
  actions: EncounterAction[];
  /** Why there is no encounter: nobody is in the room, or the record could not be read. */
  emptyReason: string | null;
  busy: boolean;
  error: string | null;
  onPause?: () => void;
  onResume?: () => void;
  onComplete?: () => void;
};

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

/** Formatting only. */
function minutesLabel(m: number): string {
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export default function CurrentEncounterCard(props: CurrentEncounterCardProps) {
  const {
    patientName, patientHref, encounterHref, statusLabel, paused, startedAtLabel,
    elapsedMinutes, elapsedReason, pausedMinutes, pausedReason, reasonForVisit,
    actions, emptyReason, busy, error, onPause, onResume, onComplete,
  } = props;

  const open = patientName !== null;

  return (
    <section className={card} aria-labelledby="current-encounter-h">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="current-encounter-h" className="text-[13px] font-bold text-gray-900">Current encounter</h2>
        {open && statusLabel && (
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
            paused ? "bg-slate-100 text-slate-600" : "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"}`}>
            {statusLabel}
          </span>
        )}
        {encounterHref && (
          <Link href={encounterHref} className="ml-auto text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
            Open →
          </Link>
        )}
      </div>

      {!open ? (
        <p className="text-[12px] text-gray-500">
          {/* "Nobody is in the room" and "I could not find out who is in the room" are different
              answers, and the caller is the only one who knows which. */}
          {emptyReason ?? "No consultation is open."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            {patientHref ? (
              <Link href={patientHref} className="text-[15px] font-bold text-gray-900 hover:text-[var(--cp-primary)]">
                {patientName}
              </Link>
            ) : (
              <span className="text-[15px] font-bold text-gray-900">{patientName}</span>
            )}
            {startedAtLabel && (
              <span className="text-[11.5px] tabular-nums text-gray-500">since {startedAtLabel}</span>
            )}
          </div>

          {reasonForVisit && (
            <p className="mt-0.5 text-[12px] leading-snug text-gray-600">{reasonForVisit}</p>
          )}

          <dl className="mt-2.5 grid grid-cols-2 gap-x-4 border-t border-gray-100 pt-2.5">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-gray-400">In the room for</dt>
              {elapsedMinutes === null ? (
                <>
                  <dd className="text-[15px] font-bold leading-none text-gray-300">—</dd>
                  <dd className="mt-1 text-[9.5px] leading-tight text-gray-500">
                    {elapsedReason ?? "No figure available."}
                  </dd>
                </>
              ) : (
                <dd className="text-[15px] font-bold leading-none tabular-nums text-gray-900">
                  {minutesLabel(elapsedMinutes)}
                </dd>
              )}
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-gray-400">Of which paused</dt>
              {/* PAUSED TIME IS SHOWN BESIDE THE TOTAL, not subtracted out of sight. An interruption is
                  a fact about the consultation, and the two figures together are what make the first
                  one readable. */}
              {pausedMinutes === null ? (
                <>
                  <dd className="text-[15px] font-bold leading-none text-gray-300">—</dd>
                  <dd className="mt-1 text-[9.5px] leading-tight text-gray-500">
                    {pausedReason ?? "No figure available."}
                  </dd>
                </>
              ) : (
                <dd className="text-[15px] font-bold leading-none tabular-nums text-gray-900">
                  {minutesLabel(pausedMinutes)}
                </dd>
              )}
            </div>
          </dl>

          {/* ── THE CONTROLS ─────────────────────────────────────────────────────────────────────── */}
          {/* Pausing an encounter is what makes an interruption survivable: the emergency takes the
              room and this consultation keeps its own clock rather than absorbing the wait. */}
          <div className="mt-3 flex flex-wrap gap-2">
            {!paused && onPause && (
              <button type="button" disabled={busy} onClick={onPause}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${BUTTON.quiet}`}>
                Pause
              </button>
            )}
            {paused && onResume && (
              <button type="button" disabled={busy} onClick={onResume}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${BUTTON.primary}`}>
                Resume
              </button>
            )}
            {onComplete && (
              <button type="button" disabled={busy} onClick={onComplete}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${BUTTON.secondaryAction}`}>
                Complete
              </button>
            )}
          </div>
        </>
      )}

      {/* ── WHAT CAN ACTUALLY BE DONE ──────────────────────────────────────────────────────────── */}
      {actions.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2.5">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">Quick actions</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {actions.map((a, i) => (
              <Link key={a.key} href={a.href}
                className={`rounded-lg border px-2 py-2 text-center text-[10.5px] font-semibold leading-tight transition-shadow hover:shadow-sm ${QUICK_SWATCH[i % QUICK_SWATCH.length]}`}>
                {a.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-[var(--cmp-surface-danger)] px-3 py-2 text-[12px] text-[var(--cmp-text-danger)]">
          {error}
        </p>
      )}
    </section>
  );
}
