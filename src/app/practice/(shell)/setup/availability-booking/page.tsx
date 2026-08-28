import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { practiceSessions, readingValue, type SessionView, type LocationView } from "@/lib/practice/practice-sessions";
import { bookingPreview } from "@/lib/practice/availability-config";
import { scheduleChanges, impactReadingValue, type ScheduleChangeView, type QueuedAction } from "@/lib/practice/schedule-exceptions";
import { formatDayTime } from "@/lib/datetime";
import { LAYER_SWATCH, LAYER1_STAT_SWATCH } from "@/lib/practice/practice-session-constants";
import { LAYER2_STAT_SWATCH } from "@/lib/practice/schedule-exception-constants";
import { LAYER3_STAT_SWATCH } from "@/lib/practice/booking-rule-constants";
import { bookingRulesWorkspace, ruleReadingValue, type BookingRuleCard, type RuleConflict } from "@/lib/practice/booking-rules";
import { walkInPolicy } from "@/lib/practice/practice-sessions";
import { recallQueue } from "@/lib/practice/follow-ups";
import { publishReadiness } from "@/lib/practice/patient-access";
import LayerNav, { type Layer } from "./LayerNav";
import SessionWorkspace from "./SessionWorkspace";
import ExceptionWorkspace from "./ExceptionWorkspace";
import RuleWorkspace from "./RuleWorkspace";
import RecallWorkspace from "./RecallWorkspace";
import PublishWorkspace from "./PublishWorkspace";
import { onSetupReadinessEvaluated } from "@/lib/practice/activation-hooks";
import { REFUSAL_STATE_COPY } from "@/lib/practice/refusal-presentation";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 -- PRACTICE AVAILABILITY & PATIENT BOOKING. PHASE 1 ONLY, AND THE PAGE SAYS SO.
//
// s3.1's page identity, s3.2's three-layer navigator, s4's Layer 1 in full.
//
// ---- WHAT IS BUILT HERE, AND WHAT IS NOT -----------------------------------------------------------
//
// s19 divides this specification into six phases and its own release note says the first release should
// prioritise a complete, reliable INTERNAL and LINK-ONLY booking workflow. This build is PHASE 1 --
// "three-layer shell, session entity, locations integration, appointment type links" -- and nothing
// further has been started.
//
//   Phase 1  BUILT     the shell, the navigator, Layer 1 in full (s4), migration 240's session entity.
//   Phase 2  BUILT     s5.3's affected-booking workflow -- who is booked into the time being changed,
//                      and what happens to them, required before the change is written (migration 242).
//   Phase 3  BUILT     s7's booking-rule CARD model and its builder, s11's specificity ladder and
//                      conflict validation, rule versioning, and server-side evaluation for INTERNAL
//                      booking (migration 244). Every booking made through it records the rule id AND
//                      VERSION that decided it (AC-13). s7.2's twelve builder sections: eight are real
//                      and enforced, four are drawn as what they are with the phase that owns them.
//   Phase 4  PART      migrations 253-255 landed the three stores, and the handle is claimed in Practice
//                      Setup. The INTAKE and the CONFIRMATION are still absent, so no patient can
//                      complete anything -- and the publish checklist below carries that as a blocker
//                      rather than leaving it to be discovered.
//   Phase 5  BUILT     s7.5's recall queue (derived, never stored -- see follow-ups.ts), the stranded
//                      follow-ups whose booking died and the one action that returns them, and s7.7's
//                      walk-in limits resolved per session with the stricter of the two winning. The
//                      cutoff, the queue ordering and the emergency override have no column and say so.
//   Phase 6  BUILT     s10.2's publish validation as a CHECKLIST WITH THREE STATES -- and the two rows
//                      nothing in this schema can answer are permanently "not checked", never a tick.
//                      Three of the blockers are enforced by the database (migration 254's
//                      practice_booking_access_publishable) and reported here rather than re-implemented.
//                      s10.1's scenario preview is still absent, because there is no patient path to
//                      simulate.
//
// EVERY LATER-PHASE SURFACE THE COMP DRAWS IS RENDERED AS NOT BUILT, WITH THE PHASE NAMED. Not greyed
// out, not disabled, not a button that shrugs -- a sentence saying what is missing and which phase owns
// it. A control that does nothing is the failure this codebase refuses hardest.
//
// ---- ONE LAYER OPEN AT A TIME (s3.2's interaction rule) --------------------------------------------
//
// The open layer is the `layer` query parameter, so the browser's back button steps between layers and
// the centre workspace renders on the server with only that layer's material. The right panel changes
// with it, as s3.2 requires.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

/** A later phase's surface, drawn as what it is. */
/**
 * ⚠ CPR-HFE-REF-001. `phase` USED TO RENDER AS "Phase 6 -- not built" AND A PRACTITIONER HAS NO
 * IDEA WHAT PHASE 6 IS. It is a build-plan artefact: real to whoever sequenced the work, meaningless
 * to the person reading it, and it dated the product in the worst way -- a doctor cannot tell whether
 * Phase 6 is next month or next year, so it reads as an excuse rather than a fact.
 *
 * The state is what a practitioner needs, and "Not available yet" is the canonical way to say it.
 * reasonCode/specReference/technicalDetail are accepted and NOT rendered: they exist so Product
 * Director and Engineering keep the provenance, per s11.
 */
function NotBuilt({ title, what, nextAction }: {
  title: string; phase?: string | null; what: string; alreadyBuilt?: string | null;
  reasonCode?: string; specReference?: string; technicalDetail?: string;
  nextAction?: { label: string; href: string } | null;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-200 text-[12px] text-slate-500">◌</span>
        <p className="text-[12.5px] font-bold text-slate-600">{title}</p>
        <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
          {REFUSAL_STATE_COPY.NOT_AVAILABLE_YET.title}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{what}</p>
    </div>
  );
}

