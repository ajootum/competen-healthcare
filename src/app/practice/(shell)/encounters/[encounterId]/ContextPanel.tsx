import Link from "next/link";
import type { PatientSnapshot } from "@/lib/practice/longitudinal";
import { SAFETY_TONE } from "@/lib/practice/encounter-workspace-constants";
import type { SafetyChips } from "@/lib/practice/safety-chips";
import { formatDayTime } from "@/lib/datetime";

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

/* eslint-disable @typescript-eslint/no-explicit-any */

const CARD = "rounded-xl border border-gray-200 bg-white p-3.5";
const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-gray-400";

function Fact({ label, value, missing }: { label: string; value: string | null; missing: string }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      <p className={`text-[12px] ${value ? "text-gray-800" : "text-gray-400"}`}>{value ?? missing}</p>
    </div>
  );
}

/**
 * One line of the comp's Patient safety rail.
 *
 * ⚠ THE MARK IS GREY FOR UNKNOWN, NEVER AMBER. An unanswered question is not a warning, and amber on
 * every ordinary consultation is how a practitioner learns to stop seeing amber.
 */
function RailFact({ mark, label, value }: {
  mark: "ok" | "warn" | "unknown" | "plain"; label: string; value: string;
}) {
  const tone = mark === "warn" ? "text-[var(--cmp-text-warning)]"
    : mark === "ok" ? "text-[var(--cmp-text-success)]" : "text-gray-400";
  return (
    <div className="flex items-baseline gap-2">
      <span aria-hidden="true" className={`w-3 shrink-0 text-[11px] ${tone}`}>
        {mark === "warn" ? "⚠" : mark === "ok" ? "✓" : mark === "unknown" ? "–" : ""}
      </span>
      <div className="min-w-0">
        <p className={LABEL}>{label}</p>
        <p className="text-[12px] text-gray-800">{value}</p>
      </div>
    </div>
  );
}

