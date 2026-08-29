import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { practiceSetup } from "@/lib/practice/setup";
import { publishReadiness } from "@/lib/practice/patient-access";
import { bookingLinkSummary } from "@/lib/practice/identity-service";
import { messagingStatus, channelSettings } from "@/lib/practice/messaging";
import { MODULE_STATE_CHIP, READINESS_SWATCH, SETUP_HOME_SWATCH, SETUP_READINESS_BADGE } from "@/lib/practice/practice-session-constants";
import type { Metadata } from "next";

/** The tab name, so a practitioner with several open can tell which is which. */
export const metadata: Metadata = { title: "Practice Setup" };

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-SETUP-HFE-001 -- SETUP HOME. The orientation and readiness surface, not another settings form.
//
// The old landing (CPR-V5-008's three engineering domains over seventeen areas) organised settings by
// this product's internal architecture; a practitioner had to know which domain a task lived in before
// finding it. This page asks the practitioner's questions instead -- what is this practice called,
// where do I work, how do patients book me -- and each card answers with LIVE state and the one link
// that manages it.
//
// ---- WHAT THIS PAGE DELIBERATELY DOES NOT DO -------------------------------------------------------
//
//   - It does not restructure practiceSetup(). The service's domains, progress arithmetic and
//     dependency evaluation are harness-pinned and still computed; this page regroups its modules at
//     the presentation layer only.
//   - It does not render a control for anything that does not exist. A capability with no surface is a
//     sentence about what is true, never a dead button.
//   - It does not label the practice "not ready" because an optional capability is missing. Readiness
//     is purpose-specific: day-to-day use, public booking, and communications -- and communications is
//     a warning, never a blocker.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const WARNING_TONE: Record<string, { box: string; text: string; icon: string }> = {
  blocker: { box: "border-rose-300 bg-rose-50", text: "text-rose-900", icon: "!" },
  warning: { box: "border-amber-200 bg-amber-50/70", text: "text-amber-900", icon: "⚑" },
  advisory: { box: "border-sky-200 bg-sky-50/60", text: "text-sky-900", icon: "◔" },
};

function StateMark({ state }: { state: string | null }) {
  if (!state) return null;
  const mc = MODULE_STATE_CHIP[state] ?? MODULE_STATE_CHIP.needs_attention;
  return (
    <span aria-hidden title={mc.label}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${mc.chip}`}>
      {mc.mark}
    </span>
  );
}

/** One destination card: its hue for FINDING it, the question it answers, its live state, its link. */
function Destination({ title, answers, detail, href, hrefLabel, state, hue, children }: {
  title: string; answers: string; detail?: string | null;
  href?: string | null; hrefLabel?: string; state?: string | null;
  hue: string;
  children?: React.ReactNode;
}) {
  const sw = SETUP_HOME_SWATCH[hue] ?? SETUP_HOME_SWATCH.profile;
  return (
    <div className={`rounded-xl border p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col ${sw.box}`}>
      <div className="flex items-start justify-between gap-2">
        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[15px] ${sw.badge}`}>
          {sw.icon}
        </span>
        <StateMark state={state ?? null} />
      </div>
      <p className="mt-2 text-[12.5px] font-bold text-gray-900">{title}</p>
      <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500">{answers}</p>
      {detail && <p className="mt-1.5 text-[11px] font-semibold text-gray-700">{detail}</p>}
      {children}
      {href && (
        <Link href={href}
          className="mt-2 inline-block text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
          {hrefLabel ?? "Manage"} →
        </Link>
      )}
    </div>
  );
}