function Unreadable({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-slate-600">
      <span className="font-bold">Could not be read.</span> {what} This is not a count of nothing — it is
      no count at all, so nothing on this panel should be acted on until it loads.
    </p>
  );
}

export default async function AvailabilityBookingPage({ searchParams }: {
  searchParams: Promise<{ layer?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;
  if (!hasCapability(ctx, "appointment.manage") && !hasCapability(ctx, "practice.calendar.view"))
    redirect("/practice/setup");

  const admin = createAdminClient();
  // Layer 2's read runs whether or not Layer 2 is the open layer, because s3.2's navigator card carries
  // its completion summary -- "3 upcoming changes · 1 patient action required" -- and a card that said
  // nothing until you clicked it would be a card you had to click to find out you needed to.
  // ── PHASES 5 AND 6 ARE READ HERE, WITH LAYERS 1-3, AND NOT BEHIND THE OPEN LAYER. s3.2's navigator
  //    card carries a completion summary for every layer, and Layer 3's now includes the publish
  //    verdict -- a card you had to click to discover you needed to click it is not a summary.
  const [s, x, r, recall, walkIns, readiness] = await Promise.all([
    practiceSessions(admin, ctx), scheduleChanges(admin, ctx), bookingRulesWorkspace(admin, ctx),
    recallQueue(admin, ctx.workspaceId), walkInPolicy(admin, ctx), publishReadiness(admin, ctx),
  ]);

  // CPR-GROWTH-001 s2 "practice configured". ⚠ EMITTED FROM THE READINESS EVALUATION, NOT FROM A BUTTON.
  // There is no single moment a practice becomes configured -- it becomes true when the last blocker
  // clears, which may be a location saved on a different screen. This is where the product finds out, so
  // this is where the milestone is recorded. Idempotent, so evaluating it on every visit costs one
  // refused insert, and `cannot_say` never emits.
  await onSetupReadinessEvaluated(admin, ctx.workspaceId, readiness.verdict, ctx.userId);

  const { layer } = await searchParams;
  const active = Number(layer) >= 1 && Number(layer) <= 3 ? Number(layer) : 1;

  const sessions = readingValue(s.sessions, [] as SessionView[]);
  const locations = readingValue(s.locations, [] as LocationView[]);
  const clinics = readingValue(s.clinics, [] as any[]);

  // ── LAYER 2 (CPR-V5-007 Phase 2). Every figure here comes from the one read above, and each carries
  //    whether it could be read at all -- a nought and an outage are drawn differently on this layer,
  //    because on this layer a wrong nought is a patient nobody rings.
  const changes = impactReadingValue(x.changes, [] as ScheduleChangeView[]);
  const queue = impactReadingValue(x.queue, [] as QueuedAction[]);
  const changesUnreadable = x.changes.state === "unreadable" ? x.changes.reason : null;
  const queueUnreadable = x.queue.state === "unreadable" ? x.queue.reason : null;
  /** ⚠ UNREVIEWED IS NOT NOUGHT-AFFECTED. Its own figure, in slate, and it says so in words. */
  const unreviewed = x.unreviewed;

  const liveSessions = sessions.filter(x => x.status === "active" && x.effectiveState === "current");
  const activeLocations = locations.filter(l => l.active);

  // ── s6.2's layer dashboard. EVERY FIGURE NOW COMES FROM THE RULES ENGINE (Phase 3) rather than
  //    from a count of rows beside a promise.
  //
  // "Uncovered sessions" is a session anybody may book into that no rule in force covers -- a session
  // with no notice period, no horizon and no capacity limit. "Conflicts" used to be uncomputable
  // because practice_booking_rule had no priority column; migration 244 added one, so s11's test is a
  // real number and the pairs behind it are named on the layer.
  const bookableSessions = liveSessions.filter(x => x.bookingMode !== "none");
  const ruleCards = ruleReadingValue(r.rules, [] as BookingRuleCard[]);
  const ruleConflicts = ruleReadingValue(r.conflicts, [] as RuleConflict[]);
  const uncoveredSessions = ruleReadingValue(r.uncovered, [] as { id: string; name: string }[]);
  const rulesUnreadable = r.rules.state === "unreadable" ? r.rules.reason : null;
  const activeRules = ruleCards.filter(c => c.status === "active");

  const fortnightEnd = new Date(Date.parse(`${s.today}T12:00:00Z`) + 13 * 86400000).toISOString().slice(0, 10);
  const preview = await bookingPreview(admin, ctx, { fromDate: s.today, toDate: fortnightEnd });
  const nextEntry = preview.days
    .flatMap((d: any) => d.entries).filter((e: any) => e.offerable)
    .sort((a: any, b: any) => Date.parse(a.from) - Date.parse(b.from))[0] ?? null;

  const plannedSlots = liveSessions.reduce((n, x) => n + (x.capacity.effective ?? 0), 0);
  const sessionsWithoutCapacity = liveSessions.filter(x => x.capacity.effective === null).length;

  // ── s3.2's navigator, with real completion summaries ────────────────────────────────────────────
  const layers: Layer[] = [
    {
      n: 1, key: "regular_practice", title: "My Regular Practice",
      blurb: "Set the locations, sessions and activities that usually make up your working week.",
      summary: s.sessions.state !== "ok" ? "could not be read"
        : `${activeLocations.length} location${activeLocations.length === 1 ? "" : "s"} · ${liveSessions.length} session${liveSessions.length === 1 ? "" : "s"}`,
      children: [
        {
          key: "locations", label: "Locations",
          state: s.locations.state !== "ok" ? "unreadable" : activeLocations.length > 0,
          detail: s.locations.state !== "ok" ? null : `${activeLocations.length} open`,
        },
        {
          key: "sessions", label: "Recurring sessions",
          state: s.sessions.state !== "ok" ? "unreadable" : liveSessions.length > 0,
          detail: s.sessions.state !== "ok" ? null : `${liveSessions.length}`,
        },
        {
          key: "types", label: "Appointment types",
          state: s.sessions.state !== "ok" ? "unreadable" : s.typesOffered.length > 0,
          detail: s.sessions.state !== "ok" ? null : `${s.typesOffered.length} of 7 offered`,
        },
        {
          key: "capacity", label: "Session capacity",
          state: s.sessions.state !== "ok" ? "unreadable"
            : liveSessions.length > 0 && sessionsWithoutCapacity === 0,
          detail: s.sessions.state !== "ok" ? null
            : sessionsWithoutCapacity > 0 ? `${sessionsWithoutCapacity} unknown` : `${plannedSlots} places`,
        },
      ],
    },
    {
      n: 2, key: "changes", title: "Changes & Exceptions",
      blurb: "Adjust specific dates without changing your regular practice pattern.",
      // s3.2's own example summary is "3 upcoming changes · 1 patient action required", and both halves
      // are now real figures rather than a count of rows beside a promise.
      summary: changesUnreadable ? "could not be read"
        : `${changes.length} upcoming change${changes.length === 1 ? "" : "s"}`
          + (queueUnreadable ? " · queue unreadable"
            : queue.length > 0 ? ` · ${queue.length} patient action${queue.length === 1 ? "" : "s"} required` : ""),
      children: [
        {
          key: "upcoming", label: "Upcoming changes",
          state: changesUnreadable ? "unreadable" : null,
          detail: changesUnreadable ? null : `${changes.length}`,
        },
        {
          key: "leave", label: "Leave and closures", state: changesUnreadable ? "unreadable" : null,
          detail: changesUnreadable ? null
            : `${changes.filter(c => ["leave", "closure", "emergency_interruption"].includes(c.kind)).length}`,
        },
        {
          key: "extra", label: "Extra sessions", state: changesUnreadable ? "unreadable" : null,
          detail: changesUnreadable ? null
            : `${changes.filter(c => ["extra_session", "extended_hours"].includes(c.kind)).length}`,
        },
        {
          // ⚠ `false` WHEN SOMEBODY IS WAITING, not `true` when nobody is. A green tick beside "affected
          // appointments" would be the navigator answering a question nobody asked.
          key: "affected", label: "Affected appointments",
          state: queueUnreadable ? "unreadable" : queue.length === 0,
          detail: queueUnreadable ? null : `${queue.length} to decide`,
        },
      ],
    },
    {
      n: 3, key: "patient_booking", title: "Patient Booking",
      blurb: "Decide what patients can book, who may book and how your capacity is protected.",
      summary: rulesUnreadable ? "could not be read"
        : `${activeRules.length} rule${activeRules.length === 1 ? "" : "s"} in force`
          + (ruleConflicts.length > 0 ? ` · ${ruleConflicts.length} conflict${ruleConflicts.length === 1 ? "" : "s"} to resolve` : "")
          + ` · ${readiness.publishStateLabel.toLowerCase()}`,
      children: [
        {
          key: "rules", label: "Booking rules",
          state: rulesUnreadable ? "unreadable" : activeRules.length > 0,
          detail: rulesUnreadable ? null : `${activeRules.length} of ${ruleCards.length}`,
        },
        {
          // ⚠ `false` WHEN SOMETHING IS DEADLOCKED, not `true` when nothing is. s11 blocks activation
          // until a conflict is resolved, so this is a question somebody has to answer.
          key: "conflicts", label: "Rule conflicts",
          state: rulesUnreadable ? "unreadable" : ruleConflicts.length === 0,
          detail: rulesUnreadable ? null : `${ruleConflicts.length}`,
        },
        {
          // s3.2's "Follow-ups and walk-ins". ⚠ `false` WHEN SOMEBODY IS OWED A REVIEW NOBODY BOOKED --
          // a green tick against a recall queue would be the navigator answering a question nobody asked.
          key: "recall", label: "Follow-ups and walk-ins",
          state: recall.unavailable ? "unreadable" : recall.overdue.length + recall.stranded.length === 0,
          detail: recall.unavailable ? null
            : `${recall.overdue.length} overdue · ${recall.strandedUnavailable ? "?" : recall.stranded.length} stranded`,
        },
        {
          // ⚠ THREE STATES, AND `cannot_say` IS NOT A PASS. The navigator draws it as unreadable rather
          // than as a tick, because that is what it is: a question this build could not answer.
          key: "publish", label: "Preview & publish",
          state: readiness.verdict === "cannot_say" ? "unreadable" : readiness.verdict !== "not_ready",
          detail: readiness.verdict === "cannot_say" ? null
            : `${readiness.blockersFailing.length} blocking · ${readiness.notChecked.length} not checked`,
        },
      ],
    },
  ];

  const sw = LAYER_SWATCH[layers[active - 1].key];

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4">

        {/* ── s3.1's page identity ──────────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <nav className="flex items-baseline gap-1.5 text-[12px]">
              <Link href="/practice/setup" className="font-semibold text-[var(--cp-primary)] hover:underline">
                Practice Setup
              </Link>
              <span className="text-gray-300">›</span>
              <span className="text-gray-500">Availability &amp; Patient Booking</span>
            </nav>
            <h1 className="text-2xl font-bold text-gray-900">Practice Availability &amp; Patient Booking</h1>
            <p className="text-[13px] text-gray-500">
              Build your regular practice, manage changes and control how patients book with you.
              All times are in {s.timezone}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/practice/calendar"
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Open the planner
            </Link>
            {/* s3.1's primary action. ⚠ IT IS A LINK TO THE CHECKLIST, NOT A PUBLISH BUTTON: the
                verdict is the server's, and a header button that published without anybody having read
                the checks would be the one control on this page that skipped its own guard. */}
            <Link href="/practice/setup/availability-booking?layer=3"
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              {readiness.verdict === "not_ready"
                ? `Publish readiness — ${readiness.blockersFailing.length} blocking`
                : readiness.verdict === "cannot_say"
                  ? "Publish readiness — cannot say"
                  : `Publish readiness — ${readiness.publishStateLabel.toLowerCase()}`}
            </Link>
          </div>
        </div>

        {/* ── THE PHASE BANNER. Stated once, at the top, in the practitioner's words. ─────────────
            ⚠ REWRITTEN 2026-08-28, found by the owner mid-pilot-acceptance: the old closing sentence
            said the patient-facing intake "does not [exist], so nobody outside this practice can
            complete a booking" — true when written, false since the intake screens shipped (proven
            68/68 and 44/44 in the acceptance pass). A stale refusal that UNDERSTATES the product is
            the CPR-HFE-REF-001 class, and this one told every practice their publish button led
            nowhere. The missing step now named is the one that is actually theirs: publishing. */}
        <section className="flex flex-wrap items-start gap-3 rounded-xl border border-[var(--cp-primary)]/20 bg-[var(--cp-primary)]/[0.05] p-3.5">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[15px] text-[var(--cp-primary-deep)]">③</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold text-gray-900">
              Everything here is set up and working. Patients can book online once you publish your
              booking page.
            </p>
            <p className="text-[11px] leading-relaxed text-gray-600">
              Layer 1 is complete — locations, named recurring sessions, activity types, appointment
              types, capacity and walk-ins. Layer 2 is complete for the thing that matters most about a
              schedule change: before one is made, this screen works out who is booked into the time you
              are changing and will not write the change until you have said what happens to them. Layer
              3 is real for booking you and your staff do: rules are cards with a name, a scope, a
              priority and a version, the most specific one decides, two rules nothing can choose between
              block each other rather than being guessed at, and every booking made through the engine
              records which rule and which version allowed it. Follow-ups nobody booked, and the ones
              whose booking has died, are worked out here rather than stored. The publish checklist runs
              for real — and where it cannot answer a question it says &ldquo;not checked&rdquo; rather
              than showing you a tick. The patient-facing screens exist end to end — the handle, the
              one-time code and the intake a patient fills in — and stay private until you choose to
              publish, which is the &ldquo;Publish readiness&rdquo; button above. Nothing below is a
              control that does nothing.
            </p>
          </div>
        </section>

        {s.readFailures.length > 0 && (
          <Unreadable what={s.readFailures.join(" ")} />
        )}

        {/* ── s15.1: navigator · workspace · intelligence panel ─────────────────────────────────── */}
        <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)_310px]">
          <div className="xl:sticky xl:top-4">
            <LayerNav layers={layers} active={active} />
            <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3.5">
              <p className="text-[12px] font-bold text-gray-900">Need help?</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                A session is a pattern, not fifty-two copies. Changing Tuesday changes every Tuesday.
              </p>
              <Link href="/practice/documentation"
                className="mt-2 inline-block text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                View setup guide →
              </Link>
            </div>
          </div>

          {/* ── THE CENTRE WORKSPACE: ONE LAYER AT A TIME ──────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className={`flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold ${sw.badge}`}>
                {active}
              </span>
              <h2 className="text-[16px] font-bold text-gray-900">{layers[active - 1].title}</h2>
            </div>

            {/* ══ LAYER 1 ═══════════════════════════════════════════════════════════════════════ */}
            {active === 1 && (
              s.sessions.state !== "ok" ? (
                <Unreadable what="Your regular week could not be read, so this layer is showing nothing rather than showing an empty week." />
              ) : (
                <>
                  {/* The comp's four figures. Tinted badge, AND THE FIGURE IN THE TILE'S HUE. */}
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      { key: "locations", n: activeLocations.length, label: "Locations active" },
                      { key: "sessions", n: liveSessions.length, label: "Weekly sessions running" },
                      { key: "appointment_types", n: s.typesOffered.length, label: "Appointment types offered" },
                      {
                        key: "capacity",
                        n: sessionsWithoutCapacity > 0 ? null : plannedSlots,
                        label: sessionsWithoutCapacity > 0
                          ? `${sessionsWithoutCapacity} session${sessionsWithoutCapacity === 1 ? "" : "s"} hold an unknown number`
                          : "Places in a typical week",
                      },
                    ].map(t => {
                      const st = LAYER1_STAT_SWATCH[t.key];
                      return (
                        <div key={t.key} className={card}>
                          <span aria-hidden className={`flex h-8 w-8 items-center justify-center rounded-lg text-[15px] ${st.badge}`}>
                            {st.icon}
                          </span>
                          <p className={`mt-2 text-[24px] font-bold leading-none ${t.n === null ? "text-slate-300" : st.figure}`}>
                            {t.n === null ? "—" : t.n}
                          </p>
                          <p className="mt-1 text-[11px] leading-snug text-gray-500">{t.label}</p>
                        </div>
                      );
                    })}
                  </div>

                  <SessionWorkspace
                    sessions={JSON.parse(JSON.stringify(sessions))}
                    locations={JSON.parse(JSON.stringify(locations))}
                    clinics={JSON.parse(JSON.stringify(clinics))}
                    today={s.today}
                    defaultMinutes={s.practiceDefaultMinutes}
                    mayEdit={s.mayEdit}
                    // CPR-RECUR-001. Migration 274 is applied by hand, so the editor is told whether
                    // this database can hold an alternate-week pattern rather than offering one it
                    // cannot store.
                    recurrenceAvailable={s.recurrenceAvailable}
                  />

                  {/* ── s4.2 LOCATIONS, REUSED not duplicated ─────────────────────────────────── */}
                  <section className={card}>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[14px] text-[var(--cp-primary-deep)]">◎</span>
                      <div className="min-w-0">
                        <h3 className="text-[14px] font-bold text-gray-900">Where you work</h3>
                        <p className="text-[11px] text-gray-500">
                          These are your records from Locations &amp; Clinics. Nothing here creates a
                          second copy of them.
                        </p>
                      </div>
                      <Link href="/practice/settings?tab=practice#locations"
                        className="ml-auto text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                        Add or close a location →
                      </Link>
                    </div>
                    {s.locations.state !== "ok" ? (
                      <Unreadable what="Your locations could not be read." />
                    ) : locations.length === 0 ? (
                      <p className="text-[12px] text-amber-700">
                        No location yet. Add one first — a working day needs somewhere to be, and
                        availability depends on it.
                      </p>
                    ) : (
                      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {locations.map(l => (
                          <li key={l.id} className={`rounded-lg border px-3 py-2.5 ${
                            l.active ? "border-gray-200" : "border-dashed border-slate-300 bg-slate-50"}`}>
                            <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-gray-900">
                              {l.name}
                              {!l.active && <span className="rounded bg-slate-200 px-1 py-px text-[9px] font-bold uppercase text-slate-600">Closed</span>}
                            </p>
                            <p className="text-[10px] capitalize text-gray-500">
                              {l.type.replace(/_/g, " ")}
                              {l.travelBufferMinutes != null ? ` · ${l.travelBufferMinutes} min to reach` : ""}
                              {` · ${l.sessionCount} session${l.sessionCount === 1 ? "" : "s"}`}
                            </p>
                            {/* s4.2's four indicators, each from the sessions actually here. */}
                            <ul className="mt-1.5 flex flex-wrap gap-1">
                              {[
                                ["Patient booking", l.supportsPatientBooking],
                                ["Internal booking", l.supportsInternalBooking],
                                ["Walk-ins", l.supportsWalkIns],
                                ["Virtual care", l.supportsVirtualCare],
                              ].map(([label, on]) => (
                                <li key={label as string}
                                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                                    on ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                                  {on ? "✓ " : "○ "}{label}
                                </li>
                              ))}
                            </ul>
                            <p className="mt-1.5 text-[10px] text-gray-500">
                              {l.facilityName
                                ? `Hospital numbering: ${l.facilityName}`
                                : "No institution linked, so no hospital number format applies here."}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              )
            )}

            {/* ══ LAYER 2 ═══════════════════════════════════════════════════════════════════════ */}
            {active === 2 && (
              <>
                {/* The four figures. Tinted badge, AND THE FIGURE IN THE TILE'S HUE.
                    ⚠ THE LAST ONE IS NOT A GOOD-NEWS TILE. "Impact not reviewed" counts changes where
                    nobody has been asked who was booked in, and it is slate rather than green because it
                    is an open question rather than an answer. */}
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    {
                      key: "changes", n: changesUnreadable ? null : changes.length,
                      label: "Changes in the next 6 months",
                    },
                    {
                      key: "affected", n: queueUnreadable ? null : queue.length,
                      label: "Patients waiting on a decision",
                    },
                    {
                      key: "pending",
                      n: changesUnreadable ? null : changes.filter(c => c.impactState === "pending").length,
                      label: "Changes with somebody still unresolved",
                    },
                    {
                      key: "unreviewed", n: unreviewed,
                      label: unreviewed === null ? "Impact review — could not be read"
                        : "Changes whose impact was never checked",
                    },
                  ].map(t => {
                    const st = LAYER2_STAT_SWATCH[t.key];
                    return (
                      <div key={t.key} className={card}>
                        <span aria-hidden className={`flex h-8 w-8 items-center justify-center rounded-lg text-[15px] ${st.badge}`}>
                          {st.icon}
                        </span>
                        <p className={`mt-2 text-[24px] font-bold leading-none ${t.n === null ? "text-slate-300" : st.figure}`}>
                          {t.n === null ? "—" : t.n}
                        </p>
                        <p className="mt-1 text-[11px] leading-snug text-gray-500">{t.label}</p>
                      </div>
                    );
                  })}
                </div>

                <ExceptionWorkspace
                  changes={JSON.parse(JSON.stringify(changes))}
                  queue={JSON.parse(JSON.stringify(queue))}
                  locations={JSON.parse(JSON.stringify(locations))}
                  today={x.today}
                  timezone={x.timezone}
                  mayEdit={x.mayEdit}
                  namesVisible={x.namesVisible}
                  changesUnreadable={changesUnreadable}
                  queueUnreadable={queueUnreadable}
                />

                <NotBuilt
                  title="Offering the next available appointment, and a waiting list"
                  phase={null}
                  what={"Competen Practice cannot offer a patient the next available appointment, or hold them on a waiting list. There is nowhere to keep an offer and nothing that would send it, so when you change a time the choices are to keep the booking, cancel it, or record that the patient moved to another one."}
                  // ⚠ CPR-HFE-REF-001: the practitioner reads `what`; this provenance is not rendered.
                  reasonCode="NO_OFFER_STORE_NO_WAITLIST"
                  specReference="CPR-AVB-001 s5.3"
                  technicalDetail={"s5.3 lists six resolutions and three of them are real here — keep pending, cancel the appointment, and record that the patient was moved to another one. s7's rule engine now exists (Phase 3), so an alternative could be evaluated; what is still missing is somewhere to HOLD an offer and anything that would send it, which is why “offer next available” remains refused rather than stored. “Move to waiting list” needs a waiting list: practice_appointment has six statuses and none of them is wait-listed, and there is no priority to preserve. Both are refused by the engine with the reason rather than stored as a word that would make a patient look handled."} />
              </>
            )}

            {/* ══ LAYER 3 ═══════════════════════════════════════════════════════════════════════ */}
            {active === 3 && (
              <>
                {/* s6.2's layer dashboard. Tinted badge, AND THE FIGURE IN THE TILE'S OWN HUE.
                    ⚠ THE CONFLICT TILE IS NOT A GOOD-NEWS TILE. s11 blocks activation until a conflict
                    is resolved, so a figure above nought is work, not a note. */}
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    {
                      key: "rules", n: rulesUnreadable ? null : activeRules.length,
                      label: rulesUnreadable ? "Rules in force — could not be read"
                        : `Rules in force, of ${ruleCards.length} written`,
                    },
                    {
                      key: "covered",
                      n: rulesUnreadable || r.uncovered.state !== "ok" ? null
                        : bookableSessions.length - uncoveredSessions.length,
                      label: r.uncovered.state !== "ok" ? "Sessions covered — could not be read"
                        : `Bookable sessions a rule covers, of ${bookableSessions.length}`,
                    },
                    {
                      key: "conflicts", n: rulesUnreadable ? null : ruleConflicts.length,
                      label: "Pairs of rules nothing can choose between",
                    },
                    {
                      key: "decided",
                      n: r.decided.state === "ok" ? r.decided.value.withRule : null,
                      label: r.decided.state !== "ok" ? "Bookings carrying a rule — could not be read"
                        : `Bookings carrying the rule that decided them · ${r.decided.value.withoutRule} predate the engine`,
                    },
                  ].map(t => {
                    const st = LAYER3_STAT_SWATCH[t.key];
                    return (
                      <div key={t.key} className={card}>
                        <span aria-hidden className={`flex h-8 w-8 items-center justify-center rounded-lg text-[15px] ${st.badge}`}>
                          {st.icon}
                        </span>
                        <p className={`mt-2 text-[24px] font-bold leading-none ${t.n === null ? "text-slate-300" : st.figure}`}>
                          {t.n === null ? "—" : t.n}
                        </p>
                        <p className="mt-1 text-[11px] leading-snug text-gray-500">{t.label}</p>
                      </div>
                    );
                  })}
                </div>

                {/* ⚠ AC-13, SAID IN WORDS AS WELL AS COUNTED. A null applied rule is TRUE of every
                    appointment made before this engine existed, and the screen says so rather than
                    leaving a gap somebody would read as a fault. */}
                {r.decided.state === "ok" && r.decided.value.withoutRule > 0 && (
                  <p className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[11.5px] leading-relaxed text-gray-600">
                    <span className="font-bold">{r.decided.value.withoutRule}</span> booking
                    {r.decided.value.withoutRule === 1 ? " was" : "s were"} not decided by a rule. That is
                    true rather than missing: they were made before the rules engine, or through a door
                    that does not consult one. Nothing here will attribute them to a rule after the fact.
                  </p>
                )}

                {uncoveredSessions.length > 0 && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-amber-900">
                    <span className="font-bold">{uncoveredSessions.length}</span> session
                    {uncoveredSessions.length === 1 ? "" : "s"} anybody may book
                    ({uncoveredSessions.map(u => u.name).join(", ")}) {uncoveredSessions.length === 1 ? "is" : "are"}{" "}
                    covered by no rule in force, so nothing limits how far ahead or how full they get.
                  </p>
                )}

                <RuleWorkspace
                  rules={JSON.parse(JSON.stringify(ruleCards))}
                  conflicts={JSON.parse(JSON.stringify(ruleConflicts))}
                  locations={JSON.parse(JSON.stringify(r.locations))}
                  sessions={JSON.parse(JSON.stringify(r.sessions))}
                  mayAuthor={r.mayAuthor}
                  mayBook={r.mayBook}
                  rulesUnreadable={rulesUnreadable}
                  today={r.today}
                />

                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-[12.5px] font-bold text-gray-900">
                    Where these rules bite, and where they do not
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                    A rule written here decides bookings made through the rules engine, and every such
                    booking records which rule and which version decided it. The calendar&apos;s own
                    quick-book still applies the simpler per-location settings it has always read, from
                    the editor below. The two are kept apart deliberately rather than one silently
                    overriding the other, so a booking is never governed by a rule the person making it
                    could not see.
                  </p>
                  <Link href="/practice/setup/availability?step=4"
                    className="mt-2 inline-block text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                    Open the single-row editor the calendar reads →
                  </Link>
                </div>

                {/* ══ PHASE 5 -- s7.5's recall queue and s7.7's walk-in rules ════════════════════ */}
                <RecallWorkspace
                  recall={JSON.parse(JSON.stringify(recall))}
                  walkIns={JSON.parse(JSON.stringify(walkIns))}
                  mayManage={hasCapability(ctx, "followup.manage")}
                />

                {/* ══ PHASE 6 -- s10.2's publish readiness ══════════════════════════════════════ */}
                <PublishWorkspace
                  readiness={JSON.parse(JSON.stringify(readiness))}
                  locations={JSON.parse(JSON.stringify(
                    locations.map(l => ({ id: l.id, name: l.name, active: l.active }))))}
                  mayPublish={hasCapability(ctx, "practice.settings.manage")}
                />

                <NotBuilt
                  title="Scenario preview"
                  phase={null}
                  what={"You can see what the booking engine would offer from your real sessions and rules over the next fortnight. A guided walkthrough of the booking page as a patient would experience it is not available yet — your booking page itself, once published, is the real thing."}
                  // ⚠ CPR-HFE-REF-001: the practitioner reads `what`; this provenance is not rendered.
                  // ⚠ REWRITTEN 2026-08-28 (CPR-RULES-HFE-001 s10 pass): the old sentence said the
                  // patient-facing intake "is not built yet", which stopped being true when the intake
                  // screens shipped -- the stale-refusal class, understating the product. What is
                  // genuinely absent is only the guided SIMULATOR of that page.
                  reasonCode="NO_SCENARIO_WALKTHROUGH"
                  specReference="CPR-AVB-001 s10.1"
                  technicalDetail={"s10.1's eight testable scenarios. The panel beside this shows what the booking engine would offer from real slots and real rules over the next fortnight, which is the honest half of a preview. The other half — a guided walkthrough as a new patient, a follow-up, a staff booking and a walk-in would experience it — has no simulator surface. The intake itself shipped; a preview that drew its own copy of that page could drift from the real one, which would be worse than no preview, so the refusal stands until a walkthrough renders the real page."} />
              </>
            )}
          </div>

          {/* ── s3.2: THE RIGHT PANEL CHANGES WITH THE SELECTED LAYER ──────────────────────────── */}
          <div className="flex flex-col gap-4 xl:sticky xl:top-4">
            {active === 1 && (
              <>
                <section className={card}>
                  <h3 className="mb-2 text-[13px] font-bold text-gray-900">What your week adds up to</h3>
                  {s.sessions.state !== "ok" ? (
                    <p className="text-[11px] text-slate-500">Could not be read.</p>
                  ) : liveSessions.length === 0 ? (
                    <p className="text-[11.5px] leading-relaxed text-gray-500">
                      Nothing repeats yet. Add a session on any day above.
                    </p>
                  ) : (
                    <ul className="space-y-1.5 text-[11.5px]">
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Working days</span>
                        <span className="ml-auto font-bold text-emerald-700">{new Set(liveSessions.map(x => x.weekday)).size}</span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Hours a week</span>
                        <span className="ml-auto font-bold text-cyan-700">
                          {Number((liveSessions.reduce((n, x) => n + (x.endsMinute - x.startsMinute), 0) / 60).toFixed(1))}
                        </span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Sessions anybody may book</span>
                        <span className="ml-auto font-bold text-violet-700">{bookableSessions.length}</span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Sessions allowing walk-ins</span>
                        <span className="ml-auto font-bold text-amber-700">{liveSessions.filter(x => x.walkInsAllowed).length}</span>
                      </li>
                    </ul>
                  )}
                  <p className="mt-2.5 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
                    Capacity is derived from each session&apos;s length and its appointment length. Where
                    you have also set a manual limit, the stricter of the two applies.
                  </p>
                </section>

                {/* Sessions with something worth saying about them. */}
                {sessions.some(x => x.warnings.length > 0) && (
                  <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                    <h3 className="text-[13px] font-bold text-amber-900">Worth a look</h3>
                    <ul className="mt-1.5 space-y-2">
                      {sessions.filter(x => x.warnings.length > 0).slice(0, 6).map(x => (
                        <li key={x.id}>
                          <p className="text-[11.5px] font-semibold text-amber-900">
                            {x.sessionName ?? x.suggestedName}
                          </p>
                          <ul className="text-[10.5px] leading-relaxed text-amber-800/90">
                            {x.warnings.map((w, i) => <li key={i}>· {w}</li>)}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className={card}>
                  <h3 className="mb-2 text-[13px] font-bold text-gray-900">Next available appointment</h3>
                  {nextEntry ? (
                    <>
                      <p className="text-[13px] font-bold text-[var(--cp-primary-deep)]">
                        {formatDayTime(nextEntry.from, preview.timezone)}
                      </p>
                      <p className="text-[11px] text-gray-600">{nextEntry.locationName ?? "No location recorded"}</p>
                      <Link href="/practice/calendar" className="mt-2 inline-block text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                        View calendar →
                      </Link>
                    </>
                  ) : (
                    <p className="text-[11.5px] leading-relaxed text-gray-500">
                      Nothing is offerable in the next fortnight. That is computed from real slots and
                      the booking rules, not from the pattern.
                    </p>
                  )}
                  <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
                    {preview.note}
                  </p>
                </section>
              </>
            )}

            {active === 2 && (
              <>
                <section className={card}>
                  <h3 className="mb-2 text-[13px] font-bold text-gray-900">Changes ahead</h3>
                  {changesUnreadable ? (
                    <p className="text-[11px] text-slate-500">Could not be read.</p>
                  ) : (
                    <ul className="space-y-1.5 text-[11.5px]">
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Time taken away</span>
                        <span className="ml-auto font-bold text-amber-700">
                          {changes.filter(c => c.effect === "removes").length}
                        </span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Time added</span>
                        <span className="ml-auto font-bold text-emerald-700">
                          {changes.filter(c => c.effect === "adds").length}
                        </span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Moved or substituted</span>
                        <span className="ml-auto font-bold text-cyan-700">
                          {changes.filter(c => c.effect === "reshapes").length}
                        </span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Days affected</span>
                        <span className="ml-auto font-bold text-violet-700">
                          {changes.reduce((n, c) => n + c.days, 0)}
                        </span>
                      </li>
                    </ul>
                  )}
                </section>

                {/* ⚠ THE PANEL THAT USED TO SAY "not computed". It is computed now, and the three
                    answers it can give are kept apart: a number, an outage, and a question nobody has
                    asked yet. A nought under "patients affected" is only ever printed when somebody
                    has actually looked. */}
                <section className={queueUnreadable
                  ? "rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4"
                  : queue.length > 0
                    ? "rounded-xl border border-rose-200 bg-rose-50/60 p-4"
                    : card}>
                  <h3 className="text-[13px] font-bold text-gray-900">Patients affected</h3>
                  {queueUnreadable ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      Could not be read. {queueUnreadable} That is not a nought.
                    </p>
                  ) : (
                    <>
                      <p className={`mt-1 text-[24px] font-bold leading-none ${queue.length > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                        {queue.length}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                        {queue.length > 0
                          ? "waiting on a decision. Each one is a named booking a schedule change got in the way of, and none of them leaves this list on its own."
                          : "nobody is waiting on a decision right now."}
                      </p>
                    </>
                  )}
                  {unreviewed !== null && unreviewed > 0 && (
                    <p className="mt-2.5 border-t border-black/5 pt-2 text-[10.5px] leading-relaxed text-slate-600">
                      <span className="font-bold">{unreviewed}</span> change
                      {unreviewed === 1 ? " was" : "s were"} recorded without anybody checking who was
                      booked into {unreviewed === 1 ? "it" : "them"}. That is not the same as nobody being
                      booked in, and this screen will not draw it as though it were.
                    </p>
                  )}
                </section>
              </>
            )}

            {active === 3 && (
              <>
                <section className={card}>
                  <h3 className="mb-2 text-[13px] font-bold text-gray-900">Booking page status</h3>
                  <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-slate-600">
                    <span aria-hidden className={`h-2 w-2 rounded-full ${
                      readiness.profileUnreadable ? "bg-slate-300"
                        : readiness.verdict === "not_ready" ? "bg-rose-400"
                          : readiness.verdict === "cannot_say" ? "bg-slate-400" : "bg-emerald-400"}`} />
                    {readiness.publishStateLabel}
                  </p>
                  {readiness.profileUnreadable ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                      Your booking page could not be read, so this panel is not saying you have none.
                    </p>
                  ) : (
                    <ul className="mt-1.5 space-y-1 text-[11px]">
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Blocking checks failing</span>
                        <span className="ml-auto font-bold text-rose-700">{readiness.blockersFailing.length}</span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        {/* ⚠ ITS OWN LINE, IN SLATE. Not folded into "passing", and not hidden. */}
                        <span className="text-gray-600">Could not be checked</span>
                        <span className="ml-auto font-bold text-slate-600">{readiness.notChecked.length}</span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Warnings</span>
                        <span className="ml-auto font-bold text-amber-700">{readiness.warningsFailing.length}</span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Handle</span>
                        <span className="ml-auto font-bold text-gray-800">
                          {readiness.profile?.handle ?? "not claimed"}
                        </span>
                      </li>
                    </ul>
                  )}
                  <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
                    A published page needs a claimed handle, the one-time code switched on and a mode
                    that admits patients. Those three are refused by the database, not by this screen —
                    so nothing here can talk it into publishing without them.
                  </p>
                </section>
                {/* s11's ladder, stated once, so the cards in the centre can be read against it. */}
                <section className={card}>
                  <h3 className="mb-2 text-[13px] font-bold text-gray-900">Which rule wins</h3>
                  <p className="text-[11px] leading-relaxed text-gray-600">
                    The most specific rule that covers a booking decides it. Most specific first:
                  </p>
                  <ol className="mt-1.5 space-y-0.5 text-[11px] text-gray-700">
                    <li>1. A rule fixed to a set of dates</li>
                    <li>2. A rule naming one session and one appointment type</li>
                    <li>3. A rule naming one location and one appointment type</li>
                    <li>4. A rule for a whole location</li>
                    <li>5. A rule for your whole practice</li>
                    <li className="text-gray-500">6. No rule at all — nothing constrains the booking</li>
                  </ol>
                  <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
                    Two rules on the same rung are settled by priority. Two on the same rung at the same
                    priority settle nothing, and any booking they both cover is refused until you change
                    one of them.
                  </p>
                </section>

                <section className={card}>
                  <h3 className="mb-2 text-[13px] font-bold text-gray-900">What the diary would offer</h3>
                  <p className="text-[11.5px] leading-relaxed text-gray-600">
                    Over the next fortnight,{" "}
                    <span className="font-bold text-emerald-700">
                      {preview.days.reduce((n: number, d: any) => n + d.offerable, 0)}
                    </span>{" "}
                    of{" "}
                    <span className="font-bold text-gray-800">
                      {preview.days.reduce((n: number, d: any) => n + d.total, 0)}
                    </span>{" "}
                    slots are offerable.
                  </p>
                  <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                    ⚠ This figure comes from the single-row rules the slot generator reads, not from the
                    cards above. See the note under the rules for why the two are kept apart. {preview.note}
                  </p>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