export default function ContextPanel(props: {
  snapshot: PatientSnapshot;
  encounter: any;
  sessionTitle: string | null;
  sessionUnavailable: boolean;
  facility: string | null;
  practitionerName: string | null;
  /** The comp's Patient safety rail. Derived once in safety-chips.ts, shared with the treatment cards. */
  chips: SafetyChips;
  /** The weight sentence the medication engine already composes, carrying its own age. */
  weightText: string | null;
}) {
  const s = props.snapshot;
  const e = props.encounter;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Encounter context (auto-inherited, CPR-ENC-002 s3) ─────────────────────────────────────
          ⚠ CPR-TRT-UI-002 s15: "Compress Encounter Context to essential metadata plus View details."
          It was six labelled rows and a two-line explanation of where the context came from, standing
          open on every consultation. The comp shows three lines. NOTHING IS LOST -- every one of those
          six facts, and the explanation, is inside the disclosure, which is a <details> so it is in the
          HTML, printable and keyboard-reachable without JavaScript. */}
      <section className={CARD}>
        <h2 className="text-[13px] font-bold text-gray-900">Encounter context</h2>
        <div className="mt-2 flex flex-col gap-1.5 text-[12px] text-gray-800">
          <p className="flex items-center gap-2">
            <span aria-hidden="true" className="text-gray-400">&#9636;</span>
            {[String(e.encounter_mode).replace(/_/g, " "), String(e.entry_pathway).replace(/_/g, " ")]
              .filter(Boolean).join(" · ")}
          </p>
          <p className="flex items-center gap-2">
            <span aria-hidden="true" className="text-gray-400">&#128197;</span>
            {formatDayTime(e.started_at) ?? "—"}
          </p>
          {/* ⚠ THREE STATES, KEPT ON THE COMPRESSED LINE. "No session" is a true and ordinary answer --
              consultations happen on call, between clinics, at two in the morning against no plan at
              all. "I could not find out" is not an answer, and collapsing it into the first would file
              this record as context-less. That distinction is too important to move behind a click. */}
          <p className="flex items-center gap-2">
            <span aria-hidden="true" className="text-gray-400">&#128205;</span>
            {props.sessionUnavailable ? (
              <span className="text-rose-700">The session could not be read</span>
            ) : (
              <span className={props.sessionTitle ? "" : "text-gray-400"}>
                {props.sessionTitle ?? props.facility ?? "Not opened inside a session"}
              </span>
            )}
          </p>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            View details
          </summary>
          <p className="mt-1.5 text-[10px] text-gray-400">
            Inherited from the session you were in when this was opened. It records where the work
            started, not where you are now.
          </p>
          <div className="mt-2 flex flex-col gap-2.5">
            <Fact label="Date & time" value={formatDayTime(e.started_at)} missing="—" />
            <Fact label="Location" value={props.facility} missing="Not recorded" />
            <Fact label="Encounter type" value={String(e.encounter_mode).replace(/_/g, " ")} missing="—" />
            <Fact label="Source" value={String(e.entry_pathway).replace(/_/g, " ")} missing="—" />
            <Fact label="Practitioner" value={props.practitionerName} missing="Not recorded" />
          </div>
        </details>
      </section>

      {/* ── Patient safety (the comp's rail) ──────────────────────────────────────────────────────
          ⚠ s15: "Remove or substantially reduce the separate Patient Snapshot when it merely duplicates
          the top strip." It duplicated four of the six tiles above it. The rail now leads with the four
          SAFETY facts the comp names, in the comp's order, and the rest of the record -- the allergy
          list, blood group, problems, current treatments -- moves into the disclosure below rather than
          off the page. Reducing duplication is not the same as deleting a clinical list.
          ⚠ THE CHIPS COME FROM THE SHARED DERIVATION, so this rail, the top strip and every treatment
          card cannot disagree about how many alerts are open. */}
      <section className={CARD}>
        <h2 className="text-[13px] font-bold text-gray-900">Patient safety</h2>
        {s.permitted && !s.unavailable && (
          <div className="mt-2 flex flex-col gap-2">
            <RailFact mark={s.allergies.tone === "none" ? "ok" : s.allergies.tone === "present" ? "warn" : "unknown"}
              label="Allergies" value={s.allergies.text} />
            <RailFact mark={props.weightText ? "plain" : "unknown"} label="Weight"
              value={props.weightText ?? "Not recorded"} />
            <RailFact mark={props.chips.vitals.tone} label="Vitals" value={props.chips.vitals.text} />
            <RailFact mark={props.chips.alerts.tone} label="Parameter alerts" value={props.chips.alerts.text} />
          </div>
        )}

        {!s.permitted ? (
          <p className="mt-2 rounded-lg bg-gray-50 px-2.5 py-2 text-[11px] text-gray-500">
            You do not hold permission to see the patient record. Nothing was read.
          </p>
        ) : s.unavailable ? (
          <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800">
            The patient record could not be read. Nothing below is a statement about this patient.
          </p>
        ) : (
          <details className="mt-2.5">
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
                <p className="mt-1 text-[10px] text-gray-500">
                  An empty allergy list is not the same as no allergies. Ask, then record the answer.
                </p>
              )}
              {s.allergyList.items.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {s.allergyList.items.map(a => (
                    <li key={a.id} className="text-[11px] text-gray-700">
                      <span className="font-semibold">{a.substance}</span>
                      {a.reaction ? ` — ${a.reaction}` : ""}
                      <span className="text-gray-400">
                        {a.severity ? ` · ${a.severity}` : ""} · {a.certainty}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {s.allergyList.unavailable && (
                <p className="mt-1 text-[10px] text-rose-700">The allergy list itself could not be read.</p>
              )}
            </div>

            <div className="mt-3">
              <p className={LABEL}>Blood group</p>
              <p className={`text-[12px] ${s.bloodGroup.tone === "present" ? "font-semibold text-gray-800" : "text-gray-400"}`}>
                {s.bloodGroup.text}
              </p>
            </div>

            <div className="mt-3">
              <p className={LABEL}>Active problems</p>
              {s.activeProblems.unavailable ? (
                <p className="text-[11px] text-rose-700">Problems could not be read.</p>
              ) : s.activeProblems.items.length === 0 ? (
                <p className="text-[11px] text-gray-400">None on the problem list.</p>
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
                <p className="text-[11px] text-gray-400">Nothing recorded.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {s.currentTreatments.items.slice(0, 6).map(t => (
                    <li key={t.id} className="rounded bg-gray-50 px-1.5 py-1 text-[11px] text-gray-700">
                      {t.label}
                      <span className="text-gray-400">
                        {[t.dose, t.frequency].filter(Boolean).length ? ` ${[t.dose, t.frequency].filter(Boolean).join(" ")}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-gray-400">
                What was recorded here, not a reconciled medication list. This product holds no
                administration chart.
              </p>
            </div>
          </details>
        )}
      </section>

      {/* THE PREVIOUS-ENCOUNTER SHORTCUT (CPR-ENC-002 s2) IS RENDERED BY page.tsx, NOT HERE.
          Deliberately: the "this is the first recorded encounter" sentence is the strongest claim on
          this screen, it is read mid-consultation by somebody deciding how much history to take, and
          practice-encounters-harness.ts source-checks that it sits behind a timeline.unavailable guard
          IN page.tsx. Moving the sentence into this component would have left that check passing
          against a file that no longer contains the claim -- a green assertion about nothing. */}

      <Link href={`/practice/encounters/record/${e.patient_id}`}
        className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
        View full patient record →
      </Link>
    </div>
  );
}
