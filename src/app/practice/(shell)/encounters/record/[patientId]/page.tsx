import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import {
  patientSnapshot, clinicalTimeline, journeyCounts,
  problemHistory, treatmentHistory, procedureHistory, outcomeHistory, followUpHistory,
} from "@/lib/practice/longitudinal";
import { referralHistory, investigationHistory } from "@/lib/practice/encounter-workspace";
import { SAFETY_TONE, ENCOUNTER_STATUS_CHIP } from "@/lib/practice/encounter-workspace-constants";
import { MILESTONE_KINDS } from "@/lib/practice/longitudinal-constants";
import { workspaceClock } from "@/lib/practice/practice-time";
import { logAccess } from "@/lib/practice/privacy";
import { formatDate } from "@/lib/datetime";
import JourneyView from "./JourneyView";

// /practice/encounters/record/{patientId} -- CPR-ENC-003, the longitudinal patient record.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY IT LIVES UNDER /encounters. This is the practitioner's cumulative clinical memory, assembled out
// of encounters: every stream on it (problems, treatments, procedures, investigations, referrals,
// outcomes, follow-ups) is something an encounter produced. The patient REGISTER at /practice/patients
// answers "who is this person"; this screen answers "what has happened between us".
//
// ⚠ NOTHING ON THIS PAGE INFERS A CLINICAL STATE. There is no trajectory arrow, no "improving" chip, no
// adherence percentage, no interval between visits presented as a pattern. Every figure is a count of
// rows or a date read off one. The only judgements shown are the ones a practitioner typed: the outcome
// they chose, and the milestones they recorded.
//
// ⚠ AND NOTHING ON THIS PAGE PRINTS "NO KNOWN ALLERGIES" ON ITS OWN AUTHORITY. The sentence comes from
// allergyLine(), which reads the STATUS column and never the length of the list.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const CARD = "rounded-xl border border-gray-200 bg-white p-4";
const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-gray-400";

const MILESTONE_LABEL = new Map(MILESTONE_KINDS);

function Figure({ label, value, missing }: { label: string; value: string | number | null; missing: string }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      {/* ⚠ A FIGURE THAT COULD NOT BE READ IS NOT A NOUGHT AND NOT A BLANK. */}
      <p className={`text-[14px] font-bold ${value === null ? "text-slate-300" : "text-gray-900"}`}>
        {value === null ? missing : value}
      </p>
    </div>
  );
}

