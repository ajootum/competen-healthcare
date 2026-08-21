import Link from "next/link";
import type { PatientSnapshot } from "@/lib/practice/longitudinal";
import { SAFETY_TONE } from "@/lib/practice/encounter-workspace-constants";
import type { SafetyChips } from "@/lib/practice/safety-chips";
import { formatDayTime } from "@/lib/datetime";
import {
  RAIL_PRIMARY, RAIL_PRIMARY_H, RAIL_LOW, RAIL_LOW_H, RAIL_META,
} from "@/lib/practice/encounter-rail-constants";

// CPR-ENC-002 s2's LEFT CONTEXT PANEL: patient summary, session context, active problems, current
// treatments, and the previous encounter within reach.
//
// A SERVER COMPONENT ON PURPOSE. Nothing here is interactive, and rendering it on the client would mean
// shipping the patient's problem list, treatments and allergies through a props payload for no benefit.
//
// ⚠ THE ALLERGY LINE IS THE MOST IMPORTANT SENTENCE ON THIS SCREEN AND IT IS NOT COMPUTED HERE.
// It arrives already decided, from allergyLine() in longitudinal-constants.ts, and this component's only
// job is to draw it in the tone it came with. That indirection is the whole safety design: there is
// exactly one place in the codebase that decides whether a patient reads as "no known allergies", it is
// a pure function, and the harness tests it directly. A component that looked at the list length and
// chose its own words would be a second place, and the second place is the one that gets it wrong.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-HFE-TRT-004 s11 SPLIT THIS FILE IN TWO, AND THE SPLIT IS THE POINT.
//
// It used to export one panel that drew Encounter context FIRST and Patient safety second, as a single
// block the rail could only place as a unit. s11 ranks patient safety HIGHEST in the rail and does not
// rank encounter context at all -- it is metadata, and it was sitting above the allergy line. The two
// cards are now separate exports at different tiers, so EncounterConsole can put safety at the top of
// the rail and drop the context card down among the other low-priority panels.
//
// ⚠ NO CLINICAL CONTENT MOVED, CHANGED OR LEFT (s1, s15). Same facts, same words, same tones, same
// disclosure contents -- only the tier, the order and the legibility of the supporting text.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * s10's L3 field label. It was `text-gray-400`, which measures about 2.8:1 on white and fails WCAG AA
 * outright; s13 requires the contrast and s10 asks for "small, HIGH-LEGIBILITY". gray-500 passes at
 * 4.6:1 and is still visibly subordinate to the value beneath it.
 */
const LABEL = "text-[10.5px] font-semibold uppercase tracking-wide text-gray-500";

function Fact({ label, value, missing }: { label: string; value: string | null; missing: string }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      <p className={`text-[12px] ${value ? "text-gray-800" : "text-gray-500"}`}>{value ?? missing}</p>
    </div>
  );
}

/**
 * s11's "status treatment" for the rail's highest tier: each safety fact carries a badge that can be
 * read without reading the words.
 *
 * ⚠ THE MARK IS GREY FOR UNKNOWN, NEVER AMBER. An unanswered question is not a warning, and amber on
 * every ordinary consultation is how a practitioner learns to stop seeing amber. s12 says it directly:
 * "do not use amber for neutral missing optional information".
 *
 * ⚠ AND THERE IS NO AGGREGATE "ALL CLEAR" BADGE ON THIS CARD, DELIBERATELY. s11 asks for the strongest
 * status treatment in the rail and a single summary chip beside the heading would have been the obvious
 * way to give it -- but s7 forbids exactly what that chip would imply: "do not imply that 'no known
 * allergies' means an automated medication-allergy compatibility check has passed unless such a check
 * actually exists". No such check exists. A rail-level "no alerts" would be read as covering the
 * allergy line above it, which is a claim this product cannot make. The status stays PER FACT, where
 * each badge means only what its own label says.
 */
const MARK_TONE: Record<"ok" | "warn" | "unknown" | "plain", string> = {
  ok: "border-emerald-200 bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  warn: "border-amber-300 bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  unknown: "border-slate-200 bg-slate-50 text-gray-500",
  plain: "border-transparent bg-transparent text-transparent",
};

const MARK_GLYPH: Record<"ok" | "warn" | "unknown" | "plain", string> = {
  ok: "✓", warn: "⚠", unknown: "–", plain: "",
};

/**
 * s13: "every semantic colour state must have a text/icon equivalent". The badge carries a glyph as
 * well as a tint, and the word for it is announced to a screen reader -- so the state survives
 * greyscale, colour-blindness and audio alike.
 */
const MARK_WORD: Record<"ok" | "warn" | "unknown" | "plain", string> = {
  ok: "Known", warn: "Attention", unknown: "Not recorded", plain: "",
};

