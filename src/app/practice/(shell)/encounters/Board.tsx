import Link from "next/link";
import type { LandingEncounter, AttentionRow, LandingContext, Panel } from "@/lib/practice/encounters-landing";
import { BOARD_LIMIT } from "@/lib/practice/encounters-landing";
import {
  MEDICATION_SAFETY_ROW, CONTEXT_TEXT, CHANGE_CONTEXT_HREF,
  AGING_TONE, OUTSTANDING_SHORT, PATHWAY_LABEL, MODE_LABEL, elapsedLabel,
} from "@/lib/practice/encounters-landing-constants";
import { ENCOUNTER_STATUS_CHIP, ENCOUNTER_STATUS_LABEL } from "@/lib/practice/encounter-workspace-constants";
import { formatMinuteOfDay, formatDateTime } from "@/lib/datetime";
import RowMenu from "./RowMenu";

// CPR-ENC-LANDING-001's pieces, in a module the harness can RENDER.
//
// ⚠ THEY LIVE HERE RATHER THAN IN page.tsx FOR ONE REASON, AND IT IS AN ASSERTION REASON. A Next page
// file may export only its default and a small set of route options; a harness that cannot import the
// card cannot render it, and a screen whose only proof is a scan of its own source is a screen proved by
// grepping for words. Every honesty rule on this board -- the em dash instead of a nought, the empty
// state that names its state, the safety row with no figure -- is asserted against real HTML from here.
//
// NO "use client". These are server components: nothing on this board has state, and the one interactive
// piece (RowMenu) is already a client component of its own.

export const CARD = "rounded-xl border border-gray-200 bg-white";

/**
 * A figure that knows it might not have been counted.
 *
 * ⚠ EM DASH, NEVER NOUGHT. This is the single most important twelve lines on the page: a failed count
 * rendered as `0` says "nothing needs you", and that is the sentence a practitioner acts on by going
 * home with a consultation still open.
 */
export function Figure({ value }: { value: number | null }) {
  return value === null
    ? <span className="text-slate-300" title="This could not be counted. It does not mean nought.">&mdash;</span>
    : <>{value}</>;
}

/** The one place any of the three states is rendered, so no panel can invent a fourth. */
export function PanelState({ permitted, unavailable, detail, empty, what }: {
  permitted: boolean; unavailable: boolean; detail?: string | null; empty: string; what: string;
}) {
  if (!permitted) {
    return (
      <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-500">
        You do not hold the permission to see {what} in this workspace. Nothing was read.
      </p>
    );
  }
  if (unavailable) {
    return (
      <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
        <strong>{what} could not be read.</strong> This is not an empty list &mdash; do not take it as one.
        {detail ? <span className="mt-0.5 block font-mono text-[10.5px]">{detail}</span> : null}
      </p>
    );
  }
  // ⚠ COMPACT AND POSITIVE (s14, AC-12): one line in a dashed box, not a half-screen illustration of
  // nothing. The sentence NAMES THE STATE it is empty of, so it cannot be mistaken for a different
  // empty panel -- "nothing is open" and "no encounters ready to sign" are different facts.
  return (
    <p className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2.5 text-[12px] text-gray-500">
      {empty}
    </p>
  );
}

export function patientLabel(e: LandingEncounter) {
  // ⚠ "Unknown patient" IS A CLAIM ABOUT THE RECORD. When the name read failed, the name is unknown to
  // this screen, not missing from the record, and the two sentences are different.
  if (e.patientNameUnavailable) return "Name could not be read";
  return e.patientName ?? "Unnamed record";
}

// ── s4.2: THE CURRENT CONTEXT STRIP ─────────────────────────────────────────────────────────────────

/**
 * s4.2: "A compact strip only."
 *
 * ⚠ ONE STRIP, AND NOTHING ELSE OF THE SESSION APPEARS ON THIS PAGE. The board this replaces opened
 * with a row of session cards carrying four figures each and a "View patients" button -- a session
 * dashboard, which the frozen decision forbids by name. The figures were real and they still are; they
 * live on the command centre, which owns the day.
 */
