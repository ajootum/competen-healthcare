import Link from "next/link";
import type { PatientSnapshot } from "@/lib/practice/longitudinal";
import type { EncounterCollection, EncounterParameter } from "@/lib/practice/parameters";
import type { PatientMedications } from "@/lib/practice/medication";
import { SAFETY_TONE, weightPrompt } from "@/lib/practice/encounter-workspace-constants";
import WeightTile from "./WeightTile";

// CPR-ENC-003 s3: "Safety Snapshot immediately below header showing weight, allergies, medications,
// active diagnoses, latest vitals and alerts."
//
// ⚠ WHY THIS EXISTS AT ALL, AND IT IS AN INFORMATION-ARCHITECTURE ARGUMENT RATHER THAN A DECORATIVE ONE.
// Before this, the single most safety-critical sentence on the screen -- the allergy line -- sat 280px
// down the LEFT column, underneath six lines of inherited administrative context (session, location,
// encounter type, source, practitioner). A practitioner scanning a consultation reads the top of the
// centre first. Putting session metadata where the eye lands and allergies below the fold is the wrong
// way round, and moving them is most of what "reorganisation" means here.
//
// ══ THE HARD RULE THIS FILE EXISTS TO KEEP ══════════════════════════════════════════════════════════
//
// ⚠ NOTHING HERE IS DRAWN AS PRESENT UNLESS A STORE ANSWERED. On a clinical surface a populated field
// reads as CHECKED and a blank one reads as NOT RECORDED, and those are different claims. So every tile
// below has the three states this codebase uses everywhere -- not permitted / could not be read /
// nothing there -- and NONE of them collapses a failed read into an empty one.
//
// ⚠ AND TWO THINGS THE DESIGN COMP DRAWS ARE NOT HERE, DELIBERATELY:
//
//   A PATIENT PHOTO. There is no image column and no file storage in this product; the refusal is
//   already written down in registration-workspace.ts. A face is a strong identity claim and drawing a
//   placeholder avatar beside a name would be an identity affordance that verifies nothing.
//
//   "No critical alerts". There is no general clinical alert store in Competen Practice. The only alert
//   rows that exist are practice_parameter_alert -- alerts about MEASUREMENTS -- so that is what this
//   tile is called and what it counts. A tile saying "no critical alerts" over a product that has never
//   looked for one is the exact failure this file is written to prevent: a reassurance nobody computed.
//
// ⚠ AND THE VITALS CARRY THEIR DATES. The comp shows "T 37.6 HR 110 RR 24" undated beside a live
// consultation. A vital sign from a previous visit rendered as a bare figure reads as this morning's.
// Every value below prints when it was measured, and anything not measured in this encounter says so.

const TILE = "flex min-w-0 flex-col gap-1 border-gray-100 px-3 py-2.5 sm:border-r last:sm:border-r-0";
const LABEL = "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400";
const VALUE = "text-[12px] font-semibold text-gray-900";
const QUIET = "text-[11px] text-gray-500";
const GAP = "text-[11px] text-gray-400";
const FAILED = "text-[11px] font-semibold text-[var(--cmp-text-critical)]";

/** ⚠ The only sentence in this file allowed to describe a read that did not happen. */
const unreadable = (what: string) => (
  <p className={FAILED}>{what} could not be read. This is not the same as none.</p>
);