export default async function PatientRecordPage({ params }: { params: Promise<{ patientId: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "patient.view")) redirect("/practice/home");

  const { patientId } = await params;
  const admin = createAdminClient();

  const snapshot = await patientSnapshot(admin, shell.ctx, patientId);
  // A patient in another practice is notFound(), not 403 -- the same object-level rule as everywhere
  // else. `unavailable` is DIFFERENT: the record may well exist and the read failed, so it is shown.
  if (!snapshot.unavailable && !snapshot.patient) notFound();

  await logAccess(admin, {
    workspaceId: shell.ctx.workspaceId, actorId: shell.ctx.userId, subjectKind: "patient",
    subjectId: patientId, patientId, route: "/practice/encounters/record/[patientId]",
  });

  const [clock, timeline, counts, problems, treatments, procedures, outcomes, followUps, referrals, investigations] =
    await Promise.all([
      workspaceClock(admin, shell.ctx.workspaceId),
      clinicalTimeline(admin, shell.ctx, patientId, { limit: 60 }),
      journeyCounts(admin, shell.ctx, patientId),
      problemHistory(admin, shell.ctx, patientId),
      treatmentHistory(admin, shell.ctx, patientId),
      procedureHistory(admin, shell.ctx, patientId),
      outcomeHistory(admin, shell.ctx, patientId),
      followUpHistory(admin, shell.ctx, patientId),
      referralHistory(admin, shell.ctx, patientId),
      investigationHistory(admin, shell.ctx, patientId),
    ]);

  const p = snapshot.patient;

  const listState = (
    panel: { permitted: boolean; unavailable: boolean }, what: string, empty: string,
  ) => !panel.permitted
    ? <p className="mt-2 text-[11px] text-gray-500">Not visible to you.</p>
    : panel.unavailable
      ? <p className="mt-2 text-[11px] text-rose-700"><strong>{what} could not be read.</strong> Not an empty list.</p>
      : <p className="mt-2 text-[11px] text-gray-400">{empty}</p>;

  return (
    <div className="max-w-[1400px]">
      {/* ── Header ─────────────────────────────────────────────────────────────────────────────── */}
      <div className={CARD}>
        <Link href="/practice/encounters" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          ← Back to encounters
        </Link>

        {snapshot.unavailable ? (
          <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
            <strong>The patient record could not be read.</strong> Nothing on this page is a statement about
            this patient.
          </p>
        ) : (
          <>
            <div className="mt-1 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-xl font-bold text-gray-900">{p?.displayName}</h1>
                <p className="text-[13px] text-gray-500">
                  {p?.sex}
                  {p?.birthDate ? ` · b. ${p.birthDate}` : p?.ageEstimateYears != null ? ` · ~${p.ageEstimateYears}y` : ""}
                  {p?.status !== "active" ? ` · ${p?.status}` : ""}
                </p>
                {snapshot.identifiers.items.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {snapshot.identifiers.items.map(i => (
                      <li key={i.id} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600">
                        {i.value}
                        <span className="ml-1 font-sans text-[9px] uppercase text-gray-400">{i.type.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {snapshot.identifiers.unavailable && (
                  <p className="mt-1 text-[11px] text-rose-700">Hospital numbers could not be read.</p>
                )}
              </div>

              <div className="flex items-end gap-6">
                <Figure label="First seen" value={counts.firstSeen ? formatDate(`${counts.firstSeen}T00:00:00Z`, "UTC") : (counts.permitted && !counts.unavailable ? "—" : null)} missing="unreadable" />
                <Figure label="Last seen" value={counts.lastSeen ? formatDate(`${counts.lastSeen}T00:00:00Z`, "UTC") : (counts.permitted && !counts.unavailable ? "—" : null)} missing="unreadable" />
                <Figure label="Encounters" value={counts.encounters} missing={counts.permitted ? "unreadable" : "hidden"} />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[250px_1fr_280px]">
        {/* ══ LEFT: SNAPSHOT ═══════════════════════════════════════════════════════════════════ */}
        <div className="flex flex-col gap-3">
          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Patient snapshot</h2>

            <div className="mt-2.5">
              <p className={LABEL}>Allergies</p>
              {/* ⚠ THE ONE SENTENCE ON THIS PAGE THAT COULD KILL SOMEBODY IF IT WERE WRONG. It comes
                  from allergyLine(), which reads the allergy_status COLUMN. An empty list means nobody
                  has asked, and this page says exactly that rather than the reassuring thing. */}
              <p className={`mt-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${SAFETY_TONE[snapshot.allergies.tone]}`}>
                {snapshot.allergies.text}
              </p>
              {snapshot.allergyList.items.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {snapshot.allergyList.items.map(a => (
                    <li key={a.id} className="text-[11px] text-gray-700">
                      <span className="font-semibold">{a.substance}</span>
                      {a.reaction ? ` — ${a.reaction}` : ""}
                      <span className="text-gray-400">{a.severity ? ` · ${a.severity}` : ""} · {a.certainty}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-3">
              <p className={LABEL}>Blood group</p>
              <p className={`text-[12px] ${snapshot.bloodGroup.tone === "present" ? "font-semibold text-gray-800" : "text-gray-400"}`}>
                {snapshot.bloodGroup.text}
              </p>
            </div>

            <div className="mt-3">
              <p className={LABEL}>Active problems</p>
              {snapshot.activeProblems.items.length === 0
                ? listState(snapshot.activeProblems, "Problems", "None on the problem list.")
                : (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {snapshot.activeProblems.items.map(x => (
                      <li key={x.id} className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">{x.label}</li>
                    ))}
                  </ul>
                )}
            </div>

            <div className="mt-3">
              <p className={LABEL}>Current treatments</p>
              {snapshot.currentTreatments.items.length === 0
                ? listState(snapshot.currentTreatments, "Treatments", "Nothing recorded.")
                : (
                  <ul className="mt-1 flex flex-col gap-1">
                    {snapshot.currentTreatments.items.slice(0, 8).map(t => (
                      <li key={t.id} className="rounded bg-gray-50 px-1.5 py-1 text-[11px] text-gray-700">
                        {t.label}<span className="text-gray-400"> {[t.dose, t.frequency].filter(Boolean).join(" ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              <p className="mt-1 text-[10px] text-gray-400">
                What was recorded, not a reconciled medication list.
              </p>
            </div>
          </section>

          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Quick links</h2>
            <ul className="mt-2 flex flex-col gap-1.5 text-[12px]">
              {/* ⚠ THIS SENT YOU TO /practice/patients TO SEARCH FOR THE PATIENT WHOSE RECORD YOU WERE
                  READING. The page knows the patient -- it is in the URL -- and it threw that away. The
                  same defect as "+ Start encounter" on the encounters board, and worse, because here
                  there was nothing to work out.

                  It goes to the patient's own page rather than starting one from here: PatientActions
                  already carries a real Start encounter that resumes rather than duplicates and is gated
                  on the capability. A second implementation beside it is a second place for the
                  resume-before-create rule to be got wrong. */}
              <li><Link href={`/practice/patients/${patientId}`} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Start an encounter for this patient</Link></li>
              <li><Link href="/practice/follow-ups" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Follow-up board</Link></li>
              <li><Link href="/practice/documents" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Documents</Link></li>
              <li><Link href="/practice/inbox" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Arrived documents</Link></li>
            </ul>
          </section>
        </div>

        {/* ══ MIDDLE: THE JOURNEY ══════════════════════════════════════════════════════════════ */}
        <div className={CARD}>
          <JourneyView
            patientId={patientId}
            events={timeline.events}
            sourcesUnavailable={timeline.sourcesUnavailable}
            sourcesDenied={timeline.sourcesDenied}
            timelineUnavailable={timeline.unavailable}
            timelinePermitted={timeline.permitted}
            canRecordMilestone={hasCapability(shell.ctx, "patient.edit")}
            today={clock.today}
          />
        </div>

        {/* ══ RIGHT: THE LONGITUDINAL ENGINES (CPR-ENC-003 s5) ═════════════════════════════════ */}
        <div className="flex flex-col gap-3">
          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">
              Problems{problems.permitted && !problems.unavailable ? ` (${problems.items.length})` : ""}
            </h2>
            {problems.items.length === 0
              ? listState(problems, "Problems", "None recorded.")
              : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {problems.items.map(x => (
                    <li key={x.id} className="text-[12px]">
                      <span className="font-semibold text-gray-800">{x.label}</span>
                      <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${x.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {x.status}
                      </span>
                      {x.onsetDate && <p className="text-[10px] text-gray-400">from {x.onsetDate}</p>}
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Treatment timeline</h2>
            {treatments.items.length === 0
              ? listState(treatments, "Treatments", "None recorded.")
              : (
                <ul className="mt-2 flex flex-col gap-1">
                  {treatments.items.slice(0, 10).map(t => (
                    <li key={t.id} className="flex items-baseline gap-2 text-[11px]">
                      <span className="w-16 shrink-0 font-mono text-gray-400">{String(t.recordedAt).slice(0, 10)}</span>
                      <span className="text-gray-700">{t.label}{t.dose ? ` ${t.dose}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Procedure history</h2>
            {procedures.items.length === 0
              ? listState(procedures, "Procedures", "None recorded.")
              : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {procedures.items.slice(0, 10).map(x => (
                    <li key={x.id} className="text-[11px]">
                      <span className="font-mono text-gray-400">{String(x.performedAt).slice(0, 10)}</span>{" "}
                      <span className="text-gray-800">{x.label}</span>
                      {x.outcomes.map(o => (
                        <p key={o.id} className={`text-[10px] ${o.outcomeType === "complication" ? "font-semibold text-rose-700" : "text-gray-500"}`}>
                          {o.observedOn} · {o.outcomeType}{o.severity ? ` (${o.severity})` : ""} · {o.detail}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            {procedures.detail && <p className="mt-1 text-[10px] text-rose-700">{procedures.detail}</p>}
          </section>

          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Investigations</h2>
            <p className="text-[10px] text-gray-400">Type only. No results are held in this product.</p>
            {investigations.items.length === 0
              ? listState(investigations, "Investigations", "None recorded.")
              : (
                <ul className="mt-2 flex flex-col gap-1">
                  {investigations.items.slice(0, 10).map(i => (
                    <li key={i.id} className="text-[11px]">
                      <span className="font-mono text-gray-400">{String(i.requestedAt).slice(0, 10)}</span>{" "}
                      <span className="text-gray-800">{i.label}</span>
                      <span className="ml-1 text-gray-400">({i.status})</span>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Referrals</h2>
            <p className="text-[10px] text-gray-400">Recorded, not sent.</p>
            {referrals.items.length === 0
              ? listState(referrals, "Referrals", "None recorded.")
              : (
                <ul className="mt-2 flex flex-col gap-1">
                  {referrals.items.slice(0, 10).map(r => (
                    <li key={r.id} className="text-[11px]">
                      <span className="font-mono text-gray-400">{r.referredOn}</span>{" "}
                      <span className="text-gray-800">{r.referredTo}</span>
                      <span className="ml-1 text-gray-400">({r.status})</span>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Outcome history</h2>
            {outcomes.items.length === 0
              ? listState(outcomes, "Outcomes", "No encounter has an outcome recorded.")
              : (
                <ul className="mt-2 flex flex-col gap-1">
                  {outcomes.items.slice(0, 10).map(o => (
                    <li key={o.encounterId} className="flex items-baseline gap-2 text-[11px]">
                      <span className="w-16 shrink-0 font-mono text-gray-400">{o.on}</span>
                      <Link href={`/practice/encounters/${o.encounterId}`} className="capitalize text-gray-800 hover:underline">
                        {o.outcome}
                      </Link>
                      <span className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold ${ENCOUNTER_STATUS_CHIP[o.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {o.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            <p className="mt-1 text-[10px] text-gray-400">
              Only encounters where an outcome was chosen. The rest have none &mdash; which is not
              &ldquo;stable&rdquo;.
            </p>
          </section>

          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Follow-ups</h2>
            {followUps.items.length === 0
              ? listState(followUps, "Follow-ups", "None raised.")
              : (
                <ul className="mt-2 flex flex-col gap-1">
                  {followUps.items.slice(0, 10).map(f => (
                    <li key={f.id} className="text-[11px]">
                      <span className="font-mono text-gray-400">{f.dueOn}</span>{" "}
                      <span className="text-gray-800">{f.reason}</span>
                      <span className="ml-1 text-gray-400">({f.status})</span>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Clinical milestones</h2>
            {/* ⚠ EVERY ONE OF THESE WAS TYPED BY A PRACTITIONER. Nothing in this product derives a
                milestone from the timeline -- `significant improvement` and `relapse` are clinical
                judgements, and one computed from a pattern would be indistinguishable from one somebody
                put their name to. */}
            {snapshot.milestones.items.length === 0
              ? listState(snapshot.milestones, "Milestones", "None recorded. Nothing computes these — add one from the timeline.")
              : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {snapshot.milestones.items.map(m => (
                    <li key={m.id} className="text-[11px]">
                      <span className="font-mono text-gray-400">{m.occurredOn}</span>{" "}
                      <span className="font-semibold text-gray-800">{m.label}</span>
                      <p className="text-[10px] text-gray-500">{MILESTONE_LABEL.get(m.kind) ?? m.kind}</p>
                      {m.note && <p className="text-[10px] text-gray-600">{m.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
          </section>
        </div>
      </div>
    </div>
  );
}