export function ContextStrip({ context }: { context: LandingContext }) {
  return (
    <section className={`${CARD} flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5`}>
      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Current context</span>
      {context.state === "running" ? (
        <span className="text-[13px] font-semibold text-gray-900">
          {context.title}
          {context.facility ? ` · ${context.facility}` : ""}
          {context.location ? ` · ${context.location}` : ""}
          {context.room ? ` · ${context.room}` : ""}
          {context.plannedStartMinute !== null && context.plannedEndMinute !== null
            ? ` (${formatMinuteOfDay(context.plannedStartMinute)}–${formatMinuteOfDay(context.plannedEndMinute)})`
            : ""}
        </span>
      ) : (
        <span className="text-[13px] font-semibold text-gray-700">
          {context.state === "none" ? "No active session"
            : context.state === "unreadable" ? "Session unknown"
              : "Session not shown to you"}
        </span>
      )}
      <span className={`text-[11.5px] ${context.state === "unreadable" ? "text-rose-700" : "text-gray-500"}`}>
        {CONTEXT_TEXT[context.state]}
      </span>
      {/* ⚠ THE PAGE GOES WHERE THE ACTION GOES, AND THE LABEL SAYS WHERE. Nothing on this page may start
          or switch a session -- that is the command centre's job, and a second control for it here would
          be a second answer to "what am I doing now". */}
      <Link href={CHANGE_CONTEXT_HREF}
        className="ml-auto shrink-0 text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
        Change context on the command centre →
      </Link>
    </section>
  );
}

// ── s4.4 / s6: THE OPEN ENCOUNTER CARD ──────────────────────────────────────────────────────────────

/**
 * s6: the card must answer "what is this, how old is it, and what must I do next?" without opening the
 * encounter.
 */
