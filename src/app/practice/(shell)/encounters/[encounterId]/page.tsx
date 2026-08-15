import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { safetyChips } from "@/lib/practice/safety-chips";
import { getEncounter, patientTimeline, LOCKED_STATUSES } from "@/lib/practice/encounters";
import { encounterExtras } from "@/lib/practice/encounter-workspace";
import { patientSnapshot } from "@/lib/practice/longitudinal";
import {
  ENCOUNTER_STATUS_CHIP, ENCOUNTER_STATUS_LABEL, weightPrompt,
} from "@/lib/practice/encounter-workspace-constants";
import { listTemplates, noteHistory, listDocuments } from "@/lib/practice/documentation";
import { listPhrases, listAttachments, myDrafts } from "@/lib/practice/documentation-tools";
import { listFollowUps, listIntervals } from "@/lib/practice/follow-ups";
import { listPlanTemplates } from "@/lib/practice/follow-up-plans";
import { listFacilities } from "@/lib/practice/facilities";
import { getPatient } from "@/lib/practice/patients";
import { listProcedures, listProcedureTypes } from "@/lib/practice/procedures";
import { frequentProcedures } from "@/lib/practice/procedure-capture";
import { logAccess } from "@/lib/practice/privacy";
import { formatDayTime } from "@/lib/datetime";
import EncounterConsole from "./EncounterConsole";
import { PatientSafetyCard, EncounterContextCard } from "./ContextPanel";
import { RAIL_LOW, RAIL_LOW_H, RAIL_META } from "@/lib/practice/encounter-rail-constants";
import SafetySnapshot from "./SafetySnapshot";
import { encounterParameters } from "@/lib/practice/parameters";
import ParameterCollection from "./ParameterCollection";
import { patientMedications } from "@/lib/practice/medication";
import MedicationConsole from "./MedicationConsole";
import { investigationCatalogue, encounterInvestigations } from "@/lib/practice/investigations";
import { treatmentCapture } from "@/lib/practice/treatment-capture";
import InvestigationCapture from "./InvestigationCapture";
import TreatmentCapture from "./TreatmentCapture";

