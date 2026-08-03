import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getEncounter, patientTimeline, LOCKED_STATUSES } from "@/lib/practice/encounters";
import { listTemplates, noteHistory, listDocuments } from "@/lib/practice/documentation";
import { listFollowUps, listIntervals } from "@/lib/practice/follow-ups";
import { listProcedures, listProcedureTypes } from "@/lib/practice/procedures";
import EncounterConsole from "./EncounterConsole";

// /practice/encounters/{id} -- CPR-V2-006 V3, the consultation workspace: patient header, the previous
// visit in reach, the SOAP note, diagnoses, treatments, and the state machine that ends in a signature.
//
// The PRIOR TIMELINE is rendered on the same screen rather than behind a tab because the single most
// common clinical question in a follow-up is "what did we do last time" -- CPR-V2-006 V3 calls for prior
// visit context in the consultation view, and a click away is a click too many mid-consultation.
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

  // CPR-130. Only encounter-note templates are offered here: applying a referral-letter template to a
  // SOAP segment is refused by the engine, so offering it would be drawing a button that 422s.
  // CPR-140. The patient's LIVE obligations, not this encounter's -- a follow-up raised at the last
  // visit is exactly what this consultation is supposed to settle, and it would be invisible if the
  // panel only showed what today raised.
  // CPR-150 loads the PATIENT's procedures, not this encounter's, for the same reason CPR-140 loads
  // their live obligations: the outcome of something done last month is learned today, and a panel
  // showing only today's procedures would have nothing to attach it to.
  const [templates, noteVersions, documents, followUps, intervals, procedures, procedureTypes] = await Promise.all([
    listTemplates(admin, shell.ctx.workspaceId, { kind: "encounter_note" }),
    noteHistory(admin, shell.ctx.workspaceId, encounter.id),
    listDocuments(admin, shell.ctx.workspaceId, { encounterId: encounter.id }),
    listFollowUps(admin, shell.ctx.workspaceId, { patientId: encounter.patient_id, status: ["OPEN", "SCHEDULED"] }),
    listIntervals(admin),
    listProcedures(admin, shell.ctx.workspaceId, { patientId: encounter.patient_id, limit: 20 }),
    listProcedureTypes(admin, shell.ctx.workspaceId),
  ]);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{patient?.display_name ?? "Unknown patient"}</h1>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">{encounter.status}</span>
          </div>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {patient?.sex}
            {patient?.birth_date ? ` · b. ${patient.birth_date}` : patient?.age_estimate_years != null ? ` · ~${patient.age_estimate_years}y` : ""}
            {" · "}{String(encounter.entry_pathway).replace(/_/g, " ")}
            {" · "}{String(encounter.encounter_mode).replace(/_/g, " ")}
            {" · started "}{String(encounter.started_at).slice(0, 16).replace("T", " ")}
          </p>
        </div>
        <div className="flex gap-3">
          <Link href={`/practice/patients/${encounter.patient_id}`} className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">Patient record</Link>
          <Link href="/practice/encounters" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">← Encounters</Link>
        </div>
      </div>

      {locked && (
        <div className="mt-3 rounded-xl border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] px-3 py-2">
          <p className="text-[12px] font-bold text-[var(--cmp-text-success)]">
            {encounter.status === "ENTERED_IN_ERROR" ? "Marked as entered in error." : "Signed and locked."}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-700">
            {encounter.signed_at ? `Signed ${String(encounter.signed_at).slice(0, 16).replace("T", " ")}. ` : ""}
            The clinical content can no longer be edited. An amendment creates a governed new version;
            the database refuses any other change.
          </p>
        </div>
      )}

      <div className="mt-4 grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
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
            followUps={followUps}
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
          />
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Previous visits</h2>
            {priors.length === 0 ? (
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
                    {(timeline.diagnosesByEncounter[p.id] ?? []).map((d: any, i: number) => (
                      <p key={i} className="text-[11px] text-gray-500">
                        {d.is_primary ? "▪ " : "· "}{d.label} <span className="text-gray-400">({d.certainty})</span>
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Record history</h2>
            <ul className="mt-2 flex flex-col gap-1">
              {(history as any[]).map((h, i) => (
                <li key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-gray-400">{String(h.occurred_at).slice(0, 16).replace("T", " ")}</span>
                  <span className="text-gray-700">{h.from_status ? `${h.from_status} → ${h.to_status}` : h.to_status}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-gray-400">
              Every transition is recorded here and in the workspace audit log. Neither can be edited from the app.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