export function EncounterCard({ e, canSeePatient, canSign }: {
  e: LandingEncounter; canSeePatient: boolean; canSign: boolean;
}) {
  const readyToSign = e.status === "COMPLETED";
  const aging = AGING_TONE[e.aging];

  return (
    <li className={`${CARD} p-3.5`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <Link href={`/practice/encounters/${e.id}`}
              className="text-[14px] font-bold text-gray-900 hover:underline">
              {patientLabel(e)}
            </Link>
            {/* s11's "safe identifier" -- the practice's own number. NEVER a national id on a board. */}
            {e.patientIdentifier && (
              <span className="font-mono text-[11px] text-gray-500">{e.patientIdentifier}</span>
            )}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ENCOUNTER_STATUS_CHIP[e.status] ?? "bg-gray-100 text-gray-500"}`}>
              {ENCOUNTER_STATUS_LABEL[e.status] ?? e.status}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-gray-600">
            {PATHWAY_LABEL[e.entryPathway] ?? e.entryPathway}
            {" · "}{MODE_LABEL[e.encounterMode] ?? e.encounterMode}
            {" · "}
            {/* ⚠ "No session" IS EXPLICIT (s6). A blank here reads as a field that failed to render. */}
            {e.sessionTitle
              ? <span>{e.sessionTitle}{e.sessionLocation ? ` · ${e.sessionLocation}` : ""}</span>
              : <span className="text-gray-400">No session</span>}
          </p>
          <p className="mt-0.5 text-[12px] text-gray-500">
            Started {formatDateTime(e.startedAt)}
            {" · "}
            {/* ⚠ HUMAN-READABLE, NEVER RAW MINUTES (s6, AC-06: "Raw elapsed-minute values are not
                displayed"). elapsedLabel is the only formatter on this board and it returns an em dash
                for a duration that could not be measured -- never "0m", which is a claim that the
                consultation opened this instant. */}
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${aging.chip}`}>
              {e.aging === "overdue" ? "Completion overdue · " : e.aging === "unknown" ? "" : "Open "}
              {elapsedLabel(e.elapsedMinutes)}
            </span>
          </p>
          {e.reasonForVisit && (
            <p className="mt-0.5 truncate text-[12px] text-gray-500">{e.reasonForVisit}</p>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {readyToSign ? (
            canSign ? (
              // ⚠ IT OPENS THE RECORD; IT DOES NOT SIGN FROM THE LIST. s12: "Signing/attestation
              // requires explicit practitioner authorization" -- and an attestation is a statement about
              // a record the signer has read. A one-click Sign on a board applies a signature to
              // something nobody opened, which is the failure that sentence exists to prevent.
              <Link href={`/practice/encounters/${e.id}`}
                className="rounded-lg border border-[var(--cp-primary)]/40 bg-[var(--cp-primary)]/10 px-3 py-1.5 text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/15">
                Review and sign →
              </Link>
            ) : (
              <Link href={`/practice/encounters/${e.id}`}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                Review →
              </Link>
            )
          ) : (
            <Link href={`/practice/encounters/${e.id}`}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Continue encounter →
            </Link>
          )}
          <RowMenu encounterId={e.id} patientId={e.patientId} activityId={e.activityId}
            sessionTitle={e.sessionTitle} canSeePatient={canSeePatient} />
        </div>
      </div>

      {readyToSign && !canSign && (
        // SAID, NOT SILENTLY ABSENT -- and NOT a greyed-out Sign, which is still an offer made to the one
        // person who cannot take it.
        <p className="mt-2 text-[11px] text-gray-500">
          Signing needs <span className="font-mono">encounter.sign</span>, which your role does not carry.
          You can open and read the record.
        </p>
      )}

      {/* ── s4.4's "remaining required components" ───────────────────────────────────────────────── */}
      {e.outstanding === null ? (
        // ⚠ NOT AN EMPTY LIST. The component tables did not answer, so this card cannot say whether
        // anything is outstanding -- and "nothing outstanding" is precisely the wrong guess to make.
        <p className="mt-2.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
          <strong>What is still required could not be read.</strong> Do not read this as a complete record.
        </p>
      ) : e.outstanding.length > 0 ? (
        <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[12px] font-semibold text-amber-900">
            Still required: {e.outstanding.map(w => OUTSTANDING_SHORT[w.key] ?? w.key).join(", ")}
          </p>
          {e.lastComponent && (
            <p className="mt-0.5 text-[11px] text-gray-700">Last completed: {e.lastComponent.label}</p>
          )}
        </div>
      ) : (
        <p className="mt-2.5 text-[11px] text-gray-500">
          Every required component is recorded.
          {e.lastComponent ? ` Last completed: ${e.lastComponent.label}.` : ""}
        </p>
      )}
    </li>
  );
}

// ── A WORK SECTION ──────────────────────────────────────────────────────────────────────────────────

export function WorkSection({ id, title, subtitle, panel, what, empty, canSeePatient, canSign, count }: {
  id: string; title: string; subtitle: string; panel: Panel<LandingEncounter>;
  what: string; empty: string; canSeePatient: boolean; canSign: boolean; count: number | null;
}) {
  const capped = count !== null && count > panel.items.length && !panel.unavailable && panel.permitted;
  return (
    <section id={id} className="scroll-mt-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-bold text-gray-900">{title}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
          <Figure value={count} />
        </span>
      </div>
      <p className="text-[12px] text-gray-500">{subtitle}</p>
      {panel.items.length === 0 ? (
        <PanelState permitted={panel.permitted} unavailable={panel.unavailable} detail={panel.detail}
          what={what} empty={empty} />
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-2.5">
            {panel.items.map(e => (
              <EncounterCard key={e.id} e={e} canSeePatient={canSeePatient} canSign={canSign} />
            ))}
          </ul>
          {/* ⚠ THE CAP IS PRINTED WHEN IT IS REACHED. Until now this list stopped at BOARD_LIMIT and said
              nothing, so fifty rows and "everything outstanding" looked identical -- and a board is
              exactly where the second is believed, because it is meant to BE the complete picture.
              Somebody hunting a consultation that is not among the first fifty concludes it is not
              there. The engine over-fetches by one row purely so this sentence can be true. */}
          {panel.capped && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-900">
              Showing the first {panel.items.length}. There are more than this &mdash; narrow by session
              or search to see the rest. <strong>This is not the whole list.</strong>
            </p>
          )}
        </>
      )}
      {/* ⚠ THE BOUND IS PRINTED WHENEVER IT COULD BE HIDING SOMETHING. A panel showing fifty of sixty
          without a word is how somebody concludes they have seen everything. */}
      {capped && (
        <p className="mt-2 text-[10.5px] text-gray-500">
          Showing the {panel.items.length} most recent of {count}. This board reads at most {BOARD_LIMIT}{" "}
          records per list &mdash; the rest are reachable from the patient&rsquo;s own record.
        </p>
      )}
    </section>
  );
}

