import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { bookingRulesWorkspace, ruleReadingValue, type BookingRuleCard, type RuleConflict } from "@/lib/practice/booking-rules";
import { publishReadiness } from "@/lib/practice/patient-access";
import { bookingLinkSummary } from "@/lib/practice/identity-service";
import { messagingStatus, channelSettings } from "@/lib/practice/messaging";
import { bookingPreview } from "@/lib/practice/availability-config";
import { isPatientFacingMode } from "@/lib/practice/practice-session-constants";
import { onSetupReadinessEvaluated } from "@/lib/practice/activation-hooks";
import { publicBookingEntry, publicOfferingGate, type PublicBookingEntry } from "@/lib/practice/patient-booking";
import { publicFailureAction } from "@/lib/practice/public-failure-constants";
import RuleWorkspace from "../availability-booking/RuleWorkspace";
import SetupWizard from "./SetupWizard";
import ProfilePreview from "./ProfilePreview";
import FunnelCard from "./FunnelCard";
import { bookingFunnel } from "@/lib/practice/booking-funnel";
import { computeSetupWizard } from "./wizard";
import PublishWorkspace from "../availability-booking/PublishWorkspace";
import BookingLinkCard from "../../home/BookingLinkCard";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Patient Booking" };

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-SETUP-HFE-001 s9 -- PATIENT BOOKING, a dedicated Patient Access destination.
//
// Six tabs, one question: how can patients book me online? Routine clinic booking setup happens on the
// Clinics tab and never requires the Rules Centre; the rules engine remains authoritative underneath,
// reached through Advanced. Every consoles mounted here is the SAME component the product already
// proves elsewhere -- this page owns navigation and orientation, not a second copy of any editor.
//
// The old three-layer console's ?layer=3 redirects here (SET-HFE-10).
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const TABS = [
  { key: "overview", label: "Overview" },
  // CPR-BOOK-PROFILE-001 s13: the public page becomes GOVERNED rather than accidentally assembled.
  // It sits second because it answers the question every other tab is in service of -- what a patient
  // actually finds -- and it renders the public component itself rather than a description of it.
  { key: "profile", label: "Public profile" },
  { key: "page", label: "Booking page" },
  { key: "clinics", label: "Clinics & availability" },
  { key: "information", label: "Patient information" },
  { key: "publish", label: "Review & publish" },
  { key: "advanced", label: "Advanced" },
] as const;

