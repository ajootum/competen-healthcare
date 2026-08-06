import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getEncounter, patientTimeline, LOCKED_STATUSES } from "@/lib/practice/encounters";
import { encounterExtras } from "@/lib/practice/encounter-workspace";
import { patientSnapshot } from "@/lib/practice/longitudinal";
import { ENCOUNTER_STATUS_CHIP, ENCOUNTER_STATUS_LABEL } from "@/lib/practice/encounter-workspace-constants";
import { listTemplates, noteHistory, listDocuments } from "@/lib/practice/documentation";
import { listPhrases, listAttachments, myDrafts } from "@/lib/practice/documentation-tools";
import { listFollowUps, listIntervals } from "@/lib/practice/follow-ups";
import { listProcedures, listProcedureTypes } from "@/lib/practice/procedures";
import { logAccess } from "@/lib/practice/privacy";
import { formatDayTime } from "@/lib/datetime";
import EncounterConsole from "./EncounterConsole";
import ContextPanel from "./ContextPanel";

// /practice/encounters/{id} -- CPR-ENC-002's three-panel encounter screen.
//
//   LEFT    context that was INHERITED, never asked for: session, location, type, source, practitioner,
//           and the patient snapshot -- problems, treatments, allergies, blood group.
//   MAIN    the eight-tab workspace (EncounterConsole).
//   RIGHT   this encounter's procedures, its timeline, and s6's eight quick actions.
//
// THE PRIOR VISIT IS ON THIS SCREEN rather than behind a tab because the single most common clinical
// question in a follow-up is "what did we do last time", and a click away is a click too many
// mid-consultation.
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
    phrases, attachments, draftState, snapshot, session, practitioner,
  ] = await Promise.all([
    listTemplates(admin, shell.ctx.workspaceId, { kind: "encounter_note" }),
    noteHistory(admin, shell.ctx.workspaceId, encounter.id),
    listDocuments(admin, shell.ctx.workspaceId, { encounterId: encounter.id }),
    listFollowUps(admin, shell.ctx.workspaceId, { patientId: encounter.patient_id, status: ["OPEN", "SCHEDULED"] }),
    listIntervals(admin),
    listProcedures(admin, shell.ctx.workspaceId, { patientId: encounter.patient_id, limit: 20 }),
    listProcedureTypes(admin, shell.ctx.workspaceId),
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

  return (
    <div className="max-w-[1400px]">
      {/* ── The patient strip (CPR-ENC-002's header) ────────────────────────────────────────────── */}
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
            {/* Hospital numbers (CPR-ENC-003 s3's "multiple hospital identifiers"). */}
            {snapshot.identifiers.items.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-1">
                {snapshot.identifiers.items.map(i => (
                  <li key={i.id} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-mono text-gray-600">
                    {i.value}
                    <span className="ml-1 font-sans text-[9px] uppercase text-gray-400">{i.type.replace(/_/g, " ")}</span>
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

      <div className="mt-4 grid gap-4 xl:grid-cols-[280px_1fr]">
        {/* ══ LEFT CONTEXT PANEL ═══════════════════════════════════════════════════════════════ */}
        <div className="flex flex-col gap-3">
          <ContextPanel
            snapshot={snapshot}
            encounter={encounter}
            sessionTitle={sessionRow?.title ?? null}
            sessionUnavailable={sessionUnavailable}
            facility={sessionRow?.practice_facility?.name ?? sessionRow?.practice_location?.name ?? null}
            practitionerName={(practitioner as any)?.data?.full_name ?? null}
          />

          <section className="rounded-xl border border-gray-200 bg-white p-3.5">
            <h2 className="text-[13px] font-bold text-gray-900">Previous visits</h2>
            {/* ⚠ "THIS IS THE FIRST RECORDED ENCOUNTER" IS THE STRONGEST CLAIM ON THIS PAGE, and it is
                read DURING a consultation, by somebody deciding how much history to take. A failed
                timeline read used to produce exactly that sentence. */}
            {timeline.unavailable ? (
              <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
                Previous visits could not be read. Do <strong>not</strong> take this as a first visit.
              </p>
            ) : priors.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">This is the first recorded encounter for this patient.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {priors.map(p => (
                  <li key={p.id} className="border-l-2 border-gray-100 pl-2">
                    <Link href={`/practice/encounters/${p.id}`} className="text-[12px] font-semibold text-gray-800 hover:underline">
                      {String(p.started_at).slice(0, 10)}
                    </Link>
                    <span className="ml-1.5 text-[10px] text-gray-400">{p.status}</span>
                    {p.reason_for_visit && <p className="text-[11px] text-gray-600">{p.reason_for_visit}</p>}
                    {timeline.diagnosesUnavailable ? (
                      <p className="text-[11px] text-[var(--cmp-text-critical)]">Diagnoses could not be read.</p>
                    ) : (timeline.diagnosesByEncounter[p.id] ?? []).map((d: any, i: number) => (
                      <p key={i} className="text-[11px] text-gray-500">
                        {d.is_primary ? "▪ " : "· "}{d.label} <span className="text-gray-400">({d.certainty})</span>
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ══ MAIN WORKSPACE + RIGHT ACTIONS ═══════════════════════════════════════════════════ */}
        <EncounterConsole
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
          intervals={intervals}
          procedures={procedures}
          procedureTypes={procedureTypes}
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
    </div>
  );
}