// ── s4.6: ENCOUNTER ATTENTION ───────────────────────────────────────────────────────────────────────

/**
 * s4.6's panel. ENCOUNTER-SPECIFIC ONLY.
 *
 * ⚠ THREE ROWS CARRY A FIGURE AND THE FOURTH CANNOT. See MEDICATION_SAFETY_ROW's own note: the comp
 * draws "0 · Unresolved safety alerts · Medication safety requires review", there is no medication
 * safety alert store in this product, and a nought would contradict -- in the reassuring direction -- a
 * warning the prescribing screen prints two screens away.
 *
 * ⚠ AND THREE THINGS THE OLD PANEL COUNTED ARE GONE: overdue follow-ups, unreviewed incoming documents
 * and draft letters. s4.6 excludes each by name.
 */
export function AttentionPanel({ rows }: { rows: AttentionRow[] }) {
  return (
    <section className={`${CARD} h-fit p-4`}>
      <h2 className="text-[15px] font-bold text-gray-900">Encounter attention</h2>
      <p className="text-[12px] text-gray-500">
        Encounter work only. Overdue follow-ups, unread documents and draft letters are real work and
        they are not encounter work &mdash; they live on the command centre and in Documents.
      </p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {rows.map(a => (
          <li key={a.key}>
            {!a.permitted ? (
              <p className="rounded-lg bg-gray-50 px-2.5 py-2 text-[11.5px] text-gray-500">
                {a.label} &mdash; not visible to you. Nothing was counted.
              </p>
            ) : (
              <Link href={a.href}
                className="flex items-start gap-2.5 rounded-lg border border-gray-100 px-2.5 py-2 hover:bg-gray-50">
                <span className={`mt-0.5 text-[17px] font-bold leading-none ${
                  a.count === null ? "text-slate-300" : a.count > 0 ? "text-rose-700" : "text-gray-400"}`}>
                  <Figure value={a.count} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-gray-800">{a.label}</span>
                  <span className="block text-[11px] text-gray-500">{a.detail}</span>
                </span>
              </Link>
            )}
          </li>
        ))}

        {/* ── ⚠ THE COMP'S FOURTH TILE, AND THE ONE THAT WOULD TELL A CLINICAL LIE ────────────────
            The comp draws "0 · Unresolved safety alerts · Medication safety requires review".

            THERE IS NO MEDICATION SAFETY ALERT STORE IN THIS PRODUCT. The only op_safety_alerts table
            is hospital-scoped (the competency estate), and the nine checks MED-001 s4 asks for were
            declined rather than shipped against an empty rule table -- because a check with no rules
            behind it returns nothing to say, which a clinician reads as safe.

            So the row keeps its place and loses its figure: slate, dashed, a hollow mark, and the nine
            absent checks named. MEDICATION_SAFETY_ROW has NO count field, so no later edit can put a
            number here without changing its type. */}
        <li>
          <div className={`rounded-lg px-2.5 py-2 ${MEDICATION_SAFETY_ROW.chip}`}>
            <div className="flex items-baseline gap-2">
              <span className="text-[15px] leading-none">{MEDICATION_SAFETY_ROW.mark}</span>
              <span className="text-[12.5px] font-semibold">{MEDICATION_SAFETY_ROW.label}</span>
              <span className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                {MEDICATION_SAFETY_ROW.chipLabel}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed">{MEDICATION_SAFETY_ROW.detail}</p>
            <p className="mt-1 text-[10.5px]">
              Not checked: {MEDICATION_SAFETY_ROW.checks.map(c => c.label).join(" · ")}.
            </p>
            <Link href={MEDICATION_SAFETY_ROW.href}
              className="mt-1 inline-block text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              What the prescribing screen does check →
            </Link>
          </div>
        </li>
      </ul>

      <p className="mt-2 text-[10.5px] text-gray-400">
        Counts of records, not predictions. An em dash means the figure could not be counted &mdash;
        it does not mean nought.
      </p>
    </section>
  );
}
