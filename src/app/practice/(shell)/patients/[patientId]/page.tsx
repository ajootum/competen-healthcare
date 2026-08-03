import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getPatient } from "@/lib/practice/patients";
import { patientTimeline } from "@/lib/practice/encounters";
import PatientActions from "./PatientActions";

// /practice/patients/{id} -- the Phase-2 slice of CPR-V2-002's patient workspace: identity, identifiers,
// contacts and the diary history, plus book-for-patient. The clinical timeline, problems and documents
// arrive with their phases and are named as such. Object-level access: a patient outside the caller's
// workspace is notFound(), indistinguishable from a patient that never existed (SHELL-001 s6.2).
//
// A MERGED patient renders as a signpost to the survivor, not as an editable record and not as a 404 --
// the row exists precisely so history is followable (DM-001 s6.1).

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function PatientPage({ params }: { params: Promise<{ patientId: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "patient.view")) redirect("/practice/home");

  const { patientId } = await params;
  const admin = createAdminClient();
  const detail = await getPatient(admin, shell.ctx.workspaceId, patientId);
  if (!detail) notFound();

  const { patient, identifiers, contacts, appointments } = detail;
  const practiceId = (identifiers as any[]).find(i => i.identifier_type === "practice_id")?.value ?? null;
  const timeline = hasCapability(shell.ctx, "encounter.list")
    ? await patientTimeline(admin, shell.ctx.workspaceId, patientId, 20)
    : { encounters: [] as any[], diagnosesByEncounter: {} as Record<string, any[]> };

  if (patient.status === "merged") {
    return (
      <div className="max-w-3xl">
        <h1 className="text-xl font-bold text-gray-900">{patient.display_name}</h1>
        <div className="mt-4 rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
          <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">This record was merged.</p>
          <p className="mt-1 text-[12px] text-gray-700">
            Its identifiers, contacts and appointments now live on the surviving record.
          </p>
          {patient.merged_into_patient_id && (
            <Link href={`/practice/patients/${patient.merged_into_patient_id}`}
              className="mt-2 inline-block text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Open the surviving record →
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{patient.display_name}</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {practiceId && <span className="font-mono">{practiceId}</span>}
            {" · "}{patient.sex}
            {patient.birth_date ? ` · b. ${patient.birth_date}` : patient.age_estimate_years != null ? ` · ~${patient.age_estimate_years}y` : ""}
            {" · "}{patient.status}
          </p>
        </div>
        <Link href="/practice/patients" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">← Registry</Link>
      </div>

      <div className="mt-4 grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Identifiers</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {(identifiers as any[]).map(i => (
              <li key={i.id} className="flex items-center gap-2 text-[12px]">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{i.identifier_type.replace(/_/g, " ")}</span>
                <span className="font-mono text-gray-800">{i.value}</span>
                {i.issuer && <span className="text-gray-400">({i.issuer})</span>}
                {i.valid_to && <span className="text-[10px] text-gray-400">historical</span>}
              </li>
            ))}
          </ul>

          <h2 className="mt-4 text-[13px] font-bold text-gray-900">Contacts</h2>
          {(contacts as any[]).length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-400">None recorded.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {(contacts as any[]).map(c => (
                <li key={c.id} className="flex items-center gap-2 text-[12px]">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{c.contact_type}</span>
                  <span className="text-gray-800">{c.value}</span>
                  {c.preferred && <span className="text-[10px] font-semibold text-[var(--cmp-text-success)]">preferred</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <PatientActions
          patientId={patient.id}
          displayName={patient.display_name}
          sex={patient.sex}
          birthDate={patient.birth_date}
          ageEstimateYears={patient.age_estimate_years}
          recordVersion={patient.record_version}
          hasPriorEncounter={(timeline.encounters as any[]).length > 0}
          canEdit={hasCapability(shell.ctx, "patient.edit")}
          canMerge={hasCapability(shell.ctx, "patient.merge")}
          canBook={hasCapability(shell.ctx, "appointment.manage")}
          canStartEncounter={hasCapability(shell.ctx, "encounter.create")}
        />
      </div>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Appointment history</h2>
        {(appointments as any[]).length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">
            No linked appointments yet. Diary entries made before this patient was registered carry a name
            only and stay on the calendar.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {(appointments as any[]).map(a => (
              <li key={a.id} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono text-gray-500">{String(a.scheduled_at).slice(0, 16).replace("T", " ")}</span>
                <span className="text-gray-700">{String(a.appointment_type).replace(/_/g, " ")}</span>
                <span className="ml-auto text-gray-500">{a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hasCapability(shell.ctx, "encounter.list") && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Clinical timeline</h2>
          {(timeline.encounters as any[]).length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">No encounters recorded for this patient yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {(timeline.encounters as any[]).map(e => (
                <li key={e.id} className="border-l-2 border-gray-100 pl-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/practice/encounters/${e.id}`} className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                      {String(e.started_at).slice(0, 16).replace("T", " ")}
                    </Link>
                    <span className="text-[11px] text-gray-400">
                      {String(e.entry_pathway).replace(/_/g, " ")} · {String(e.encounter_mode).replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto text-[10px] font-bold text-gray-500">{e.status}</span>
                  </div>
                  {e.reason_for_visit && <p className="text-[11px] text-gray-600">{e.reason_for_visit}</p>}
                  {(timeline.diagnosesByEncounter[e.id] ?? []).map((d: any, i: number) => (
                    <p key={i} className="text-[11px] text-gray-500">
                      {d.is_primary ? "▪ " : "· "}{d.label} <span className="text-gray-400">({d.certainty})</span>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[10px] text-gray-400">
            The 20 most recent encounters. Documents and attachments arrive with Phase 4.
          </p>
        </section>
      )}
    </div>
  );
}
