import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { bookingRulesWorkspace, ruleReadingValue, type BookingRuleCard, type RuleConflict } from "@/lib/practice/booking-rules";
import { publishReadiness } from "@/lib/practice/patient-access";
import { bookingLinkSummary } from "@/lib/practice/identity-service";
import { messagingStatus } from "@/lib/practice/messaging";
import { recallQueue } from "@/lib/practice/follow-ups";
import { walkInPolicy } from "@/lib/practice/practice-sessions";
import { onSetupReadinessEvaluated } from "@/lib/practice/activation-hooks";
import RuleWorkspace from "../availability-booking/RuleWorkspace";
import PublishWorkspace from "../availability-booking/PublishWorkspace";
import RecallWorkspace from "../availability-booking/RecallWorkspace";
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
  const [r, readiness, bookingLink, recall, walkIns] = await Promise.all([
    bookingRulesWorkspace(admin, ctx),
    publishReadiness(admin, ctx),
    bookingLinkSummary(admin, ctx.userId),
    recallQueue(admin, ctx.workspaceId),
    walkInPolicy(admin, ctx),
  ]);
  const channels = messagingStatus();

  // CPR-GROWTH-001 s2 "practice configured" -- the milestone rides with the readiness evaluation,
  // which now happens here. Idempotent; `cannot_say` never emits.
  await onSetupReadinessEvaluated(admin, ctx.workspaceId, readiness.verdict, ctx.userId);

  const { tab } = await searchParams;
  const active = TABS.some(t => t.key === tab) ? (tab as string) : "overview";

  const ruleCards = ruleReadingValue(r.rules, [] as BookingRuleCard[]);
  const ruleConflicts = ruleReadingValue(r.conflicts, [] as RuleConflict[]);
  const rulesUnreadable = r.rules.state === "unreadable" ? r.rules.reason : null;
  const activeRules = ruleCards.filter(c => c.status === "active");
  const anySender = channels.email.configured || channels.sms.configured || channels.whatsapp.configured;

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

        {/* ══ OVERVIEW ══════════════════════════════════════════════════════════════════════════ */}
        {active === "overview" && (
          <>
            <BookingLinkCard summary={bookingLink} />
            <div className="grid gap-4 md:grid-cols-2">
              <section className={card}>
                <h2 className="text-[13px] font-bold text-gray-900">Where this stands</h2>
                <ul className="mt-2 space-y-1.5 text-[12px]">
                  <li className="flex items-baseline gap-2">
                    <span className="text-gray-600">Rules in force</span>
                    <span className="ml-auto font-bold text-violet-700">{rulesUnreadable ? "—" : activeRules.length}</span>
                  </li>
                  <li className="flex items-baseline gap-2">
                    <span className="text-gray-600">Conflicts to resolve</span>
                    <span className={`ml-auto font-bold ${ruleConflicts.length > 0 ? "text-rose-700" : "text-gray-800"}`}>
                      {rulesUnreadable ? "—" : ruleConflicts.length}
                    </span>
                  </li>
                  <li className="flex items-baseline gap-2">
                    <span className="text-gray-600">Blocking publish checks</span>
                    <span className={`ml-auto font-bold ${readiness.blockersFailing.length > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                      {readiness.verdict === "cannot_say" ? "—" : readiness.blockersFailing.length}
                    </span>
                  </li>
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
                    ? `Booking codes and confirmations send${channels.email.configured ? " by email" : ""}${channels.sms.configured ? " and by text" : ""}.`
                    : "No sending channel is connected, so patients cannot receive the one-time booking code."}
                </p>
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

        {/* ══ BOOKING PAGE ══════════════════════════════════════════════════════════════════════ */}
        {active === "page" && (
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">Your public booking page</h2>
            <dl className="mt-2 grid gap-x-3 gap-y-1.5 text-[12px] sm:grid-cols-[140px_minmax(0,1fr)]">
              <dt className="font-semibold text-gray-500">Address</dt>
              <dd className="break-all font-mono text-gray-800">
                {bookingLink.state === "live" || bookingLink.state === "claimed_not_open"
                  ? bookingLink.url : "Not claimed yet"}
              </dd>
              <dt className="font-semibold text-gray-500">State</dt>
              <dd className="text-gray-800">{readiness.publishStateLabel}</dd>
            </dl>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-gray-600">
              Who can find the page, what it says, which locations and visit types it shows, and what a
              patient sees when nothing is available are all part of your booking identity — edited in
              one place so the page and its address can never disagree.
            </p>
            <Link href="/practice/setup/identity"
              className="mt-2 inline-block rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90">
              Edit booking page &amp; identity →
            </Link>
          </section>
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
            <RuleWorkspace {...ruleWorkspaceProps} view="clinics" />
            <RecallWorkspace
              recall={JSON.parse(JSON.stringify(recall))}
              walkIns={JSON.parse(JSON.stringify(walkIns))}
              mayManage={hasCapability(ctx, "followup.manage")}
            />
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