function RailFact({ mark, label, value }: {
  mark: "ok" | "warn" | "unknown" | "plain"; label: string; value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span aria-hidden="true"
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold leading-none ${MARK_TONE[mark]}`}>
        {MARK_GLYPH[mark]}
      </span>
      <div className="min-w-0">
        <p className={LABEL}>
          {label}
          {MARK_WORD[mark] && <span className="sr-only">: {MARK_WORD[mark]}</span>}
        </p>
        <p className="text-[12px] text-gray-800">{value}</p>
      </div>
    </div>
  );
}

/**
 * THE RAIL'S HIGHEST TIER (s11). Patient safety, and nothing above it.
 *
 * ⚠ s15: "Remove or substantially reduce the separate Patient Snapshot when it merely duplicates the
 * top strip." It duplicated four of the six tiles above it. The card leads with the four SAFETY facts
 * the comp names, in the comp's order, and the rest of the record -- the allergy list, blood group,
 * problems, current treatments -- sits in the disclosure below rather than off the page. Reducing
 * duplication is not the same as deleting a clinical list.
 * ⚠ THE CHIPS COME FROM THE SHARED DERIVATION, so this rail, the top strip and every treatment row
 * cannot disagree about how many alerts are open.
 */
export function PatientSafetyCard(props: {
  snapshot: PatientSnapshot;
  /** The comp's Patient safety rail. Derived once in safety-chips.ts, shared with the treatment table. */
  chips: SafetyChips;
  /** The weight sentence the medication engine already composes, carrying its own age. */
  weightText: string | null;
}) {
  const s = props.snapshot;

  return (
    <section className={RAIL_PRIMARY}>
      <h2 className={RAIL_PRIMARY_H}>Patient safety</h2>
      {s.permitted && !s.unavailable && (
        <div className="mt-2.5 flex flex-col gap-2.5">
          <RailFact mark={s.allergies.tone === "none" ? "ok" : s.allergies.tone === "present" ? "warn" : "unknown"}
            label="Allergies" value={s.allergies.text} />
          <RailFact mark={props.weightText ? "plain" : "unknown"} label="Weight"
            value={props.weightText ?? "Not recorded"} />
          <RailFact mark={props.chips.vitals.tone} label="Vitals" value={props.chips.vitals.text} />
          <RailFact mark={props.chips.alerts.tone} label="Parameter alerts" value={props.chips.alerts.text} />
        </div>
      )}

      {!s.permitted ? (
        <p className="mt-2 rounded-lg bg-gray-50 px-2.5 py-2 text-[11px] text-gray-600">
          You do not hold permission to see the patient record. Nothing was read.
        </p>
      ) : s.unavailable ? (
        <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800">
          The patient record could not be read. Nothing below is a statement about this patient.
        </p>
      ) : (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            The rest of the record
          </summary>
          {/* ⚠ ALLERGIES FIRST, AND ALWAYS DRAWN. A panel that hides the allergy line when there is
              nothing in the list is a panel that says nothing at the moment it matters most. */}
          <div className="mt-2.5">
            <p className={LABEL}>Allergies</p>
            <p className={`mt-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${SAFETY_TONE[s.allergies.tone]}`}>
              {s.allergies.text}
            </p>
            {s.allergies.tone === "unknown" && (
              <p className={`mt-1 ${RAIL_META}`}>
                An empty allergy list is not the same as no allergies. Ask, then record the answer.
              </p>
            )}
            {s.allergyList.items.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {s.allergyList.items.map(a => (
                  <li key={a.id} className="text-[11px] text-gray-700">
                    <span className="font-semibold">{a.substance}</span>
                    {a.reaction ? ` — ${a.reaction}` : ""}
                    <span className="text-gray-500">
                      {a.severity ? ` · ${a.severity}` : ""} · {a.certainty}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {s.allergyList.unavailable && (
              <p className="mt-1 text-[11px] text-rose-700">The allergy list itself could not be read.</p>
            )}
          </div>

          <div className="mt-3">
            <p className={LABEL}>Blood group</p>
            <p className={`text-[12px] ${s.bloodGroup.tone === "present" ? "font-semibold text-gray-800" : "text-gray-500"}`}>
              {s.bloodGroup.text}
            </p>
          </div>

          <div className="mt-3">
            <p className={LABEL}>Active problems</p>
            {s.activeProblems.unavailable ? (
              <p className="text-[11px] text-rose-700">Problems could not be read.</p>
            ) : s.activeProblems.items.length === 0 ? (
              <p className="text-[11px] text-gray-500">None on the problem list.</p>
            ) : (
              <ul className="mt-1 flex flex-wrap gap-1">
                {s.activeProblems.items.map(p => (
                  <li key={p.id} className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">
                    {p.label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3">
            <p className={LABEL}>Current treatments</p>
            {s.currentTreatments.unavailable ? (
              <p className="text-[11px] text-rose-700">Treatments could not be read.</p>
            ) : s.currentTreatments.items.length === 0 ? (
              <p className="text-[11px] text-gray-500">Nothing recorded.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {/* ⚠ THE SUMMARY IS THE ENGINE'S, TYPE-AWARE (CP-TREAT-002 s13). This built its own
                    from dose and frequency, which are medication columns -- so a wound dressing or a
                    diet plan rendered as a bare label with nothing after it, and the rail silently
                    told a reader less about every non-drug treatment than it held. */}
                {s.currentTreatments.items.slice(0, 6).map(t => (
                  <li key={t.id} className="rounded bg-gray-50 px-1.5 py-1 text-[11px] text-gray-700">
                    {t.label}
                    {t.summary && <span className="text-gray-500"> {t.summary}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className={`mt-1 ${RAIL_META}`}>
              What was recorded here, not a reconciled medication list. This product holds no
              administration chart.
            </p>
          </div>
        </details>
      )}
    </section>
  );
}

/**
 * THE RAIL'S LOWER TIER (s11). Encounter metadata, below the safety anchor and the procedure list.
 *
 * ⚠ CPR-TRT-UI-002 s15: "Compress Encounter Context to essential metadata plus View details." It was
 * six labelled rows and a two-line explanation of where the context came from, standing open on every
 * consultation. The comp shows three lines. NOTHING IS LOST -- every one of those six facts, and the
 * explanation, is inside the disclosure, which is a <details> so it is in the HTML, printable and
 * keyboard-reachable without JavaScript.
 */
export function EncounterContextCard(props: {
  encounter: any;
  /** The PRACTICE's timezone. A consultation's own clock is the practice's, never the reader's device. */
  timezone: string;
  sessionTitle: string | null;
  sessionUnavailable: boolean;
  facility: string | null;
  practitionerName: string | null;
}) {
  const e = props.encounter;

  return (
    <section className={RAIL_LOW}>
      <h2 className={RAIL_LOW_H}>Encounter context</h2>
      <div className="mt-2 flex flex-col gap-1.5 text-[12px] text-gray-800">
        <p className="flex items-center gap-2">
          <span aria-hidden="true" className="text-gray-500">&#9636;</span>
          {[String(e.encounter_mode).replace(/_/g, " "), String(e.entry_pathway).replace(/_/g, " ")]
            .filter(Boolean).join(" · ")}
        </p>
        <p className="flex items-center gap-2">
          <span aria-hidden="true" className="text-gray-500">&#128197;</span>
          {formatDayTime(e.started_at, props.timezone) ?? "—"}
        </p>
        {/* ⚠ THREE STATES, KEPT ON THE COMPRESSED LINE. "No session" is a true and ordinary answer --
            consultations happen on call, between clinics, at two in the morning against no plan at
            all. "I could not find out" is not an answer, and collapsing it into the first would file
            this record as context-less. That distinction is too important to move behind a click. */}
        <p className="flex items-center gap-2">
          <span aria-hidden="true" className="text-gray-500">&#128205;</span>
          {props.sessionUnavailable ? (
            <span className="text-rose-700">The session could not be read</span>
          ) : (
            <span className={props.sessionTitle ? "" : "text-gray-500"}>
              {props.sessionTitle ?? props.facility ?? "Not opened inside a session"}
            </span>
          )}
        </p>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          View details
        </summary>
        <p className={`mt-1.5 ${RAIL_META}`}>
          Inherited from the session you were in when this was opened. It records where the work
          started, not where you are now.
        </p>
        <div className="mt-2 flex flex-col gap-2.5">
          <Fact label="Date & time" value={formatDayTime(e.started_at, props.timezone)} missing="—" />
          <Fact label="Location" value={props.facility} missing="Not recorded" />
          <Fact label="Encounter type" value={String(e.encounter_mode).replace(/_/g, " ")} missing="—" />
          <Fact label="Source" value={String(e.entry_pathway).replace(/_/g, " ")} missing="—" />
          <Fact label="Practitioner" value={props.practitionerName} missing="Not recorded" />
        </div>
      </details>

      {/* THE PREVIOUS-ENCOUNTER SHORTCUT (CPR-ENC-002 s2) IS RENDERED BY page.tsx, NOT HERE.
          Deliberately: the "this is the first recorded encounter" sentence is the strongest claim on
          this screen, it is read mid-consultation by somebody deciding how much history to take, and
          practice-encounters-harness.ts source-checks that it sits behind a timeline.unavailable guard
          IN page.tsx. Moving the sentence into this component would have left that check passing
          against a file that no longer contains the claim -- a green assertion about nothing. */}
      <Link href={`/practice/encounters/record/${e.patient_id}`}
        className="mt-2.5 inline-block text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
        View full patient record →
      </Link>
    </section>
  );
}