export default async function PracticeSetupHome() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const admin = createAdminClient();
  const [s, booking, bookingLink, practiceChannels] = await Promise.all([
    practiceSetup(admin, ctx),
    publishReadiness(admin, ctx),
    bookingLinkSummary(admin, ctx.userId),
    channelSettings(admin, ctx.workspaceId),
  ]);
  const channels = messagingStatus();
  // ⚠ USABLE, NOT MERELY CONFIGURED. A provider in the environment with the practice's switch off
  // sends nothing -- reporting "can be sent" on the provider alone was exactly the stale claim the
  // owner's booking page contradicted.
  const emailUsable = practiceChannels.find(c => c.kind === "email")?.usable === true;
  const byKey = new Map(s.modules.map((m: any) => [m.key, m]));
  const m = (k: string) => byKey.get(k) as any | undefined;
  const nextUp = s.checklist.find((i: any) => !i.done && !i.unreadable);

  const availabilityParts = s.availability.parts.filter((p: any) =>
    ["sessions", "appointment_types", "capacity"].includes(p.key));

  // ── Patient booking, in the words the spec asks for: LIVE / READY / NEEDS SETUP / PAUSED. The live
  //    test is the resolver's own (bookingLinkSummary), never a re-derivation of its conditions.
  const bookingState = bookingLink.state === "live"
    ? { chip: "LIVE", cls: "bg-emerald-100 text-emerald-800" }
    : booking.verdict === "cannot_say"
      ? { chip: "COULD NOT BE READ", cls: "bg-slate-100 text-slate-500" }
      : booking.verdict === "not_ready"
        ? { chip: `NEEDS SETUP — ${booking.blockersFailing.length} blocking`, cls: "bg-amber-100 text-amber-800" }
        : { chip: "READY TO PUBLISH", cls: "bg-sky-100 text-sky-800" };

  const anySender = emailUsable;

  // ── §16: purpose-specific readiness. The first two rows come from the pinned service; the booking
  //    row is the publish engine's own verdict; communications never blocks anything.
  const serviceRow = (key: string, label: string) => {
    const r = (s.readiness as any[]).find(x => x.key === key);
    return r ? { ...r, label } : null;
  };
  const readinessRows = [
    serviceRow("foundation_complete", "Practice basics"),
    serviceRow("operations_ready", "Ready for day-to-day use"),
    {
      key: "public_booking", label: "Public booking",
      met: bookingLink.state === "live",
      indeterminate: booking.verdict === "cannot_say" && bookingLink.state !== "live",
      detail: bookingLink.state === "live"
        ? "Your booking page is live — patients can open it."
        : booking.verdict === "not_ready"
          ? `${booking.blockersFailing.length} blocking step${booking.blockersFailing.length === 1 ? "" : "s"} before patients can book online.`
          : booking.verdict === "cannot_say"
            ? "Whether patients can book could not be read just now."
            : "Everything checks out — publishing is the one step left.",
      next: bookingLink.state === "live" ? null
        : { label: booking.verdict === "not_ready" ? "See what is blocking" : "Finish publishing", href: "/practice/setup/identity" },
      blockedReason: null,
    },
    {
      key: "communications", label: "Communications",
      met: anySender, indeterminate: false,
      detail: anySender
        ? "Booking codes and confirmations send by email."
        : channels.email.configured
          ? "Email is not switched on for this practice, so patients cannot receive booking codes."
          : "No email service is connected on this deployment, so nothing can be sent to patients.",
      next: anySender || !channels.email.configured ? null
        : { label: "Set up email verification", href: "/practice/setup/patient-communications" },
      blockedReason: null,
    },
  ].filter(Boolean) as any[];

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">

        {/* ── Header ────────────────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[20px] text-[var(--cp-primary-deep)]">
            ⚙
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900">Practice Setup</h1>
            <p className="text-[13px] leading-relaxed text-gray-500">
              What to finish, whether your practice is ready, and where everything is managed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/practice/documentation"
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Help &amp; guides
            </Link>
            {/* The one booking action that is true right now: view the live page, finish publishing,
                or claim the address. Never a dead preview chip. */}
            {bookingLink.state === "live" ? (
              <a href={bookingLink.url} target="_blank" rel="noopener noreferrer"
                className="rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90">
                View as patient ↗
              </a>
            ) : bookingLink.state === "claimed_not_open" ? (
              <Link href="/practice/setup/identity"
                className="rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90">
                Finish publishing →
              </Link>
            ) : bookingLink.state === "none" ? (
              <Link href="/practice/setup/identity"
                className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                Claim your booking address
              </Link>
            ) : null}
          </div>
        </div>

        {/* ── The one recommended next action (§4) ──────────────────────────────────────────────── */}
        {nextUp && (
          <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--cp-primary)]/20 bg-[var(--cp-primary)]/[0.05] p-3.5">
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[16px] text-[var(--cp-primary-deep)]">→</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-bold text-gray-900">Recommended next: {nextUp.label}</p>
              {nextUp.detail && <p className="text-[11px] leading-relaxed text-gray-600">{nextUp.detail}.</p>}
            </div>
            {nextUp.href && (
              <Link href={nextUp.href}
                className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
                Continue →
              </Link>
            )}
          </section>
        )}

        {/* ── Warnings, each linking to its exact correction (§4) ───────────────────────────────── */}
        {s.warnings.length > 0 && (
          <ul className="grid gap-2 lg:grid-cols-2">
            {s.warnings.map((w: any) => {
              const tone = WARNING_TONE[w.severity] ?? WARNING_TONE.advisory;
              return (
                <li key={w.key} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 ${tone.box}`}>
                  <span aria-hidden className={`mt-px text-[13px] font-bold ${tone.text}`}>{tone.icon}</span>
                  <p className={`min-w-0 flex-1 text-[12px] leading-relaxed ${tone.text}`}>{w.text}</p>
                  {w.href && (
                    <Link href={w.href} className={`shrink-0 text-[11px] font-bold underline ${tone.text}`}>Fix</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* ── §16: purpose-specific readiness. Never one verdict for the whole practice. ─────────── */}
        <section className={card}>
          <h2 className="mb-2.5 text-[13px] font-bold text-gray-900">Is my practice ready?</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {readinessRows.map((r: any) => {
              const sw = r.indeterminate ? READINESS_SWATCH.unreadable
                : r.met ? READINESS_SWATCH.met : READINESS_SWATCH.unmet;
              const badge = SETUP_READINESS_BADGE[r.key] ?? SETUP_READINESS_BADGE.foundation_complete;
              return (
                <li key={r.key} className="flex items-start gap-2.5">
                  <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] ${r.indeterminate ? "bg-slate-100 text-slate-400" : badge.badge}`}>
                    {badge.icon}
                  </span>
                  <span aria-hidden className={`mt-px text-[13px] font-bold ${sw.ring}`}>{sw.mark}</span>
                  <div className="min-w-0">
                    <p className={`text-[12px] font-semibold ${sw.label}`}>{r.label}</p>
                    <p className="text-[10.5px] leading-relaxed text-gray-500">{r.detail}</p>
                    {r.next && (
                      <Link href={r.next.href}
                        className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-semibold text-[var(--cp-primary)] hover:underline">
                        {r.next.label} <span aria-hidden>›</span>
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
          <div className="flex flex-col gap-5">

            {/* ══ PRACTICE ══════════════════════════════════════════════════════════════════════ */}
            <section>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">Practice</h2>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                <Destination hue="profile" title="Practice Profile"
                  answers="What is this practice called and how is it presented?"
                  detail={m("profile")?.detail ?? null} state={m("profile")?.state ?? null}
                  href="/practice/settings?tab=practice#practice-profile">
                  <p className="mt-1 text-[10.5px]">
                    <Link href="/practice/settings?tab=practice#letterhead" className="font-semibold text-[var(--cp-primary)] hover:underline">Letterhead</Link>
                    <span className="text-gray-300"> · </span>
                    <Link href="/practice/settings/document-design" className="font-semibold text-[var(--cp-primary)] hover:underline">Document design</Link>
                  </p>
                </Destination>

                <Destination hue="locations" title="Locations & Clinics"
                  answers="Where do I work, and what clinics make up my regular week?"
                  detail={m("locations")?.detail ?? null} state={m("locations")?.state ?? null}
                  href="/practice/settings?tab=practice#locations">
                  <p className="mt-1 text-[10.5px]">
                    <Link href="/practice/settings?tab=practice#institutions" className="font-semibold text-[var(--cp-primary)] hover:underline">Hospital numbering</Link>
                  </p>
                </Destination>

                <Destination hue="visits" title="Visit Types & Modes"
                  answers="What kinds of visits do I offer and how are they delivered?"
                  detail={m("appointment_types")?.detail ?? null} state={m("appointment_types")?.state ?? null}
                  href={m("appointment_types")?.href ?? "/practice/settings?tab=practice#practice-profile"}>
                  <p className="mt-1 text-[10.5px]">
                    <Link href="/practice/setup/booking-taxonomy" className="font-semibold text-[var(--cp-primary)] hover:underline">Visit taxonomy</Link>
                  </p>
                </Destination>

                <Destination hue="availability" title="Availability & Changes"
                  answers="When am I normally available, and what one-off changes affect that pattern?"
                  state={m("availability")?.state ?? null}
                  href="/practice/setup/availability-changes" hrefLabel="Manage availability">
                  <ul className="mt-1.5 space-y-0.5">
                    {availabilityParts.map((p: any) => (
                      <li key={p.key} className="text-[10px] leading-tight">
                        {p.href ? (
                          <Link href={p.href} className="-mx-1 flex items-start gap-1 rounded px-1 py-0.5 hover:bg-[var(--cp-primary)]/[0.06]">
                            <span aria-hidden className={p.done === null ? "text-slate-400" : p.done ? "text-emerald-600" : "text-amber-500"}>
                              {p.done === null ? "?" : p.done ? "✓" : "○"}
                            </span>
                            <span className="text-gray-600">{p.label}<span className="text-gray-400"> · {p.detail}</span></span>
                          </Link>
                        ) : (
                          <span className="flex items-start gap-1 px-1 py-0.5 text-gray-500">{p.label}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Destination>

                <Destination hue="clinical" title="Clinical catalogues"
                  answers="The clinical vocabulary this practice works with.">
                  <ul className="mt-1 space-y-0.5 text-[10.5px]">
                    {[
                      ["Clinical parameters", "/practice/setup/clinical-parameters"],
                      ["Investigations", "/practice/setup/investigations"],
                      ["Treatments", "/practice/setup/treatments"],
                      ["Procedures", "/practice/setup/procedures"],
                    ].map(([label, href]) => (
                      <li key={href}>
                        <Link href={href} className="font-semibold text-[var(--cp-primary)] hover:underline">{label} →</Link>
                      </li>
                    ))}
                  </ul>
                </Destination>
              </div>
            </section>

            {/* ══ PATIENT ACCESS ════════════════════════════════════════════════════════════════ */}
            <section>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">Patient access</h2>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                <div className={`rounded-xl border p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col ${SETUP_HOME_SWATCH.booking.box}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[15px] ${SETUP_HOME_SWATCH.booking.badge}`}>
                      {SETUP_HOME_SWATCH.booking.icon}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${bookingState.cls}`}>
                      {bookingState.chip}
                    </span>
                  </div>
                  <p className="mt-2 text-[12.5px] font-bold text-gray-900">Patient Booking</p>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500">
                    How can patients book me online?
                  </p>
                  {bookingLink.state === "live" && (
                    <p className="mt-1.5 break-all font-mono text-[10.5px] font-semibold text-gray-800">{bookingLink.url}</p>
                  )}
                  <p className="mt-1 text-[10.5px]">
                    <Link href="/practice/setup/identity" className="font-semibold text-[var(--cp-primary)] hover:underline">Address, QR &amp; share tools</Link>
                    <span className="text-gray-300"> · </span>
                    <Link href="/practice/setup/patient-booking?tab=advanced" className="font-semibold text-[var(--cp-primary)] hover:underline">Rules &amp; publish</Link>
                  </p>
                  <Link href="/practice/setup/patient-booking"
                    className="mt-2 inline-block text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                    Manage booking →
                  </Link>
                </div>

                <Destination hue="registration" title="Registration & Intake"
                  answers="What information and consent do patients provide?"
                  detail={m("registration")?.detail ?? null} state={m("registration")?.state ?? null}
                  href="/practice/settings/registration-form" hrefLabel="Manage intake" />

                <Destination hue="notifications" title="Patient Communications"
                  answers="How do booking codes and confirmations reach patients?"
                  detail={emailUsable ? "Email is on — codes and confirmations send."
                    : channels.email.configured ? "Email is not switched on yet." : "No email service is connected."}
                  href="/practice/setup/patient-communications" hrefLabel="Manage email">
                  {!emailUsable && channels.email.configured && (
                    <p className="mt-1.5 rounded bg-amber-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                      Set up email verification to accept online bookings.
                    </p>
                  )}
                  <p className="mt-1.5 text-[10px] text-gray-400">Text messages &amp; WhatsApp: coming later.</p>
                </Destination>
              </div>
            </section>

            {/* ══ PEOPLE · CONNECTIONS ══════════════════════════════════════════════════════════ */}
            <section>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">People &amp; connections</h2>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                <Destination hue="team" title="Team & Permissions"
                  answers="Who can work in this practice and what may they do?"
                  detail={m("team")?.detail ?? null}
                  href="/practice/people" hrefLabel="Manage team" />
                {/* Nothing to connect exists yet; a concise statement, not a dead card. */}
                <div className={`rounded-xl border p-3.5 ${SETUP_HOME_SWATCH.integrations.box}`}>
                  <span aria-hidden className={`flex h-8 w-8 items-center justify-center rounded-lg text-[15px] ${SETUP_HOME_SWATCH.integrations.badge}`}>
                    {SETUP_HOME_SWATCH.integrations.icon}
                  </span>
                  <p className="mt-2 text-[12.5px] font-bold text-gray-900">Integrations &amp; Synchronisation</p>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500">
                    What external calendars or services are connected?
                  </p>
                  <p className="mt-1.5 text-[11px] text-gray-600">
                    Nothing can be connected yet. When a calendar or messaging connection exists, it
                    will be managed from here.
                  </p>
                </div>
              </div>
            </section>

            {/* ══ PRACTICE CONTROL · PERSONAL ═══════════════════════════════════════════════════ */}
            <section>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">Practice control &amp; personal</h2>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                <Destination hue="security" title="Security"
                  answers="How is this practice protected?"
                  href="/practice/privacy/security" hrefLabel="Review security" />
                <Destination hue="activity" title="Activity Log"
                  answers="What important actions have occurred?"
                  href="/practice/privacy" hrefLabel="Open the log" />
                <Destination hue="data" title="Import, Export & Lifecycle"
                  answers="Your data, in and out — and the practice's own lifecycle."
                  state={m("import_export")?.state ?? null}
                  href="/practice/privacy" hrefLabel="Import & export">
                  <p className="mt-1 text-[10.5px]">
                    <Link href="/practice/setup/lifecycle" className="font-semibold text-[var(--cp-primary)] hover:underline">Practice lifecycle</Link>
                  </p>
                </Destination>
                <Destination hue="personal" title="Personal Settings"
                  answers="How does this product behave for me personally?"
                  href="/practice/settings" hrefLabel="Open personal settings" />
              </div>
            </section>

            {/* ── What depends on what — evaluated, and said only where it bites ────────────────── */}
            <section className={card}>
              <h2 className="mb-2.5 text-[13px] font-bold text-gray-900">What depends on what</h2>
              <ul className="space-y-2">
                {s.dependencies.map((dep: any) => (
                  <li key={dep.key} className="flex items-start gap-2.5 rounded-lg border border-gray-200 px-3 py-2">
                    <span aria-hidden className={`mt-px text-[12px] font-bold ${
                      dep.indeterminate ? "text-slate-400"
                        : dep.unmet.length === 0 ? "text-emerald-600" : "text-amber-600"}`}>
                      {dep.indeterminate ? "?" : dep.unmet.length === 0 ? "✓" : "○"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-gray-800">{dep.statement}</p>
                      <p className="text-[11px] leading-relaxed text-gray-500">
                        {dep.indeterminate
                          ? "Part of this could not be read, so whether it is met is unknown."
                          : dep.unmet.length === 0 ? "Met." : `Still needs ${dep.unmet.join(", ")}.`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* ── Right rail ──────────────────────────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            <section className={card}>
              <h2 className="mb-2 text-[13px] font-bold text-gray-900">Setup progress</h2>
              <p className="text-[13px] font-bold text-gray-900">
                {s.progress.done} of {s.progress.of} areas configured
              </p>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-[var(--cp-success)]"
                  style={{ width: `${s.progress.of === 0 ? 0 : (s.progress.done / s.progress.of) * 100}%` }} />
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                {s.progress.allDone
                  ? "Everything you can configure is configured."
                  : `${s.progress.of - s.progress.done} still to set up. Nothing has to be done in order — the dependencies that matter are named where they bite.`}
                {s.unreadableCount > 0 && ` ${s.unreadableCount} area${s.unreadableCount === 1 ? "" : "s"} could not be read just now and ${s.unreadableCount === 1 ? "is" : "are"} counted as neither done nor undone.`}
              </p>
            </section>

            <section className={card}>
              <h2 className="mb-3 text-[13px] font-bold text-gray-900">Quick actions</h2>
              {s.quickActions.length === 0 ? (
                <p className="text-[12px] text-gray-400">No setup action is available to you.</p>
              ) : (
                <ul className="space-y-1.5">
                  {s.quickActions.map((a: any) => (
                    <li key={a.key}>
                      <Link href={a.href}
                        className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-[12px] font-semibold text-gray-700 hover:border-[var(--cp-primary)]/40 hover:bg-[var(--cp-primary)]/5 hover:text-[var(--cp-primary-deep)]">
                        {a.label}
                        <span aria-hidden className="ml-auto text-gray-300">›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={card}>
              <div className="mb-2.5 flex items-center gap-2">
                <h2 className="text-[13px] font-bold text-gray-900">Recent changes</h2>
                <Link href="/practice/privacy" className="ml-auto text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
                  Activity log →
                </Link>
              </div>
              {s.recentActivity.length === 0 ? (
                <p className="text-[12px] text-gray-400">Nothing has been changed yet.</p>
              ) : (
                <ul className="space-y-2">
                  {s.recentActivity.slice(0, 5).map((a: any, i: number) => (
                    <li key={i} className="border-l-2 border-[var(--cp-primary)]/25 pl-2.5">
                      <p className="text-[12px] font-semibold capitalize text-gray-800">{a.label}</p>
                      <p className="text-[10px] text-gray-500">
                        {new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        <p className="text-[11px] text-gray-500">
          Changes made here affect how your practice works across the whole product, and every one is
          recorded in your activity log.
        </p>
      </div>
    </div>
  );
}