// /practice/encounters/{id} -- CPR-ENC-003's Clinical Decision Workspace.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS SCREEN IS NOW, AND WHAT IT WAS.
//
// CPR-ENC-003 s1: "a Clinical Decision Workspace rather than a documentation form". The user's words
// after walking through a real encounter were that it was not intuitive and did not follow human-factors
// principles, and the diagnosis was ORDER rather than content: everything the consultation needed was on
// the screen, and nothing said what to do first.
//
// The order was: patient strip, then a full-width clinical parameters panel, then a full-width medication
// console with a permanently-open dose calculator and a ten-field prescribing form, and only THEN a
// three-column layout whose left column opened with the session and location and whose centre was an
// eight-tab notebook. A prescriber met a dose calculator before the screen had asked why the patient was
// there, and read the allergy line below the fold.
//
// It is now s2's five-step flow, top to bottom, in one scrolling page (s5):
//
//   HEADER            identity, status, and what has been signed          -- this file
//   SAFETY SNAPSHOT   weight, allergies, medication, problems, vitals     -- SafetySnapshot.tsx
//   ACTION BAR        the state table, including Finish                   -- EncounterConsole.tsx
//   ① why is the patient here      ② clinical impression
//   ③ clinical decisions           ④ next plan                            -- EncounterConsole.tsx
//   RIGHT COLUMN      patient summary, previous visits, timeline          -- this file + ContextPanel
//
// ⚠ NO CAPTURE PATH WAS REMOVED. The parameters panel and the prescribing console are the same
// components, unedited, passed into the flow as slots. Every field that could be filled in before can be
// filled in now, and practice-encounter-workspace-harness.ts asserts the inventory directly.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
//   THE PREVIOUS VISIT IS ON THIS SCREEN rather than behind a tab because the single most common clinical
//   question in a follow-up is "what did we do last time", and a click away is a click too many
//   mid-consultation.
//
// ⚠ THE "FIRST RECORDED ENCOUNTER" SENTENCE LIVES IN THIS FILE ON PURPOSE. It is the strongest claim on
// the screen -- read during a consultation, by somebody deciding how much history to take -- and a
// failed timeline read used to produce exactly that sentence from nothing.
// practice-encounters-harness.ts source-checks that the claim in THIS file sits behind a
// timeline.unavailable guard; moving it into a child component would leave that check passing against a
// file that no longer contains the claim.
//
// Object-level access is the workspace, as everywhere else: an encounter from another practice is
// notFound(), not 403 (SHELL-001 s6.2).

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function EncounterPage({ params }: { params: Promise<{ encounterId: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "encounter.list")) redirect("/practice/home");

  const { encounterId } = await params;
  const admin = createAdminClient();
  const detail = await getEncounter(admin, shell.ctx.workspaceId, encounterId);
  if (!detail) notFound();

  const { encounter, patient, notes, diagnoses, treatments, history } = detail as any;
  const timeline = await patientTimeline(admin, shell.ctx.workspaceId, encounter.patient_id, 6);
  const priors = (timeline.encounters as any[]).filter(e => e.id !== encounter.id);
  const locked = LOCKED_STATUSES.includes(encounter.status);

  // CPR-370. Logged AFTER notFound(), so only a read that actually happened is recorded -- a probe
  // for an id in another practice must not leave a trail suggesting it was seen.
  await logAccess(admin, {
    workspaceId: shell.ctx.workspaceId, actorId: shell.ctx.userId, subjectKind: "encounter",
    subjectId: encounter.id, patientId: encounter.patient_id, route: "/practice/encounters/[id]",
  });

  // CPR-130. Only encounter-note templates are offered here: applying a referral-letter template to a
  // SOAP segment is refused by the engine, so offering it would be drawing a button that 422s.
  // CPR-140. The patient's LIVE obligations, not this encounter's -- a follow-up raised at the last
  // visit is exactly what this consultation is supposed to settle, and it would be invisible if the
  // panel only showed what today raised.
  // CPR-150 loads the PATIENT's procedures, not this encounter's, for the same reason: the outcome of
  // something done last month is learned today, and a panel showing only today's would have nothing to
  // attach it to.
  const [
    templates, noteVersions, documents, followUpList, intervals, procedures, procedureTypes,
    frequentProcs, planTemplates, facilities, patientDetail,
    phrases, attachments, draftState, snapshot, session, practitioner,
  ] = await Promise.all([
    listTemplates(admin, shell.ctx.workspaceId, { kind: "encounter_note" }),
    noteHistory(admin, shell.ctx.workspaceId, encounter.id),
    listDocuments(admin, shell.ctx.workspaceId, { encounterId: encounter.id }),
    listFollowUps(admin, shell.ctx.workspaceId, { patientId: encounter.patient_id, status: ["OPEN", "SCHEDULED"] }),
    listIntervals(admin),
    listProcedures(admin, shell.ctx.workspaceId, { patientId: encounter.patient_id, limit: 20 }),
    listProcedureTypes(admin, shell.ctx.workspaceId),
    // CPR-PROC-HFE-005 s6. Derived from what this practice has recorded, not from the catalogue --
    // a shortcut list built from the catalogue is the catalogue in a smaller font.
    frequentProcedures(admin, shell.ctx, shell.ctx.userId),
    // CPR-FUP-HFE-008 s15. The templates engine has existed since migration 206 and NOTHING in the
    // encounter surface has ever reached it.
    listPlanTemplates(admin, shell.ctx.workspaceId),
    // s6's Location.
    listFacilities(admin, shell.ctx),
    // ⚠ FOR s10's BOOKING LINK, AND IT IS A READ OF EXISTING APPOINTMENTS RATHER THAN A BOOKING
    // FLOW. getPatient returns the patient's last 25 appointments; the tab filters them to live and
    // future ones. See EncounterConsole for why linking beats booking here.
    getPatient(admin, shell.ctx.workspaceId, encounter.patient_id),
    // CPR-130 (migration 207). The drafts are the CALLER's own -- myDrafts takes the actor and has no
    // parameter that would return anybody else's unsaved text.
    listPhrases(admin, shell.ctx.workspaceId, shell.ctx.userId),
    listAttachments(admin, shell.ctx.workspaceId, { encounterId: encounter.id }),
    myDrafts(admin, shell.ctx.workspaceId, encounter.id, shell.ctx.userId),
    patientSnapshot(admin, shell.ctx, encounter.patient_id),
    encounter.activity_id
      ? admin.from("practice_activity")
        .select("id, title, practice_facility:facility_id(name), practice_location:location_id(name)")
        .eq("id", encounter.activity_id).eq("workspace_id", shell.ctx.workspaceId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    encounter.created_by
      ? admin.from("profiles").select("full_name").eq("id", encounter.created_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // ⚠ THE WARNING COUNTS COME FROM READS THAT SUCCEEDED. `listFollowUps` reports its own failure, and a
  // failed read is passed through as null -- so "no follow-up has been planned" cannot be raised from a
  // list that never loaded.
  const extras = await encounterExtras(admin, shell.ctx, encounter.id, {
    diagnoses: (diagnoses as any[]).length,
    treatments: (treatments as any[]).length,
    openFollowUps: followUpList.unavailable ? null : followUpList.items.length,
  });

  const sessionRow = (session as any)?.data ?? null;
  const sessionUnavailable = !!(session as any)?.error;

  // CPR-LCP-001 s10.3. Fetched unconditionally: encounterParameters reports permitted:false itself, and
  // gating the call would turn "you may not see this" into "there is nothing to collect".
  const parameterCollection = await encounterParameters(admin, shell.ctx, encounter.id);

  // CPR-MED-001. Prescribing happens where the patient is, and the record it writes into lives on the
  // patient page. Fetched unconditionally for the reason above: patientMedications reports
  // permitted:false and storeState "absent" itself, and gating the call would turn either of those into
  // "this patient is on nothing".
  const medicationRecord = await patientMedications(admin, shell.ctx, encounter.patient_id);

  // ── CPR-TREAT-001 and CINV-CAP-001 (migration 275) ────────────────────────────────────────────────
  //
  // ⚠ FETCHED UNCONDITIONALLY, for the reason the two reads above are. Each engine reports permitted:
  // false and storeState "absent" itself, and gating the call would turn "you may not see this" or
  // "this deployment has not migrated" into "this practice has no catalogue" -- three different facts
  // that lead a practitioner to three different actions.
  //
  // ⚠ THE PRACTITIONER IS THE CALLER. Favourites, frequently used and personal sets are that person's,
  // and passing anything but shell.ctx.userId here is the subject-versus-caller bug class again.
  const [investigationLibrary, encounterInvestigationList, treatmentPayload] = await Promise.all([
    investigationCatalogue(admin, shell.ctx, shell.ctx.userId),
    encounterInvestigations(admin, shell.ctx, encounter.id),
    treatmentCapture(admin, shell.ctx, shell.ctx.userId),
  ]);

  // ── THE WEIGHT PROMPT (the user's requirement and ruling of 2026-08-08) ────────────────────────────
  //
  // "Ensure that the weight is part of the data we collect", and "do not make it required, but prompt
  // for it". ⚠ NOTHING BELOW GATES ANYTHING. weightPrompt() returns `blocking: false` as a literal type
  // and this page uses the result only to choose words.
  //
  // ⚠ AND THE THIRD STATE IS THE POINT. `activated` is null when the collection could not be READ, false
  // when this practice has not switched the weight parameter on, and true otherwise. A practice that has
  // not activated it must not be shown an empty weight field, because an empty field reads as a patient
  // nobody weighed rather than as a product nobody configured. The user activated `weight` about an hour
  // before this was written and it was the first activation row ever to exist on this platform, so the
  // un-activated practice is the ordinary case and not the edge one.
  const weightEntry = parameterCollection.permitted && !parameterCollection.unavailable
    ? [...parameterCollection.priority, ...parameterCollection.optional, ...parameterCollection.additions]
      .find(p => p.code === "weight") ?? null
    : null;
  const weightPromptState = weightPrompt({
    activated: parameterCollection.unavailable || !parameterCollection.permitted ? null : weightEntry !== null,
    recordedThisEncounter: weightEntry?.recordedThisEncounter != null,
  });

  return (
    <div className="max-w-[1400px]">
      {/* ── The patient banner (CPR-ENC-003 s3's header) ──────────────────────────────────────────
          ⚠ NO PHOTO. The comp draws a patient photograph beside the name; there is no image column and
          no file storage in this product, and the refusal is already recorded in
          registration-workspace.ts. A placeholder avatar next to a name is an identity affordance that
          verifies nothing, on the one screen where identity matters most. */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <Link href="/practice/encounters" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              ← Back to encounters
            </Link>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{patient?.display_name ?? "Unknown patient"}</h1>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ENCOUNTER_STATUS_CHIP[encounter.status] ?? "bg-gray-100 text-gray-600"}`}>
                {ENCOUNTER_STATUS_LABEL[encounter.status] ?? encounter.status}
              </span>
            </div>
            <p className="mt-0.5 text-[13px] text-gray-500">
              {patient?.sex}
              {patient?.birth_date ? ` · b. ${patient.birth_date}` : patient?.age_estimate_years != null ? ` · ~${patient.age_estimate_years}y` : ""}
              {" · "}{String(encounter.entry_pathway).replace(/_/g, " ")}
              {" · started "}{formatDayTime(encounter.started_at)}
            </p>
            {/* The identifiers (CPR-ENC-003 s3's "multiple hospital identifiers"). ⚠ THE TYPE IS
                LABELLED ABOVE THE VALUE rather than trailing it in nine-pixel grey: the comp draws
                "Practice ID" and "Hospital No." as titled fields, and a bare code with a whispered
                label is a code somebody reads out as the wrong one. */}
            {snapshot.identifiers.unavailable ? (
              <p className="mt-1.5 text-[11px] font-semibold text-[var(--cmp-text-critical)]">
                The patient&rsquo;s identifiers could not be read.
              </p>
            ) : snapshot.identifiers.items.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {snapshot.identifiers.items.map(i => (
                  <li key={i.id} className="rounded bg-gray-100 px-2 py-1">
                    <span className="block text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                      {i.type.replace(/_/g, " ")}
                    </span>
                    <span className="block font-mono text-[12px] text-gray-800">{i.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Link href={`/practice/encounters/record/${encounter.patient_id}`}
              className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Patient record →
            </Link>
            <p className="text-[11px] text-gray-400">
              {encounter.signed_at ? `Signed ${formatDayTime(encounter.signed_at)}`
                : encounter.completed_at ? `Completed ${formatDayTime(encounter.completed_at)}`
                  : "Not yet completed"}
            </p>
          </div>
        </div>
      </div>

      {locked && (
        <div className="mt-3 rounded-xl border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] px-3 py-2">
          <p className="text-[12px] font-bold text-[var(--cmp-text-success)]">
            {encounter.status === "ENTERED_IN_ERROR" ? "Marked as entered in error." : "Signed and locked."}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-700">
            {encounter.signed_at ? `Signed ${formatDayTime(encounter.signed_at)}. ` : ""}
            The clinical content can no longer be edited. An amendment creates a governed new version;
            the database refuses any other change.
          </p>
        </div>
      )}

      {/* ══ CPR-ENC-003 s3: "Safety Snapshot immediately below header" ═════════════════════════════
          ⚠ THIS IS THE SINGLE BIGGEST INFORMATION-ARCHITECTURE MOVE ON THE SCREEN. The allergy line --
          the most safety-critical sentence here -- used to sit in a 280px left column BELOW six lines of
          inherited administrative context. Session, location and entry pathway occupied the place the
          eye lands; allergies, weight and current medication were below the fold. That is the wrong way
          round on a surface somebody prescribes from. ══════════════════════════════════════════════ */}
      <SafetySnapshot
        snapshot={snapshot}
        collection={parameterCollection}
        medication={medicationRecord}
        encounterId={encounter.id}
        locked={locked}
      />

      {/* ══ THE CONSULTATION ════════════════════════════════════════════════════════════════════
            ⚠ THE PARAMETERS PANEL AND THE PRESCRIBING CONSOLE ARE PASSED IN AS SLOTS rather than
            stacked above this workspace, which is where they used to be. Neither component was edited.
            CPR-LCP-001 s10.3's "shown first" is honoured by their position INSIDE the flow --
            measurements immediately after "why is the patient here", prescribing inside "clinical
            decisions" -- rather than by being first on the page, which put a dose calculator above the
            reason for the visit. CPR-MED-001 s9's minimal-click workflow is preserved and shortened: the
            weight is recorded in the safety snapshot at the top, and the console that multiplies by it
            links straight back to that field. */}
        <EncounterConsole
          measurements={<ParameterCollection collection={parameterCollection} locked={locked} />}
          medication={
            <MedicationConsole
              record={medicationRecord}
              patientId={encounter.patient_id}
              encounterId={encounter.id}
              canRecord={hasCapability(shell.ctx, "medication.record")}
              locked={locked}
            />
          }
          treatmentCapture={
            <TreatmentCapture
              encounterId={encounter.id}
              patientId={encounter.patient_id}
              capture={treatmentPayload}
              medication={medicationRecord}
              recorded={treatments as any}
              canRecord={hasCapability(shell.ctx, "treatment.record")}
              canPrescribe={hasCapability(shell.ctx, "medication.record")}
              locked={locked}
              /* ⚠ THE ALLERGY ANSWER CAME FROM patientSnapshot, WHICH THIS PAGE ALREADY LOADS. It is
                 the SafetyLine, not a list length -- see the note on the prop. The store, the engine
                 and the route have existed since migration 238 with no caller; the Treatment tab is
                 now the caller. */
              allergyLine={snapshot.allergies}
              allergyList={snapshot.allergyList}
              bloodGroupLine={snapshot.bloodGroup}
              canEditPatient={hasCapability(shell.ctx, "patient.edit")}
              /* ⚠ THE SAME COLLECTION SafetySnapshot READS, not a second query. The vitals and alert
                 chips on each treatment card are derived from this with the same arithmetic, so the
                 strip at the top of the page and the cards below it cannot disagree about how many
                 alerts are open -- two screens counting the same thing differently is a drift this
                 codebase has already been bitten by. */
              collection={parameterCollection}
            />
          }
          investigationCapture={
            <InvestigationCapture
              encounterId={encounter.id}
              patientId={encounter.patient_id}
              catalogue={investigationLibrary}
              recorded={encounterInvestigationList}
              canEdit={hasCapability(shell.ctx, "encounter.edit")}
              canConfigure={hasCapability(shell.ctx, "investigation.configure")}
              locked={locked}
            />
          }
          weightPrompt={weightPromptState}
          /* ══ s3's RIGHT COLUMN, AUTHORED HERE AND RENDERED THERE ═════════════════════════════════
             ⚠ THE "FIRST RECORDED ENCOUNTER" CLAIM MUST STAY IN THIS FILE. practice-encounters-
             harness.ts source-checks that the sentence sits behind a timeline.unavailable guard in
             page.tsx; authoring it in a child component would leave that assertion passing against a
             file that no longer contains the claim. It is a server-rendered slot, not a move.

             ⚠ THE AI ASSISTANT IS NOT HERE, AND THAT IS DELIBERATE. The assistant engine exists and
             is reachable at /practice/assistant, but nothing on this screen is wired to it. A panel
             headed "AI Assistant", with the comp's "Suggest with AI" and "Voice to AI" buttons,
             would be an affordance for a capability this screen does not have.

             ⚠ CPR-HFE-TRT-004 s11 SPLIT ONE SLOT INTO TWO, because the rail is now RANKED and these
             cards belong at opposite ends of it. Patient safety is the rail's highest tier and goes
             first; encounter context and previous visits are the lowest and sit below the procedure
             list, which s11 ranks above them. One combined slot could only ever place them adjacent. */
          railSafety={
            <PatientSafetyCard
              snapshot={snapshot}
              /* ⚠ THE SAME DERIVATION THE TREATMENT ROWS USE, from the same collection. The rail and
                 the table printing different alert counts on one screen is the failure this shares a
                 function to prevent. */
              chips={safetyChips(parameterCollection)}
              weightText={medicationRecord.weight.text}
            />
          }
          railLower={
            <>
              <EncounterContextCard
                encounter={encounter}
                sessionTitle={sessionRow?.title ?? null}
                sessionUnavailable={sessionUnavailable}
                facility={sessionRow?.practice_facility?.name ?? null}
                practitionerName={(practitioner as any)?.data?.full_name ?? null}
              />

              <section className={RAIL_LOW}>
                <h2 className={RAIL_LOW_H}>Previous visits</h2>
                {/* ⚠ "THIS IS THE FIRST RECORDED ENCOUNTER" IS THE STRONGEST CLAIM ON THIS PAGE, and it
                    is read DURING a consultation, by somebody deciding how much history to take. A
                    failed timeline read used to produce exactly that sentence.

                    ⚠ AND THE FAILURE MESSAGE KEEPS ITS FULL WEIGHT AT THIS TIER. s11 lowers the card's
                    contrast; s6 says an alert override outranks the banding, and s4 gives red to
                    critical safety conditions. A red panel inside a quiet card is exactly the
                    exception-driven attention s2 asks for -- the tier decides the RESTING state only. */}
                {timeline.unavailable ? (
                  <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
                    Previous visits could not be read. Do <strong>not</strong> take this as a first visit.
                  </p>
                ) : priors.length === 0 ? (
                  <p className="mt-2 text-[12px] text-gray-500">This is the first recorded encounter for this patient.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {priors.map(p => (
                      <li key={p.id} className="border-l-2 border-gray-200 pl-2">
                        <Link href={`/practice/encounters/${p.id}`} className="text-[12px] font-semibold text-gray-800 hover:underline">
                          {String(p.started_at).slice(0, 10)}
                        </Link>
                        <span className={`ml-1.5 ${RAIL_META}`}>{p.status}</span>
                        {p.reason_for_visit && <p className="text-[11px] text-gray-600">{p.reason_for_visit}</p>}
                        {timeline.diagnosesUnavailable ? (
                          <p className="text-[11px] text-[var(--cmp-text-critical)]">Diagnoses could not be read.</p>
                        ) : (timeline.diagnosesByEncounter[p.id] ?? []).map((d: any, i: number) => (
                          <p key={i} className="text-[11px] text-gray-600">
                            {d.is_primary ? "▪ " : "· "}{d.label} <span className="text-gray-500">({d.certainty})</span>
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          }
          encounterId={encounter.id}
          status={encounter.status}
          reasonForVisit={encounter.reason_for_visit}
          notes={notes}
          diagnoses={diagnoses}
          treatments={treatments}
          patientId={encounter.patient_id}
          templates={templates}
          history={noteVersions}
          documents={documents}
          followUps={followUpList.items}
          // ⚠ THE THIRD STATE, WHICH USED TO STOP HERE. listFollowUps returns {items, unavailable, detail}
          // because a failed read rendering as an empty list says "nobody is waiting on you" -- the worst
          // sentence this product can get wrong. page.tsx passed only `.items`, so the tab printed
          // "Nothing is owed to this patient. This was read successfully" over a read that had FAILED.
          followUpsUnavailable={followUpList.unavailable}
          planTemplates={planTemplates}
          facilities={facilities}
          // ⚠ FILTERED TO LIVE AND FUTURE HERE, ON THE SERVER, because scheduleFollowUp refuses anything
          // else by name -- offering a cancelled or past appointment would be drawing a control whose
          // only outcome is a 422. getPatient returns the last 25 in either direction.
          patientAppointments={((patientDetail as any)?.appointments ?? []).filter((a: any) =>
            ["REQUESTED", "CONFIRMED", "ARRIVED"].includes(a.status)
            && String(a.scheduled_at) >= new Date().toISOString())}
          currentUserId={shell.ctx.userId}
          canBook={hasCapability(shell.ctx, "appointment.manage")}
          intervals={intervals}
          procedures={procedures}
          procedureTypes={procedureTypes}
          frequentProcedures={frequentProcs}
          canFollowUp={hasCapability(shell.ctx, "followup.manage")}
          canProcedure={hasCapability(shell.ctx, "procedure.record")}
          canEdit={hasCapability(shell.ctx, "encounter.edit")}
          canSign={hasCapability(shell.ctx, "encounter.sign")}
          canDiagnose={hasCapability(shell.ctx, "diagnosis.record")}
          canTreat={hasCapability(shell.ctx, "treatment.record")}
          canDocument={hasCapability(shell.ctx, "document.author")}
          canTask={hasCapability(shell.ctx, "task.manage")}
          phrases={phrases}
          attachments={attachments}
          drafts={draftState.drafts}
          decisions={extras.decisions}
          investigations={extras.investigations}
          referrals={extras.referrals}
          outcome={extras.outcome}
          outcomeNote={extras.outcomeNote}
          warnings={extras.warnings}
          statusHistory={history}
        />
    </div>
  );
}
