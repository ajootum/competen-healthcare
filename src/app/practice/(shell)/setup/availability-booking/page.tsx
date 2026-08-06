import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { practiceSessions, readingValue, type SessionView, type LocationView } from "@/lib/practice/practice-sessions";
import { bookingPreview } from "@/lib/practice/availability-config";
import { formatDayTime, formatMinuteOfDay } from "@/lib/datetime";
import {
  LAYER_SWATCH, LAYER1_STAT_SWATCH, appointmentTypeLabel,
} from "@/lib/practice/practice-session-constants";
import LayerNav, { type Layer } from "./LayerNav";
import SessionWorkspace from "./SessionWorkspace";

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
//   Phase 2  NOT BUILT s5.3's affected-booking workflow. Exceptions themselves already exist from
//                      migration 230 and Layer 2 shows the real ones, and the workflow that resolves
//                      the bookings a change strands does not exist.
//   Phase 3  NOT BUILT s7's booking-rule CARD model and its builder. The single-row rule editor that
//                      already works is linked from Layer 3 rather than replaced by a card that cannot
//                      be edited -- retiring a working editor to show a mock-up of a better one is a
//                      regression wearing a redesign.
//   Phase 4  NOT BUILT s8's patient booking access -- handle, OTP, publish state.
//   Phase 5  NOT BUILT s7.5's follow-up windows and s7.7's walk-in queue rules.
//   Phase 6  NOT BUILT s10's scenario preview and publish validation.
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
function NotBuilt({ title, phase, what }: { title: string; phase: string; what: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-200 text-[12px] text-slate-500">◌</span>
        <p className="text-[12.5px] font-bold text-slate-600">{title}</p>
        <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
          {phase} — not built
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
  const s = await practiceSessions(admin, ctx);

  const { layer } = await searchParams;
  const active = Number(layer) >= 1 && Number(layer) <= 3 ? Number(layer) : 1;

  const sessions = readingValue(s.sessions, [] as SessionView[]);
  const locations = readingValue(s.locations, [] as LocationView[]);
  const clinics = readingValue(s.clinics, [] as any[]);
  const exceptions = readingValue(s.upcomingExceptions, [] as any[]);
  const rules = readingValue(s.bookingRules, [] as any[]);

  const liveSessions = sessions.filter(x => x.status === "active" && x.effectiveState === "current");
  const activeLocations = locations.filter(l => l.active);

  // ── s6.2's layer dashboard, computed where it can be and refused where it cannot ────────────────
  //
  // "Uncovered sessions" is real: a session anybody may book into that no active rule matches is a
  // session with no notice period, no horizon and no walk-in limit. "Conflicts" is NOT computable --
  // s11's rule is about equal specificity AND EXPLICIT PRIORITY, and practice_booking_rule has no
  // priority column, so any number here would be invented.
  const ruleCovers = (sess: SessionView) => rules.some(r =>
    (r.location_id ?? null) === (sess.locationId ?? null) || r.location_id === null);
  const bookableSessions = liveSessions.filter(x => x.bookingMode !== "none");
  const uncovered = bookableSessions.filter(x => !ruleCovers(x)).length;

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
      summary: s.upcomingExceptions.state !== "ok" ? "could not be read"
        : `${exceptions.length} upcoming change${exceptions.length === 1 ? "" : "s"}`,
      children: [
        {
          key: "upcoming", label: "Upcoming changes",
          state: s.upcomingExceptions.state !== "ok" ? "unreadable" : null,
          detail: s.upcomingExceptions.state !== "ok" ? null : `${exceptions.length}`,
        },
        { key: "leave", label: "Leave and closures", state: null, detail: `${exceptions.filter(e => ["leave", "closure"].includes(e.kind)).length}` },
        { key: "extra", label: "Extra sessions", state: null, detail: `${exceptions.filter(e => ["extra_session", "extended_hours"].includes(e.kind)).length}` },
        { key: "affected", label: "Affected appointments", state: "unreadable", detail: "Phase 2" },
      ],
    },
    {
      n: 3, key: "patient_booking", title: "Patient Booking",
      blurb: "Decide what patients can book, who may book and how your capacity is protected.",
      summary: s.bookingRules.state !== "ok" ? "could not be read"
        : `${rules.length} active rule${rules.length === 1 ? "" : "s"} · not published`,
      children: [
        {
          key: "rules", label: "Booking rules",
          state: s.bookingRules.state !== "ok" ? "unreadable" : rules.length > 0,
          detail: s.bookingRules.state !== "ok" ? null : `${rules.length}`,
        },
        { key: "access", label: "Booking access", state: "unreadable", detail: "Phase 4" },
        { key: "form", label: "Registration form", state: null, detail: "in Setup" },
        { key: "publish", label: "Preview & publish", state: "unreadable", detail: "Phase 6" },
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
            {/* THE COMP'S "Preview booking page" AND "Publish changes". Neither exists. */}
            <span className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2 text-[12px] font-semibold text-slate-500"
              title="CPR-V5-007 Phase 4 and Phase 6. Not started.">
              Nothing to publish yet — Phase 4
            </span>
          </div>
        </div>

        {/* ── THE PHASE BANNER. Stated once, at the top, in the practitioner's words. ───────────── */}
        <section className="flex flex-wrap items-start gap-3 rounded-xl border border-[var(--cp-primary)]/20 bg-[var(--cp-primary)]/[0.05] p-3.5">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[15px] text-[var(--cp-primary-deep)]">①</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold text-gray-900">
              This workspace is at Phase 1 of six: your regular practice.
            </p>
            <p className="text-[11px] leading-relaxed text-gray-600">
              Layer 1 is complete — locations, named recurring sessions, activity types, appointment
              types, capacity and walk-ins. Layer 2 shows the schedule changes you already have; the
              workflow that resolves the bookings a change strands is Phase 2. Layer 3 shows the booking
              rules you already have; the rule card builder is Phase 3, and the patient-facing booking
              page — handle, link, OTP, publish — is Phase 4. Nothing below is a control that does nothing.
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
                <section className={card}>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-[14px] text-amber-700">⚑</span>
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-bold text-gray-900">Upcoming changes</h3>
                      <p className="text-[11px] text-gray-500">
                        Dates that are not like your regular week. These are real and already work.
                      </p>
                    </div>
                    <Link href="/practice/setup/availability?step=3"
                      className="ml-auto rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
                      Add a change
                    </Link>
                  </div>
                  {s.upcomingExceptions.state !== "ok" ? (
                    <Unreadable what="Your schedule changes could not be read." />
                  ) : exceptions.length === 0 ? (
                    <p className="text-[12px] text-gray-400">
                      Nothing upcoming. Leave, closures and one-off clinics all go here, and none of them
                      is required.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {exceptions.map(e => (
                        <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
                          <div className="w-[52px] shrink-0 text-center">
                            <p className="text-[15px] font-bold leading-none text-amber-700">{e.from_date.slice(8, 10)}</p>
                            <p className="text-[9px] font-bold uppercase tracking-wide text-gray-500">
                              {new Date(`${e.from_date}T12:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}
                            </p>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-bold capitalize text-gray-900">
                              {String(e.kind).replace(/_/g, " ")}
                              {e.reason ? ` — ${e.reason}` : ""}
                            </p>
                            <p className="text-[11px] text-gray-600">
                              {e.from_date === e.to_date ? e.from_date : `${e.from_date} → ${e.to_date}`}
                              {e.starts_minute != null
                                ? ` · ${formatMinuteOfDay(e.starts_minute)}–${formatMinuteOfDay(e.ends_minute)}`
                                : " · the whole day"}
                              {" · "}
                              {e.location_id ? locations.find(l => l.id === e.location_id)?.name ?? "a location" : "everywhere"}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* s5.3. The comp shows "3 affected appointments" against each change. */}
                <NotBuilt
                  title="Affected appointments"
                  phase="Phase 2"
                  what={"s5.3 asks for the confirmed, requested, wait-listed and follow-up-linked bookings a change would strand to be counted BEFORE the change is committed, and for a resolution strategy — keep pending, offer next available, bulk reschedule, move to waiting list, cancel and notify — to be chosen for them. None of that exists. Adding a change today applies it and does not tell you who it moved, which is why the count is absent rather than shown as nought."} />

                <NotBuilt
                  title="The six exception types"
                  phase="Phase 2"
                  what={"s5.2 names six kinds: unavailable, time change, location change, extra session, activity substitution and emergency interruption. Four exist today — leave, closure, one-off session and extended hours — and the Add a change form above offers those four. Location change, activity substitution and emergency interruption have no representation in the schema."} />
              </>
            )}

            {/* ══ LAYER 3 ═══════════════════════════════════════════════════════════════════════ */}
            {active === 3 && (
              <>
                {/* s6.2's layer dashboard. Every figure computed or honestly absent. */}
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    {
                      key: "bookable_locations",
                      value: `${activeLocations.filter(l => l.supportsInternalBooking || l.supportsPatientBooking).length} of ${activeLocations.length}`,
                      label: "Locations anybody may book into", tone: "text-[var(--cp-primary-deep)]",
                    },
                    {
                      key: "rules", value: s.bookingRules.state === "ok" ? String(rules.length) : "—",
                      label: "Active booking rules", tone: "text-violet-700",
                    },
                    {
                      key: "uncovered", value: s.sessions.state === "ok" ? String(uncovered) : "—",
                      label: "Bookable sessions no rule covers", tone: uncovered > 0 ? "text-amber-700" : "text-emerald-700",
                    },
                    {
                      key: "access", value: "None", label: "Booking access — Phase 4, not built", tone: "text-slate-400",
                    },
                    {
                      // s11 needs an explicit PRIORITY to decide equal-specificity conflicts and
                      // practice_booking_rule has no such column. A number here would be invented.
                      key: "conflicts", value: "—", label: "Rule conflicts — needs rule priority, Phase 3", tone: "text-slate-400",
                    },
                    {
                      key: "publish", value: "—", label: "Publish status — Phase 6, not built", tone: "text-slate-400",
                    },
                  ].map(m => (
                    <div key={m.key} className={card}>
                      <p className={`text-[22px] font-bold leading-none ${m.tone}`}>{m.value}</p>
                      <p className="mt-1 text-[11px] leading-snug text-gray-500">{m.label}</p>
                    </div>
                  ))}
                </div>

                <section className={card}>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-[14px] text-violet-700">⚌</span>
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-bold text-gray-900">Booking rules in force</h3>
                      <p className="text-[11px] text-gray-500">
                        These are the rules that actually refuse a booking today.
                      </p>
                    </div>
                    <Link href="/practice/setup/availability?step=4"
                      className="ml-auto rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                      Edit rules
                    </Link>
                  </div>
                  {s.bookingRules.state !== "ok" ? (
                    <Unreadable what="Your booking rules could not be read." />
                  ) : rules.length === 0 ? (
                    <p className="text-[12px] text-amber-700">
                      No rule is in force, so there is no notice period, no booking horizon and no
                      walk-in limit anywhere in this practice.
                    </p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {rules.map(r => (
                        <li key={r.id} className="rounded-lg border border-gray-200 px-3 py-2.5">
                          <p className="text-[12.5px] font-bold text-gray-900">
                            {r.location_id ? locations.find(l => l.id === r.location_id)?.name ?? "A location" : "Whole practice"}
                            {r.appointment_type ? ` · ${appointmentTypeLabel(r.appointment_type)}` : ""}
                          </p>
                          {/* s15: plain language, never "policy expression". */}
                          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">
                            {r.booking_horizon_days
                              ? `Patients may book from ${r.booking_horizon_days} days before`
                              : "Patients may book at any distance ahead"}
                            {r.lead_time_minutes
                              ? ` until ${r.lead_time_minutes} minutes before the appointment.`
                              : " until the appointment starts."}
                            {r.walk_in_daily_limit != null && ` Up to ${r.walk_in_daily_limit} walk-ins a day.`}
                          </p>
                          <p className="mt-1 text-[10px] text-gray-400">
                            Visibility &ldquo;{r.visibility ?? "not set"}&rdquo; is stored and read by
                            nothing — there is no patient-facing page for it to govern.
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <NotBuilt
                  title="Rule cards and the guided builder"
                  phase="Phase 3"
                  what={"s7.1 replaces the row above with cards carrying scope, types, window, capacity, access and confirmation, and s7.2 gives each one a twelve-section builder — identity, scope, window, capacity, eligibility, follow-ups, walk-ins, confirmation, cancellations, required information, notifications and overrides. practice_booking_rule holds five of those inputs and has no versioning, which s11 requires before any booking can record which rule decided it. The editor linked above is the one that works."} />

                <NotBuilt
                  title="Patient booking access"
                  phase="Phase 4"
                  what={"s8's practitioner handle and URL, OTP verification and abuse protection, guest versus account booking, existing-patient matching, and the Draft / Ready / Published / Paused state. None of it exists, so no session can be set to Link only or Public — the session editor in Layer 1 shows those two modes and refuses them, and so does the engine."} />

                <NotBuilt
                  title="Scenario preview and publish validation"
                  phase="Phase 6"
                  what={"s10.1's eight testable scenarios and s10.2's eleven publish checks. The Layer 1 panel beside this shows what the booking engine would offer from real slots and real rules, which is the honest half of a preview: it cannot simulate a patient, because there is no patient-facing path to simulate."} />
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
                  {s.upcomingExceptions.state !== "ok" ? (
                    <p className="text-[11px] text-slate-500">Could not be read.</p>
                  ) : (
                    <ul className="space-y-1.5 text-[11.5px]">
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Leave and closures</span>
                        <span className="ml-auto font-bold text-amber-700">
                          {exceptions.filter(e => ["leave", "closure"].includes(e.kind)).length}
                        </span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Extra and extended sessions</span>
                        <span className="ml-auto font-bold text-emerald-700">
                          {exceptions.filter(e => ["extra_session", "extended_hours"].includes(e.kind)).length}
                        </span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Days affected</span>
                        <span className="ml-auto font-bold text-violet-700">
                          {new Set(exceptions.flatMap(e => [e.from_date, e.to_date])).size}
                        </span>
                      </li>
                    </ul>
                  )}
                </section>
                <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
                  <h3 className="text-[13px] font-bold text-slate-600">Patients affected</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Not computed. Working out who a change strands, and offering a way to resolve it, is
                    Phase 2 — and a nought here would read as &ldquo;nobody is affected&rdquo;.
                  </p>
                </section>
              </>
            )}

            {active === 3 && (
              <>
                <section className={card}>
                  <h3 className="mb-2 text-[13px] font-bold text-gray-900">Booking page status</h3>
                  <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-slate-600">
                    <span aria-hidden className="h-2 w-2 rounded-full bg-slate-300" />
                    No booking page
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                    There is no handle, no URL and no publish state. Nobody outside this practice can
                    reach your diary, and no setting on this page changes that until Phase 4 exists.
                  </p>
                </section>
                <section className={card}>
                  <h3 className="mb-2 text-[13px] font-bold text-gray-900">What the engine would offer</h3>
                  <p className="text-[11.5px] leading-relaxed text-gray-600">
                    Over the next fortnight,{" "}
                    <span className="font-bold text-emerald-700">
                      {preview.days.reduce((n: number, d: any) => n + d.offerable, 0)}
                    </span>{" "}
                    of{" "}
                    <span className="font-bold text-gray-800">
                      {preview.days.reduce((n: number, d: any) => n + d.total, 0)}
                    </span>{" "}
                    slots would be offerable under your rules.
                  </p>
                  <p className="mt-2 text-[10px] leading-relaxed text-gray-500">{preview.note}</p>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