export default async function PatientBookingPage({ searchParams }: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;
  if (!hasCapability(ctx, "appointment.manage") && !hasCapability(ctx, "practice.calendar.view"))
    redirect("/practice/setup");

  const admin = createAdminClient();
  const [r, readiness, bookingLink, practiceChannels, funnel] = await Promise.all([
    bookingRulesWorkspace(admin, ctx),
    publishReadiness(admin, ctx),
    bookingLinkSummary(admin, ctx.userId),
    channelSettings(admin, ctx.workspaceId),
    // s19: the funnel for the Overview tab. Read here with the rest, so the tab does not fan out.
    bookingFunnel(admin, { workspaceId: ctx.workspaceId, days: 30 }),
  ]);
  const channels = messagingStatus();
  const emailUsable = practiceChannels.find(c => c.kind === "email")?.usable === true;

  // CPR-GROWTH-001 s2 "practice configured" -- the milestone rides with the readiness evaluation,
  // which now happens here. Idempotent; `cannot_say` never emits.
  await onSetupReadinessEvaluated(admin, ctx.workspaceId, readiness.verdict, ctx.userId);

  const { tab } = await searchParams;
  const active = TABS.some(t => t.key === tab) ? (tab as string) : "overview";

  // s6: each clinic's next patient-bookable time, from the same preview the diary reads. Computed
  // only for the tab that shows it -- the preview walks a fortnight of slots.
  let nextAvailable: Record<string, string> | null = null;
  let previewTimezone: string | null = null;
  if (active === "clinics") {
    const today = r.today as string;
    const fortnightEnd = new Date(Date.parse(today + "T12:00:00Z") + 13 * 86400000).toISOString().slice(0, 10);
    const preview = await bookingPreview(admin, ctx, { fromDate: today, toDate: fortnightEnd });
    previewTimezone = preview.timezone ?? null;
    const map: Record<string, string> = {};
    for (const day of preview.days as any[]) {
      for (const e of day.entries as any[]) {
        if (!e.offerable || !e.templateId) continue;
        if (!map[e.templateId] || Date.parse(e.from) < Date.parse(map[e.templateId])) map[e.templateId] = e.from;
      }
    }
    nextAvailable = map;
  }

  const ruleCards = ruleReadingValue(r.rules, [] as BookingRuleCard[]);
  const ruleConflicts = ruleReadingValue(r.conflicts, [] as RuleConflict[]);
  const rulesUnreadable = r.rules.state === "unreadable" ? r.rules.reason : null;
  const activeRules = ruleCards.filter(c => c.status === "active");
  const anySender = emailUsable;

  // s4's coverage figure, asked of the OFFERING engine (publicOfferingGate) over what the page shows.
  // The card chain governs booking-time evaluation; what a patient is OFFERED is the per-location
  // window plus the session's own booking mode -- the first version read the card chain and called a
  // bookable practice closed. A clinic is "accepting online bookings" when its mode admits patients
  // AND its location's window is public-ready.
  let onlineSessions: string[] | null = null;
  let readyLocationKeys: string[] | null = null;
  {
    const gate = await publicOfferingGate(admin, ctx.workspaceId, {
      locationIds: ((readiness.profile?.visibleLocationIds ?? []) as string[]),
      appointmentTypes: ((readiness.profile?.visibleAppointmentTypes ?? []) as string[]),
    });
    if (gate.state !== "unknown") {
      readyLocationKeys = gate.readyLocationKeys;
      onlineSessions = (r.sessions as any[])
        .filter((sess: any) => isPatientFacingMode(sess.bookingMode)
          && gate.readyLocationKeys.includes((sess.locationId as string | null) ?? "practice"))
        .map((sess: any) => sess.id as string);
    }
  }
  const onlineClinicCount = onlineSessions === null ? null : onlineSessions.length;

  // s16/s17: what a patient at the public page is being told RIGHT NOW -- resolved by the same entry
  // the page itself renders, so the quote can never drift from the truth. Overview only; the entry
  // walks several stores.
  let patientView: PublicBookingEntry | null = null;
  if (active === "overview" && (bookingLink.state === "live" || bookingLink.state === "claimed_not_open")) {
    patientView = await publicBookingEntry(admin, bookingLink.handle);
  }

  // s14: the first-time wizard, computed from the same checks that refuse a real publish. It
  // disappears forever at first publication.
  const wizard = computeSetupWizard({
    publishState: readiness.profile?.publishState ?? null,
    verdict: readiness.verdict,
    checks: (readiness.checks as any[]).map((c: any) => ({ code: c.code, state: c.state })),
    onlineClinicCount,
  });

  const ruleWorkspaceProps = {
    rules: JSON.parse(JSON.stringify(ruleCards)),
    conflicts: JSON.parse(JSON.stringify(ruleConflicts)),
    locations: JSON.parse(JSON.stringify(r.locations)),
    sessions: JSON.parse(JSON.stringify(r.sessions)),
    mayAuthor: r.mayAuthor, mayBook: r.mayBook,
    rulesUnreadable, today: r.today,
  };

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">

        {/* ── Identity + breadcrumb (s19) ───────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <nav className="flex items-baseline gap-1.5 text-[12px]">
              <Link href="/practice/setup" className="font-semibold text-[var(--cp-primary)] hover:underline">
                Practice Setup
              </Link>
              <span className="text-gray-300">›</span>
              <span className="text-gray-500">Patient Booking</span>
            </nav>
            <h1 className="text-2xl font-bold text-gray-900">Patient Booking</h1>
            <p className="text-[13px] text-gray-500">How patients book you online.</p>
          </div>
          {bookingLink.state === "live" && (
            <a href={bookingLink.url} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              View as patient ↗
            </a>
          )}
        </div>

        {/* ── The tabs ──────────────────────────────────────────────────────────────────────────── */}
        <nav className="flex flex-wrap gap-1" aria-label="Patient booking areas">
          {TABS.map(t => (
            <Link key={t.key} href={`/practice/setup/patient-booking?tab=${t.key}`}
              aria-current={active === t.key ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                active === t.key
                  ? "bg-violet-600 text-white"
                  : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>
              {t.label}
            </Link>
          ))}
        </nav>

        <SetupWizard view={wizard} />

        {/* ══ OVERVIEW ══════════════════════════════════════════════════════════════════════════ */}
        {active === "overview" && (
          <>
            <BookingLinkCard summary={bookingLink} />
            <FunnelCard funnel={funnel} />
            <div className="grid gap-4 md:grid-cols-2">
              <section className={card}>
                <h2 className="text-[13px] font-bold text-gray-900">Where this stands</h2>
                <ul className="mt-2 space-y-1.5 text-[12px]">
                  <li className="flex items-start gap-2">
                    <span aria-hidden className={bookingLink.state === "live" ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>
                      {bookingLink.state === "live" ? "✓" : "○"}
                    </span>
                    <span className="text-gray-700">
                      {bookingLink.state === "live" ? "Booking page is live." : "Booking page is not open to patients yet."}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span aria-hidden className={(onlineClinicCount ?? 0) > 0 ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>
                      {(onlineClinicCount ?? 0) > 0 ? "✓" : "○"}
                    </span>
                    <span className="text-gray-700">
                      {onlineClinicCount === null ? "Clinics could not be read."
                        : onlineClinicCount > 0
                          ? `${onlineClinicCount} clinic${onlineClinicCount === 1 ? "" : "s"} accepting online bookings.`
                          : "No clinic accepts online bookings yet."}
                    </span>
                  </li>
                  {ruleConflicts.length > 0 && (
                    <li className="flex items-start gap-2">
                      <span aria-hidden className="font-bold text-rose-700">!</span>
                      <span className="text-gray-700">
                        {ruleConflicts.length} booking-setting conflict{ruleConflicts.length === 1 ? "" : "s"} to resolve.
                      </span>
                    </li>
                  )}
                  {readiness.verdict !== "cannot_say" && readiness.blockersFailing.length > 0 && (
                    <li className="flex items-start gap-2">
                      <span aria-hidden className="font-bold text-amber-700">○</span>
                      <span className="text-gray-700">
                        {readiness.blockersFailing.length} step{readiness.blockersFailing.length === 1 ? "" : "s"} before publishing.
                      </span>
                    </li>
                  )}
                  {!anySender && (
                    <li className="flex items-start gap-2">
                      <span aria-hidden className="font-bold text-amber-700">⚠</span>
                      <span className="text-gray-700">
                        Email is not switched on — patients cannot receive booking codes.
                      </span>
                    </li>
                  )}
                </ul>
                <p className="mt-2 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-600">
                  {bookingLink.state === "live"
                    ? "Your page is live. Set up each clinic's booking behaviour on the Clinics tab."
                    : readiness.verdict === "not_ready"
                      ? "Something still blocks publishing — Review & publish names each item with its fix."
                      : "Publishing is the step that opens your page to patients — Review & publish walks it."}
                </p>
                <Link
                  href={bookingLink.state === "live"
                    ? "/practice/setup/patient-booking?tab=clinics"
                    : "/practice/setup/patient-booking?tab=publish"}
                  className="mt-2 inline-block rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90">
                  {bookingLink.state === "live" ? "Set up clinic booking →" : "Review & publish →"}
                </Link>
              </section>
              <section className={card}>
                <h2 className="text-[13px] font-bold text-gray-900">How patients are reached</h2>
                <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
                  {anySender
                    ? "Booking codes and confirmations send by email."
                    : channels.email.configured
                      ? "Email is not switched on for this practice, so patients cannot receive the one-time booking code."
                      : "No email service is connected on this deployment, so patients cannot receive the one-time booking code."}
                </p>
                {!anySender && channels.email.configured && (
                  <Link href="/practice/setup/patient-communications"
                    className="mt-2 inline-block rounded-lg bg-[var(--cp-primary)] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90">
                    Set up email verification →
                  </Link>
                )}
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                  Your address, QR code and share buttons live with your booking identity.
                </p>
                <Link href="/practice/setup/identity"
                  className="mt-2 inline-block text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                  Address, QR &amp; share tools →
                </Link>
              </section>
            </div>
          </>
        )}

        {/* ── s16/s17: THE PATIENT'S VIEW, MIRRORED. The sentence is the entry's own, verbatim. ── */}
        {active === "overview" && patientView && (() => {
          const soft = patientView.canBook && patientView.availability.state === "no_public_clinic";
          const failing = patientView.state === "closed" || (!patientView.canBook && patientView.state === "open") || soft;
          const code = patientView.state === "unreadable" ? "COULD_NOT_CHECK"
            : soft ? "NO_PUBLIC_CLINIC" : patientView.blockers[0] ?? null;
          const action = code ? publicFailureAction(code) : null;
          const quoted = soft ? patientView.availability.patientNote : patientView.whyNot;
          return (
            <section className={`rounded-xl border p-4 ${
              patientView.state === "unreadable" ? "border-slate-300 bg-slate-50"
                : failing ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/50"}`}>
              <h2 className="text-[13px] font-bold text-gray-900">What a patient sees right now</h2>
              {patientView.state === "unreadable" ? (
                <p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">
                  Whether patients can book could not be checked just now — the page tells them exactly
                  that, and assumes nothing.
                </p>
              ) : !failing ? (
                <p className="mt-1.5 text-[12px] leading-relaxed text-emerald-900">
                  Your page is open and patients can complete a booking.
                  {patientView.canRequestWithoutCode ? " Requests without a code are also on." : ""}
                </p>
              ) : (
                <>
                  {quoted && (
                    <blockquote className="mt-1.5 border-l-2 border-amber-300 pl-2.5 text-[12px] italic leading-relaxed text-gray-700">
                      &ldquo;{quoted}&rdquo;
                    </blockquote>
                  )}
                  {action?.href ? (
                    <Link href={action.href}
                      className="mt-2 inline-block rounded-lg bg-[var(--cp-primary)] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90">
                      {action.label} →
                    </Link>
                  ) : action?.why ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-gray-600">{action.why}</p>
                  ) : null}
                </>
              )}
            </section>
          );
        })()}

        {/* ══ PUBLIC PROFILE — CPR-BOOK-PROFILE-001 s13. ═══════════════════════════════════════
            The readiness list and the page itself, both from the public projection. Suspended because
            it runs a diary scan: the tabs and the wizard above must not wait for it. */}
        {active === "profile" && (
          <Suspense fallback={
            <div aria-hidden className="h-64 animate-pulse rounded-xl border border-dashed border-gray-200 bg-white/60" />
          }>
            <ProfilePreview handle={
              bookingLink.state === "live" || bookingLink.state === "claimed_not_open"
                ? bookingLink.handle : null
            } />
          </Suspense>
        )}

        {/* ══ BOOKING PAGE — the page's own settings, open (s5). ════════════════════════════════ */}
        {active === "page" && (
          <>
            <section className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Address</p>
                <p className="break-all font-mono text-[12px] font-semibold text-gray-800">
                  {bookingLink.state === "live" || bookingLink.state === "claimed_not_open"
                    ? bookingLink.url : "Not claimed yet"}
                </p>
              </div>
              <span className="rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-600">
                {readiness.publishStateLabel}
              </span>
              <Link href="/practice/setup/identity"
                className="text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                Handle, discovery, QR &amp; share tools →
              </Link>
            </section>
            <PublishWorkspace
              view="page"
              readiness={JSON.parse(JSON.stringify(readiness))}
              locations={JSON.parse(JSON.stringify(
                (r.locations as any[]).map((l: any) => ({ id: l.id, name: l.name, active: l.active }))))}
              mayPublish={hasCapability(ctx, "practice.settings.manage")}
            />
          </>
        )}

        {/* ══ CLINICS & AVAILABILITY — routine setup, no Rules Centre required (s9) ═════════════ */}
        {active === "clinics" && (
          <>
            <p className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[11.5px] leading-relaxed text-gray-600">
              Each clinic below shows how it behaves for patients and where that behaviour comes from.
              Changing a clinic&apos;s day, time or place is structural —{" "}
              <Link href="/practice/setup/availability-changes" className="font-semibold text-[var(--cp-primary)] hover:underline">
                edit the clinic schedule
              </Link>{" "}
              for that.
            </p>
            <RuleWorkspace {...ruleWorkspaceProps} view="clinics"
              nextAvailable={nextAvailable} timezone={previewTimezone}
              onlineSessions={onlineSessions} readyLocationKeys={readyLocationKeys} />
            <p className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[11px] leading-relaxed text-gray-500">
              Looking for today&apos;s operations? Waiting walk-ins live in{" "}
              <Link href="/practice/today" className="font-semibold text-[var(--cp-primary)] hover:underline">Current Session</Link>,
              and follow-ups that still need booking live in{" "}
              <Link href="/practice/follow-ups" className="font-semibold text-[var(--cp-primary)] hover:underline">Follow-ups</Link>.
              This tab is how clinics BEHAVE, not who is in the waiting room.
            </p>
          </>
        )}

        {/* ══ PATIENT INFORMATION ═══════════════════════════════════════════════════════════════ */}
        {active === "information" && (
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">What patients provide when booking</h2>
            {rulesUnreadable ? (
              <p className="mt-2 text-[12px] text-slate-600">Could not be read just now.</p>
            ) : activeRules.length === 0 ? (
              <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
                No rule is in force yet, so a booking asks the standard questions and insists only on a
                name.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {activeRules.map(rule => (
                  <li key={rule.id} className="rounded-lg border border-gray-200 px-3 py-2">
                    <p className="text-[12px] font-bold text-gray-900">{rule.name ?? "Unnamed rule"}</p>
                    <p className="text-[11px] leading-relaxed text-gray-600">{rule.requiredInformationLine}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2.5 text-[11px] leading-relaxed text-gray-500">
              Change what a booking asks on the rule that governs it (Advanced → edit the rule →
              Booking information). Your fuller REGISTRATION form — what you record once somebody is
              your patient — is separate, and configured in Registration &amp; Intake.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href="/practice/setup/patient-booking?tab=advanced"
                className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                Change booking questions →
              </Link>
              <Link href="/practice/settings/registration-form"
                className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                Registration &amp; intake →
              </Link>
            </div>
          </section>
        )}

        {/* ══ REVIEW & PUBLISH ══════════════════════════════════════════════════════════════════ */}
        {active === "publish" && (
          <PublishWorkspace
            view="publish"
            readiness={JSON.parse(JSON.stringify(readiness))}
            locations={JSON.parse(JSON.stringify(
              (r.locations as any[]).map((l: any) => ({ id: l.id, name: l.name, active: l.active }))))}
            mayPublish={hasCapability(ctx, "practice.settings.manage")}
          />
        )}

        {/* ══ ADVANCED — the Rules Centre and explainability ════════════════════════════════════ */}
        {active === "advanced" && (
          <>
            <RuleWorkspace {...ruleWorkspaceProps} view="advanced" />
            <div className={card}>
              <p className="text-[12.5px] font-bold text-gray-900">
                Where these rules bite, and where they do not
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                A rule written here decides bookings made through the rules engine, and every such
                booking records which rule and which version decided it. The calendar&apos;s own
                quick-book still applies the simpler per-location settings it has always read, from the
                editor below. The two are kept apart deliberately rather than one silently overriding
                the other.
              </p>
              <Link href="/practice/setup/availability?step=4"
                className="mt-2 inline-block text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                Open the single-row editor the calendar reads →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
