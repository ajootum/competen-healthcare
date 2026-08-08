import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { medicationWorklist, medicationTimeline, medicationStorePresence } from "@/lib/practice/medication";
import {
  MEDICATION_EVENT_LABEL, MEDICATION_STATUS_LABEL, MEDICATION_SOURCE_LABEL,
  MEDICATION_STATUS_CHIP, DEFERRED_SAFETY_CHECKS, MEDICATION_REFUSALS,
  DOSE_BASIS_LABEL, doseSafetyNotice,
} from "@/lib/practice/medication-constants";
import { NotCheckedPanel } from "../patients/[patientId]/MedicationPanel";

// /practice/medications -- CPR-MED-001's PRACTICE-LEVEL WORKLIST, and s6's timeline reader.
//
// ⚠ THIS ROUTE HAS NO SIDEBAR ENTRY AND THAT IS DELIBERATE, NOT AN OMISSION.
//
// navigation.ts's PRIMARY_ORDER is nine items and carries its own freeze notice: "THIS IS THE THIRD
// NAVIGATION IN THIS FILE AND THE LAST ... V5-002 is the DESIGN FREEZE." CPR-MED-001 contains no
// navigation section -- its s8 "Integrations" is a list of engines this one reads from and writes to,
// six of the seven of which already exist. The comp draws a "Medications" sidebar item beside Tasks, AI
// Assistant and Reports, all three of which were deliberately REMOVED from the primary list by
// CPR-V5-002 and CPR-PI-001 s15. A picture drawn before two written decisions is not a proposal to undo
// them.
//
// So this follows the /practice/pathways precedent: a whole workspace reached from the screens that own
// it, with an entry in the harness's NO_NAV_ENTRY_BY_DESIGN allowlist giving the written reason. It is
// linked from the Medications panel on every patient page.
//
// ⚠ AND THE PAGE MUST BE HONEST BEFORE THE SIDEBAR IS. Assertion 9f requires every nav entry to point at
// a page that EXISTS. The page ships first, the entry follows if the user wants one -- never the other
// way round, which is how a sidebar item becomes a 404.

export const dynamic = "force-dynamic";

const CARD = "rounded-xl border border-gray-200 bg-white p-4";

