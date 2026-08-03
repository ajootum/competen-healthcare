import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { reviewAccess, privacyPosture } from "@/lib/practice/privacy";

// /practice/privacy -- CPR-370's access review and the honest statement of what this product does.
//
// THE SUMMARY IS THE USEFUL ARTEFACT. A thousand rows of "viewed" is not something anybody reviews;
// "one person opened forty different records last Tuesday" is. So the per-actor roll-up comes first and
// the raw entries follow it.
//
// OPENING THIS PAGE IS ITSELF LOGGED. reviewAccess does it, not this file -- so any future caller gets
// the same treatment without having to remember. The reviewer of a privacy control must not be the one
// person the control cannot see.
//
// NAMES ONLY FOR A CALLER WHO ALREADY HOLDS patient.view. An access log is a list of who your patients
// are; a reviewer without clinical access audits WHO LOOKED without learning WHO ATTENDS.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function PrivacyPage({ searchParams }: {
  searchParams: Promise<{ patientId?: string; actorId?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "access.review")) redirect("/practice/home");

  const { patientId, actorId } = await searchParams;
  const admin = createAdminClient();
  const [review, posture] = await Promise.all([
    reviewAccess(admin, shell.ctx, { patientId, actorId, limit: 150 }),
    privacyPosture(admin, shell.ctx),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-gray-900">Privacy and access</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        Who has read what in this practice. Writes have always been recorded; this is the other half.
      </p>

      {(patientId || actorId) && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          Filtered to {patientId ? "one patient" : "one person"}.
          <Link href="/practice/privacy" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Show everything
          </Link>
        </p>
      )}

      {!review.identified && (
        <p className="mt-3 rounded-lg bg-[var(--cmp-surface-information)] px-3 py-2 text-[12px] text-[var(--cmp-text-information)]">
          Patients appear as references rather than names, because you do not hold clinical access. You
          can audit who looked without that becoming a way to learn who attends.
        </p>
      )}

      {/* Who looked, and how much */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Who has been reading</h2>
        {review.byActor.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nothing recorded in this window.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {review.byActor.map(a => (
              <li key={a.actorId} className="flex items-baseline gap-2 text-[12px]">
                <Link href={`/practice/privacy?actorId=${a.actorId}`} className="font-semibold text-gray-900 hover:underline">
                  {a.name ?? "Unnamed member"}
                </Link>
                <span className="text-gray-600">{a.views} {a.views === 1 ? "read" : "reads"}</span>
                <span className="text-gray-500">across {a.distinctPatients} {a.distinctPatients === 1 ? "patient" : "patients"}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] text-gray-400">
          Counted from the entries below, not stored. A large number is not misconduct &mdash; a busy
          clinic reads a lot. What is worth a second look is a pattern nobody can explain.
        </p>
      </section>

      {/* The entries */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Reads</h2>
        {review.entries.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {review.entries.map((e: any) => (
              <li key={e.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 text-[11px] last:border-0">
                <span className="shrink-0 font-mono text-gray-400">{String(e.occurred_at).slice(0, 16).replace("T", " ")}</span>
                <span className="font-semibold text-gray-800">{e.actor_name ?? "Unnamed member"}</span>
                <span className="text-gray-500">
                  {e.action === "search" ? "searched" : e.action === "export" ? "exported" : e.action === "review" ? "reviewed the access log" : "opened"}
                </span>
                {e.patient_label && (
                  <Link href={`/practice/privacy?patientId=${e.patient_id}`} className="text-gray-700 hover:underline">
                    {e.patient_label}
                  </Link>
                )}
                {e.subject_kind !== "patient" && e.action !== "review" && (
                  <span className="text-gray-400">({e.subject_kind.replace(/_/g, " ")})</span>
                )}
                {e.detail && e.action === "search" && <span className="italic text-gray-500">&ldquo;{e.detail}&rdquo;</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The honest posture */}
      <div className="mt-4 grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-[var(--cmp-color-success)] bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">What is true</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Each of these is a property of the code, checkable in the repository.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {posture.guarantees.map((g, i) => (
              <li key={i} className="text-[12px] text-gray-700">{g}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-[var(--cmp-color-warning)] bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">What is not true yet</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Named rather than implied. A practice deciding whether to trust this deserves the gaps too.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {posture.notYetTrue.map((g, i) => (
              <li key={i} className="text-[12px] text-gray-700">{g}</li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-4 text-[11px] text-gray-400">
        {posture.accessEntries} entries recorded
        {posture.loggingSince ? ` since ${String(posture.loggingSince).slice(0, 10)}` : ""}
        {" · "}the log is append-only and nothing deletes from it.
      </p>
    </div>
  );
}