export default function SafetySnapshot(props: {
  snapshot: PatientSnapshot;
  collection: EncounterCollection;
  medication: PatientMedications;
  encounterId: string;
  locked: boolean;
}) {
  const { snapshot: s, collection: c, medication: m } = props;

  // ── The weight, which is a parameter and therefore has a THIRD state the others do not ────────────
  //
  // ⚠ "not activated by this practice" is a CONFIGURATION fact and must not read as a clinical one. The
  // user activated `weight` about an hour before this was written and it was the first activation row
  // ever to exist on this platform -- so a practice that has not is the ordinary case, not the edge one,
  // and a weight field that looked empty there would say "nobody weighed this patient" about a practice
  // that has no weight field at all.
  const allParams: EncounterParameter[] = c.permitted && !c.unavailable
    ? [...c.priority, ...c.optional, ...c.additions] : [];
  const weightParam = allParams.find(p => p.code === "weight") ?? null;
  const weightActivated = c.unavailable || !c.permitted ? null : weightParam !== null;
  const prompt = weightPrompt({
    activated: weightActivated,
    recordedThisEncounter: weightParam?.recordedThisEncounter != null,
  });

  // ⚠ vital_sign IS THE ENGINE'S OWN CATEGORY, not a list of codes retyped here. A screen with its own
  // idea of what counts as a vital sign stops showing the seventh one the day somebody adds it.
  const vitals = allParams.filter(p => p.category === "vital_sign");
  const alertCount = allParams.reduce((n, p) => n + p.openAlerts, 0);
  const alerting = allParams.filter(p => p.openAlerts > 0);

  return (
    <section aria-label="Safety snapshot"
      className="mt-3 overflow-hidden rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)]/40">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-white/60 px-3 py-1.5">
        <span aria-hidden className="text-[12px]">⛨</span>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-700">Safety snapshot</h2>
        <span className="text-[10px] text-gray-500">
          Read before you prescribe. Every line below says where it came from and when.
        </span>
      </div>

      <div className="grid divide-y divide-gray-100 bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3 xl:grid-cols-6">
        {/* ── 1. WEIGHT ──────────────────────────────────────────────────────────────────────────── */}
        <div id="weight-capture" className={`${TILE} scroll-mt-4`}>
          <p className={LABEL}><span aria-hidden>⚖</span>Weight</p>
          <WeightTile
            state={prompt.state}
            text={prompt.text}
            parameter={weightParam ? {
              definitionId: weightParam.definitionId,
              canonicalUnit: weightParam.canonicalUnit,
              permittedUnits: weightParam.permittedUnits,
              recorded: weightParam.recordedThisEncounter
                ? { value: weightParam.recordedThisEncounter.value } : null,
              priorText: weightParam.value.state === "value" ? weightParam.value.text : null,
              priorAt: weightParam.lastMeasuredAt,
            } : null}
            patientId={c.patientId}
            encounterId={props.encounterId}
            canRecord={c.canRecord}
            locked={props.locked}
          />
        </div>

        {/* ── 2. ALLERGIES ───────────────────────────────────────────────────────────────────────
            ⚠ THE WORDS ARE NOT CHOSEN HERE. They arrive already decided from allergyLine() in
            longitudinal-constants.ts, exactly as ContextPanel takes them. There is one place in this
            codebase that decides whether a patient reads as "no known allergies"; a second place is the
            one that gets it wrong. This tile draws the sentence in the tone it came with. */}
        <div className={TILE}>
          <p className={LABEL}><span aria-hidden>✳</span>Allergies</p>
          {!s.permitted ? (
            <p className={GAP}>Not permitted to read the patient record.</p>
          ) : s.unavailable ? (
            unreadable("The patient record")
          ) : (
            <>
              <p className={`rounded border px-1.5 py-1 text-[11.5px] font-semibold ${SAFETY_TONE[s.allergies.tone]}`}>
                {s.allergies.text}
              </p>
              {s.allergyList.unavailable
                ? unreadable("The allergy list")
                : s.allergyList.items.length > 0 && (
                  <p className={QUIET}>
                    {s.allergyList.items.map(a => a.substance).join(" · ")}
                  </p>
                )}
            </>
          )}
        </div>

        {/* ── 3. CURRENT MEDICATIONS ─────────────────────────────────────────────────────────────
            ⚠ `absent` IS ITS OWN STATE. The medication store not being in this deployment is a
            different sentence from this patient taking nothing, and the engine already distinguishes
            them -- so the tile must not flatten them back together. */}
        <div className={TILE}>
          <p className={LABEL}><span aria-hidden>℞</span>Current medications</p>
          {!m.permitted ? (
            <p className={GAP}>Not permitted to read the medication record.</p>
          ) : m.storeState === "absent" ? (
            <p className={FAILED}>{m.storeNotice}</p>
          ) : m.unavailable ? (
            unreadable("The medication record")
          ) : m.active.length === 0 ? (
            <p className={GAP}>Nothing recorded as in use.</p>
          ) : (
            <>
              <p className={VALUE}>{m.active.length} in use</p>
              <p className={QUIET}>{m.active.map(x => x.genericName).join(" · ")}</p>
            </>
          )}
        </div>

        {/* ── 4. ACTIVE PROBLEMS ─────────────────────────────────────────────────────────────────
            The comp calls this "Active diagnoses". It is the PROBLEM LIST -- practice_problem, the
            longitudinal one -- and not practice_diagnosis, which is this visit's. The two are separate
            tables on purpose, and the word here is the one that names the table being read. */}
        <div className={TILE}>
          <p className={LABEL}><span aria-hidden>◈</span>Active problems</p>
          {!s.permitted ? (
            <p className={GAP}>Not permitted to read the patient record.</p>
          ) : s.activeProblems.unavailable ? (
            unreadable("The problem list")
          ) : s.activeProblems.items.length === 0 ? (
            <p className={GAP}>None on the problem list.</p>
          ) : (
            <>
              <p className={VALUE}>{s.activeProblems.items.length} active</p>
              <p className={QUIET}>{s.activeProblems.items.map(p => p.label).join(" · ")}</p>
            </>
          )}
        </div>

        {/* ── 5. LATEST VITALS ───────────────────────────────────────────────────────────────────
            ⚠ EVERY FIGURE CARRIES ITS DATE, AND ANYTHING NOT MEASURED TODAY SAYS SO. This is the same
            prohibition ParameterCollection enforces at the point of entry -- a measurement carried
            forward is a measurement nobody took -- applied to the point of DISPLAY. */}
        <div className={TILE}>
          <p className={LABEL}><span aria-hidden>♥</span>Latest vitals</p>
          {!c.permitted ? (
            <p className={GAP}>Not permitted to read clinical parameters.</p>
          ) : c.unavailable ? (
            unreadable("The parameters for this visit")
          ) : vitals.length === 0 ? (
            <p className={GAP}>No vital sign is being collected for this patient.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {vitals.map(v => {
                const today = v.recordedThisEncounter;
                return (
                  <li key={v.definitionId} className="text-[11px] leading-tight">
                    <span className="text-gray-500">{v.label}</span>{" "}
                    {today ? (
                      <>
                        <span className="font-semibold text-gray-900">{today.value}</span>
                        <span className="ml-1 text-[9.5px] font-semibold text-[var(--cmp-text-success)]">today</span>
                      </>
                    ) : v.value.state === "value" ? (
                      <>
                        <span className="font-semibold text-gray-600">{v.value.text}</span>
                        <span className="ml-1 text-[9.5px] text-gray-400">
                          {v.lastMeasuredAt ? v.lastMeasuredAt.slice(0, 10) : "date unknown"} — not today
                        </span>
                      </>
                    ) : (
                      <span className={v.value.state === "unreadable" ? FAILED : "text-gray-400"}>
                        {v.value.text}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── 6. PARAMETER ALERTS ────────────────────────────────────────────────────────────────
            ⚠ THE NAME OF THIS TILE IS THE WHOLE POINT OF IT. practice_parameter_alert is the only
            alert store this product has, so the tile counts those and calls them that. It does NOT say
            "no critical alerts", because nothing in Competen Practice has ever looked for one.
            Doctrine 7: the figure is the length of a list, so the parameters it came from are named. */}
        <div className={TILE}>
          <p className={LABEL}><span aria-hidden>⚠</span>Parameter alerts</p>
          {!c.permitted ? (
            <p className={GAP}>Not permitted to read clinical parameters.</p>
          ) : c.unavailable ? (
            unreadable("The parameters for this visit")
          ) : allParams.length === 0 ? (
            <p className={GAP}>Nothing is monitored, so nothing is being watched for.</p>
          ) : alertCount === 0 ? (
            <p className={QUIET}>
              No open alert on the {allParams.length} parameter{allParams.length === 1 ? "" : "s"} this
              patient is monitored for. Nothing else is checked.
            </p>
          ) : (
            <>
              <p className={`${VALUE} text-[var(--cmp-text-critical)]`}>
                {alertCount} open
              </p>
              <p className={QUIET}>{alerting.map(p => p.label).join(" · ")}</p>
              <Link href={`/practice/patients/${c.patientId}`}
                className="text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                Open the monitoring plan →
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