export default async function MedicationsPage({ searchParams }: {
  searchParams: Promise<{ medicationId?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "medication.view")) redirect("/practice/home");

  const { medicationId } = await searchParams;
  const admin = createAdminClient();

  // ⚠ ASKED, NOT ASSUMED, AND NOT VIA head+count. A missing table and an empty table both return
  // count === null, and reading that as "missing" is the trap that produced four wrong answers in the
  // survey this build follows. The error CODE is the only thing that tells them apart.
  const store = await medicationStorePresence(admin);
  const worklist = await medicationWorklist(admin, shell.ctx);
  const timeline = medicationId ? await medicationTimeline(admin, shell.ctx, medicationId) : null;

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Medications</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            What this practice has recorded, what is waiting to be reviewed, and what is due a look.
          </p>
        </div>
        <Link href="/practice/patients" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          Patients &rarr;
        </Link>
      </div>

      {/* ⚠ ABSENT IS NOT EMPTY, AND IT NAMES THE MIGRATION. Nobody should have to guess what is missing,
          and "no medications recorded" would be a clinical claim this deployment cannot make. */}
      {store.state !== "present" && (
        <div className="mt-4 rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
          <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
            {store.state === "absent" ? "The medication store is not in this deployment." : "The medication store could not be read."}
          </p>
          <p className="mt-1 text-[12px] text-gray-700">{store.detail}</p>
          <p className="mt-2 text-[11px] text-gray-600">
            Missing migration: <span className="font-mono">{store.migration}</span>
          </p>
          <ul className="mt-2 flex flex-wrap gap-1">
            {store.tables.map(t => (
              <li key={t.table} className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">
                {t.table}: {t.present ? "present" : "absent"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {timeline && <Timeline timeline={timeline} />}

      <div className="mt-4 grid lg:grid-cols-2 gap-4">
        {/* MED s7. Every figure is the length of a list you can open. */}
        <section className={CARD}>
          <h2 className="text-[13px] font-bold text-gray-900">
            Reviews due{worklist.reviewsOverdue.unavailable ? "" : ` (${worklist.reviewsOverdue.items.length})`}
          </h2>
          {worklist.reviewsOverdue.unavailable ? (
            <p className="mt-1 text-[12px] text-[var(--cmp-text-critical)]">{worklist.reviewsOverdue.detail}</p>
          ) : worklist.reviewsOverdue.items.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-400">
              {store.state === "present"
                ? "No medication has a review date that has passed. A medication with no review interval set is not counted here, and is not the same thing."
                : "Cannot be read."}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {worklist.reviewsOverdue.items.map(r => (
                <li key={r.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                  <Link href={`/practice/medications?medicationId=${r.id}`} className="truncate text-[12px] font-semibold text-gray-800 hover:underline">
                    {r.genericName}
                  </Link>
                  <span className="ml-auto shrink-0 text-[10px] font-bold text-rose-700">
                    {r.daysOverdue} day{r.daysOverdue === 1 ? "" : "s"} over
                  </span>
                  <Link href={`/practice/patients/${r.patientId}`} className="shrink-0 text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                    Patient
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* LCP s9's reconciliation half: rows somebody else supplied, unreviewed. */}
        <section className={CARD}>
          <h2 className="text-[13px] font-bold text-gray-900">
            Awaiting a practitioner&rsquo;s review{worklist.awaitingVerification.unavailable ? "" : ` (${worklist.awaitingVerification.items.length})`}
          </h2>
          {worklist.awaitingVerification.unavailable ? (
            <p className="mt-1 text-[12px] text-[var(--cmp-text-critical)]">{worklist.awaitingVerification.detail}</p>
          ) : worklist.awaitingVerification.items.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-400">
              {store.state === "present"
                ? "Nothing patient-reported or imported is waiting. An empty list here is not a reconciled practice — it is also what a practice that has never asked looks like."
                : "Cannot be read."}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {worklist.awaitingVerification.items.map(r => (
                <li key={r.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                  <Link href={`/practice/medications?medicationId=${r.id}`} className="truncate text-[12px] font-semibold text-gray-800 hover:underline">
                    {r.genericName}
                  </Link>
                  <span className="ml-auto shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                    {MEDICATION_SOURCE_LABEL[r.source] ?? r.source}
                  </span>
                  <Link href={`/practice/patients/${r.patientId}`} className="shrink-0 text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                    Patient
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* MED s9 "Favourite medications" -- DERIVED, never curated. See FAVOURITES_ARE_DERIVED. */}
        <section className={CARD}>
          <h2 className="text-[13px] font-bold text-gray-900">Most recorded here</h2>
          {worklist.favourites.unavailable ? (
            <p className="mt-1 text-[12px] text-[var(--cmp-text-critical)]">{worklist.favourites.detail}</p>
          ) : worklist.favourites.items.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-400">Nothing recorded yet, so there is nothing to count.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-0.5">
              {worklist.favourites.items.map(f => (
                <li key={f.genericName} className="flex items-baseline gap-2 text-[12px]">
                  <span className="truncate text-gray-800">{f.genericName}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-bold text-gray-500">{f.timesRecorded}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-gray-500">
            Counted from what this practice has actually recorded, not from a list somebody curated. A
            curated list is a second thing to maintain and it goes stale in silence.
          </p>
        </section>

        {/* MED s5's "full audit trail", as a register somebody can open. */}
        <section className={CARD}>
          <h2 className="text-[13px] font-bold text-gray-900">
            Safety overrides{worklist.overrides.unavailable ? "" : ` (${worklist.overrides.items.length})`}
          </h2>
          {worklist.overrides.unavailable ? (
            <p className="mt-1 text-[12px] text-[var(--cmp-text-critical)]">{worklist.overrides.detail}</p>
          ) : worklist.overrides.items.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-400">
              Nobody has prescribed on an absent or stale weight. That is the only override this build can
              raise &mdash; the checks that would raise the others are not performed at all.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {worklist.overrides.items.map(o => (
                <li key={o.id} className="border-b border-gray-100 py-1.5 last:border-0">
                  <span className="block text-[11px] text-gray-800">{o.reason}</span>
                  <span className="block text-[10px] text-gray-500">
                    {String(o.recordedAt).slice(0, 16).replace("T", " ")} ·{" "}
                    <Link href={`/practice/medications?medicationId=${o.medicationId}`} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                      the medication
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="mt-3 text-[11px] text-gray-500">{worklist.boundary}</p>

      {/* ⚠ THE NINE DEFERRED CHECKS, ON THE PRACTICE-LEVEL SCREEN TOO. The three surfaces print the same
          list from the same constant so they cannot drift into saying different things about the same
          absence. */}
      <NotCheckedPanel checks={DEFERRED_SAFETY_CHECKS} />

      <section className="mt-4 rounded-xl border border-dashed border-gray-300 p-4">
        <h2 className="text-[13px] font-bold text-gray-900">What this record does not do</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {MEDICATION_REFUSALS.map(r => (
            <li key={r.key}>
              <span className="block text-[12px] font-semibold text-gray-800">{r.label}</span>
              <span className="block text-[11px] text-gray-600">{r.detail}</span>
              <span className="block text-[10px] text-gray-500">Would require: {r.wouldRequire}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * MED s6's timeline, and s3's calculations beside it.
 *
 * ⚠ THE CALCULATION IS RENDERED AS IT WAS STORED AND IS NEVER RECOMPUTED. LCP s9: "A later weight update
 * must not recalculate or rewrite a historical prescription." The working, the weight it used, the state
 * that weight was in and the list of checks nobody ran are all frozen on the row, and this component
 * prints them rather than deriving anything.
 */
function Timeline({ timeline }: { timeline: Awaited<ReturnType<typeof medicationTimeline>> }) {
  const m = timeline.medication;
  return (
    <section className={`mt-4 ${CARD}`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-[13px] font-bold text-gray-900">
          {m ? `${m.genericName}${m.brandName ? ` (${m.brandName})` : ""}` : "Medication"}
        </h2>
        {m && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${MEDICATION_STATUS_CHIP[m.status] ?? "bg-slate-100 text-slate-600"}`}>
            {MEDICATION_STATUS_LABEL[m.status] ?? m.status}
          </span>
        )}
        <Link href="/practice/medications" className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          Clear
        </Link>
      </div>

      {timeline.storeState === "absent" && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">{timeline.storeNotice}</p>
      )}
      {timeline.unavailable && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{timeline.detail}</p>
      )}

      {m && (
        <p className="mt-1 text-[11px] text-gray-600">
          {[m.doseText, m.route, m.frequency, m.durationText].filter(Boolean).join(" · ")}
          {m.indication ? ` · for ${m.indication}` : ""} · {m.current.text} · {m.verification.text} · {m.review.text}
        </p>
      )}

      {timeline.entries.length === 0 ? (
        <p className="mt-2 text-[12px] text-gray-400">
          {timeline.storeState === "present" && !timeline.unavailable
            ? "No entries. Every medication opens its timeline with a `started` entry, so an empty timeline here means the row was written by something that did not."
            : "Cannot be read."}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {timeline.entries.map(e => (
            <li key={e.id} className="border-l-2 border-gray-100 pl-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-semibold text-gray-800">{MEDICATION_EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                <span className="text-[10px] text-gray-400">{e.occurredOn}</span>
                {e.encounterId && (
                  <Link href={`/practice/encounters/${e.encounterId}`} className="text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                    consultation
                  </Link>
                )}
              </div>
              {e.reason && <p className="text-[11px] text-gray-700">{e.reason}</p>}
              {e.narrative && <p className="text-[11px] text-gray-600">{e.narrative}</p>}
              {Object.keys(e.previous).length > 0 && (
                <p className="text-[10px] text-gray-500">
                  was {JSON.stringify(e.previous)} &rarr; now {JSON.stringify(e.next)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-gray-500">{timeline.boundary}</p>

      {timeline.calculations.length > 0 && (
        <div className="mt-4 rounded-lg bg-gray-50 p-3">
          <h3 className="text-[12px] font-bold text-gray-900">Dose calculations</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {timeline.calculations.map(c => (
              <li key={c.id}>
                <span className="block text-[11px] font-semibold text-gray-800">
                  {DOSE_BASIS_LABEL[c.basis] ?? c.basis} ·{" "}
                  {c.perDose !== null ? `${c.perDose} ${c.doseUnit} per dose`
                    : c.dailyTotal !== null ? `${c.dailyTotal} ${c.doseUnit} per day`
                      : c.weightDecision ? "No dose figure — a decision was recorded instead"
                        : "no figure"}
                  <span className="ml-1 font-normal text-gray-500">({String(c.calculatedAt).slice(0, 10)})</span>
                </span>
                {/* ⚠ THE WORKING, EVERY STEP, AS IT WAS SHOWN. MED s3's "transparent calculation display"
                    is a NOT NULL column with a non-empty check behind it, not a rendering preference. */}
                <ol className="mt-1 flex flex-col gap-0.5">
                  {c.working.map((w, i) => (
                    <li key={i} className="font-mono text-[10px] text-gray-700">{w}</li>
                  ))}
                </ol>
                <span className="mt-1 block text-[10px] text-gray-500">
                  Weight at the time: {c.weightState.replace(/_/g, " ")}
                  {c.weightKg !== null ? ` · ${c.weightKg} kg from ${String(c.weightEffectiveAt ?? "").slice(0, 10)}` : ""}
                </span>
                {/* ⚠ PRINTED WHEREVER THE FIGURE IS PRINTED. Migration 259: "a dose printed without the
                    reasoning that produced it is exactly what this column prevents." A reader six months
                    later must see, in the same place, that a judgement was recorded and not that a step
                    was skipped. */}
                {c.weightDecision && (
                  <span className="mt-1 block rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-900">
                    No weight was recorded, and the prescriber recorded this decision:{" "}
                    <span className="font-semibold">&ldquo;{c.weightDecision}&rdquo;</span> No dose was
                    computed by this product.
                  </span>
                )}
                {/* ⚠ FROZEN ON THE ROW, NOT RECONSTRUCTED. A prescription printed from this record can
                    always say what nobody checked at the moment it was decided. */}
                <span className={`mt-1 block text-[10px] font-semibold text-slate-600`}>
                  {c.safetyChecksNotRun.length} safety checks were not performed when this was calculated:{" "}
                  {c.safetyChecksNotRun.join(", ").replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-500">{doseSafetyNotice()}</p>
        </div>
      )}
    </section>
  );
}
