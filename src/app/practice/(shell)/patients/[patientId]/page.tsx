import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getPatient } from "@/lib/practice/patients";
import { patientTimeline } from "@/lib/practice/encounters";
import { listFollowUps } from "@/lib/practice/follow-ups";
import { patientFollowUps } from "@/lib/practice/follow-up-plans";
import { patientCorrespondence } from "@/lib/practice/document-library";
import FollowUpPanel from "./FollowUpPanel";
import { listContacts } from "@/lib/practice/communication";
import { logAccess, patientAccessHistory } from "@/lib/practice/privacy";
import PatientActions from "./PatientActions";
import ContactLog from "./ContactLog";

// /practice/patients/{id} -- the Phase-2 slice of CPR-V2-002's patient workspace: identity, identifiers,
// contacts and the diary history, plus book-for-patient. The clinical timeline, problems and documents
// arrive with their phases and are named as such. Object-level access: a patient outside the caller's
// workspace is notFound(), indistinguishable from a patient that never existed (SHELL-001 s6.2).
//
// A MERGED patient renders as a signpost to the survivor, not as an editable record and not as a 404 --
// the row exists precisely so history is followable (DM-001 s6.1).

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function PatientPage({ params, searchParams }: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ followUp?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "patient.view")) redirect("/practice/home");

  const { patientId } = await params;
  const { followUp: followUpTab } = await searchParams;
  const admin = createAdminClient();
  const detail = await getPatient(admin, shell.ctx.workspaceId, patientId);
  if (!detail) notFound();

  const { patient, identifiers, contacts, appointments } = detail;
  const practiceId = (identifiers as any[]).find(i => i.identifier_type === "practice_id")?.value ?? null;
  // THREE STATES, NOT TWO. Not permitted to see encounters, could not read them, and there are none --
  // and only the last of those means the patient has no history here. `unavailable: false` on the
  // capability branch is correct and deliberate: nothing failed, the caller simply may not look.
  const timeline = hasCapability(shell.ctx, "encounter.list")
    ? await patientTimeline(admin, shell.ctx.workspaceId, patientId, 20)
    : {
      encounters: [] as any[], diagnosesByEncounter: {} as Record<string, any[]>,
      unavailable: false, diagnosesUnavailable: false, detail: null as string | null,
    };
  // CPR-140. Read-only here: the actions live where the clinical context is, in the consultation and on
  // the board. What this record owes is a fact about the patient and belongs on their page.
  //
  // THE FULL PATIENT-CENTRIC VIEW arrived with migration 206 -- plans, adherence and the comp's tabs.
  // listFollowUps is still called because the contact log takes the open ones to file a call against.
  const canSeeFollowUps = hasCapability(shell.ctx, "followup.view");
  const followUps = canSeeFollowUps
    ? (await listFollowUps(admin, shell.ctx.workspaceId, { patientId, status: ["OPEN", "SCHEDULED"] })).items
    : [];
  const followUpView = canSeeFollowUps
    ? await patientFollowUps(admin, shell.ctx.workspaceId, patientId)
    : null;
  // CPR-320. The register of contact WITH this person -- calls made, messages left. Recorded, never
  // sent. Named contactLog, not contacts: `contacts` on this page is already the patient's phone
  // numbers from migration 193 -- the same collision that renamed the table itself.
  const contactLog = await listContacts(admin, shell.ctx.workspaceId, { patientId, limit: 15 });
  // CPR-320. Composed from documents issued, copies released, documents received and calls recorded --
  // no table of its own, because those four already hold every fact it shows.
  const correspondence = hasCapability(shell.ctx, "document.view")
    ? await patientCorrespondence(admin, shell.ctx.workspaceId, patientId)
    : null;

  // CPR-370. THE READ THAT MATTERS MOST, logged after notFound() so a probe for another practice's id
  // leaves no trail suggesting it was seen. The history is fetched for the panel below; it deliberately
  // includes this very visit once the page is next opened, because a log that hides the reader looking
  // at the log is not a log.
  await logAccess(admin, {
    workspaceId: shell.ctx.workspaceId, actorId: shell.ctx.userId, subjectKind: "patient",
    subjectId: patientId, patientId, route: "/practice/patients/[id]",
  });
  const accessHistory = hasCapability(shell.ctx, "access.review")
    ? await patientAccessHistory(admin, shell.ctx.workspaceId, patientId, 12)
    : null;

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
          // null when the history could not be READ -- PatientActions refuses to pick a visit type on a
          // guess, because entry_pathway is written onto the encounter and stays there.
          hasPriorEncounter={timeline.unavailable ? null : (timeline.encounters as any[]).length > 0}
          canEdit={hasCapability(shell.ctx, "patient.edit")}
          canMerge={hasCapability(shell.ctx, "patient.merge")}
          canBook={hasCapability(shell.ctx, "appointment.manage")}
          canStartEncounter={hasCapability(shell.ctx, "encounter.create")}
        />
      </div>

      {followUpView && followUpView.all.length > 0 && (
        <FollowUpPanel view={followUpView} patientId={patientId} tab={followUpTab ?? "upcoming"} />
      )}

      {correspondence && correspondence.entries.length > 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-[13px] font-bold text-gray-900">Correspondence</h2>
            <span className="text-[11px] text-gray-500">
              {correspondence.issued} issued · {correspondence.received} received ·{" "}
              {correspondence.copiesReleased} {correspondence.copiesReleased === 1 ? "copy" : "copies"} released ·{" "}
              {correspondence.contacts} recorded
            </span>
          </div>
          {/* CPR-320. ONE TIMELINE, composed from what already exists -- documents issued, copies
              released, documents received, calls recorded. A correspondence table would be a fourth
              copy of facts three tables already hold, and it would drift the first time somebody wrote
              to one and not the other. */}
          <ul className="mt-2 flex flex-col">
            {correspondence.entries.slice(0, 12).map((e: any) => (
              <li key={`-`} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className="min-w-0">
                  <Link href={e.href} className="block truncate text-[12px] font-semibold text-gray-800 hover:underline">
                    {e.title}
                  </Link>
                  <span className="block text-[10px] text-gray-500">{e.detail}</span>
                </span>
                <span className="ml-auto shrink-0 text-right">
                  <span className="block text-[10px] text-gray-500">{String(e.at).slice(0, 10)}</span>
                  <span className="block text-[10px] text-gray-400">{e.status}</span>
                </span>
              </li>
            ))}
          </ul>
          {/* The sentence this panel must not lose. */}
          <p className="mt-2 text-[10px] text-gray-500">
            Nothing here was sent by this product &mdash; there is no email, SMS or patient-messaging
            channel. A released copy is somebody recording that they printed or handed something over.
          </p>
        </section>
      )}

      <ContactLog
        patientId={patientId}
        contacts={contactLog}
        followUps={followUps as never[]}
        canRecord={hasCapability(shell.ctx, "comm.record")}
      />

      {/* CPR-370. Who has opened this record. The question a patient is most entitled to ask, and the
          one this product could not answer before the access log existed. */}
      {accessHistory && accessHistory.entries.length > 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[13px] font-bold text-gray-900">Who has opened this record</h2>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
              {accessHistory.distinctActors} {accessHistory.distinctActors === 1 ? "person" : "people"}
            </span>
            <Link href={`/practice/privacy?patientId=${patientId}`} className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Full access log →
            </Link>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {accessHistory.entries.map((e: any) => (
              <li key={e.id} className="flex items-baseline gap-2 text-[11px]">
                <span className="font-mono text-gray-400">{String(e.occurred_at).slice(0, 16).replace("T", " ")}</span>
                <span className="font-semibold text-gray-700">{e.actor_name ?? "Unnamed member"}</span>
                <span className="text-gray-500">{e.action === "export" ? "exported" : "opened"} the {e.subject_kind.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-400">
            Every read through this application, including your own just now. The log is append-only &mdash;
            the database refuses to change or remove an entry.
          </p>
        </section>
      )}

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
          {/* ⚠ "NO ENCOUNTERS RECORDED" IS A CLINICAL CLAIM, and until this it was also what a failed
              read looked like. A clinician reading an empty timeline concludes the patient has no
              history here; there is nothing on the screen to suggest otherwise, and the decisions that
              follow are different ones. The two are now different sentences. */}
          {timeline.unavailable ? (
            <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
              This patient&rsquo;s clinical history could not be read. This is <strong>not</strong> the same
              as having none &mdash; do not treat this patient as new.
            </p>
          ) : (timeline.encounters as any[]).length === 0 ? (
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
