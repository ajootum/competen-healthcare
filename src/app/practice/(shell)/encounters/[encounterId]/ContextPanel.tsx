import Link from "next/link";
import type { PatientSnapshot } from "@/lib/practice/longitudinal";
import { SAFETY_TONE } from "@/lib/practice/encounter-workspace-constants";
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

export default function ContextPanel(props: {
  snapshot: PatientSnapshot;
  encounter: any;
  sessionTitle: string | null;
  sessionUnavailable: boolean;
  facility: string | null;
  practitionerName: string | null;
}) {
  const s = props.snapshot;
  const e = props.encounter;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Encounter context (auto-inherited, CPR-ENC-002 s3) ─────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-[13px] font-bold text-gray-900">Encounter context</h2>
        <p className="mt-0.5 text-[10px] text-gray-400">
          Inherited from the session you were in when this was opened. It records where the work started,
          not where you are now.
        </p>
        <div className="mt-2.5 flex flex-col gap-2.5">
          <Fact label="Date & time" value={formatDayTime(e.started_at)} missing="—" />
          {/* ⚠ THREE STATES. "No session" is a true and ordinary answer -- consultations happen on call,
              between clinics, at two in the morning against no plan at all. "I could not find out" is
              not an answer, and rendering it as the first would file this record as context-less. */}
          <div>
            <p className={LABEL}>Session</p>
            {props.sessionUnavailable ? (
              <p className="text-[12px] text-rose-700">The session could not be read</p>
            ) : (
              <p className={`text-[12px] ${props.sessionTitle ? "text-gray-800" : "text-gray-400"}`}>
                {props.sessionTitle ?? "Not opened inside a session"}
              </p>
            )}
          </div>
          <Fact label="Location" value={props.facility} missing="Not recorded" />
          <Fact label="Encounter type" value={String(e.encounter_mode).replace(/_/g, " ")} missing="—" />
          <Fact label="Source" value={String(e.entry_pathway).replace(/_/g, " ")} missing="—" />
          <Fact label="Practitioner" value={props.practitionerName} missing="Not recorded" />
        </div>
      </section>

      {/* ── Patient snapshot ───────────────────────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-[13px] font-bold text-gray-900">Patient snapshot</h2>

        {!s.permitted ? (
          <p className="mt-2 rounded-lg bg-gray-50 px-2.5 py-2 text-[11px] text-gray-500">
            You do not hold permission to see the patient record. Nothing was read.
          </p>
        ) : s.unavailable ? (
          <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800">
            The patient record could not be read. Nothing below is a statement about this patient.
          </p>
        ) : (
          <>
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
          </>
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
