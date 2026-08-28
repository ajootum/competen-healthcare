import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { practiceSessions, readingValue, type SessionView, type LocationView } from "@/lib/practice/practice-sessions";
import { bookingPreview } from "@/lib/practice/availability-config";
import { scheduleChanges, impactReadingValue, type ScheduleChangeView, type QueuedAction } from "@/lib/practice/schedule-exceptions";
import { formatDayTime } from "@/lib/datetime";
import { LAYER1_STAT_SWATCH } from "@/lib/practice/practice-session-constants";
import { LAYER2_STAT_SWATCH } from "@/lib/practice/schedule-exception-constants";
import { REFUSAL_STATE_COPY } from "@/lib/practice/refusal-presentation";
import SessionWorkspace from "../availability-booking/SessionWorkspace";
import ExceptionWorkspace from "../availability-booking/ExceptionWorkspace";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Availability & Changes" };

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-SETUP-HFE-001 s8 -- AVAILABILITY & CHANGES. Schedule structure, and nothing else.
//
// Two tabs: the regular week (recurring clinics and the pattern they make), and the one-off changes
// that bend it. Patient-booking behaviour is a different question with a different home (Patient
// Booking); this page keeps the safety rule that matters here -- a schedule change that affects booked
// patients is not written until somebody says what happens to them.
//
// The old three-layer console's ?layer=1 and ?layer=2 redirect here (SET-HFE-10).
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

function Unreadable({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-slate-600">
      <span className="font-bold">Could not be read.</span> {what} This is not a count of nothing — it is
      no count at all, so nothing on this panel should be acted on until it loads.
    </p>
  );
}

/** A capability that does not exist yet, said plainly. The provenance props are not rendered. */
function NotAvailable({ title, what }: {
  title: string; what: string; reasonCode?: string; specReference?: string; technicalDetail?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12.5px] font-bold text-slate-600">{title}</p>
        <span className="rounded bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
          {REFUSAL_STATE_COPY.NOT_AVAILABLE_YET.title}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{what}</p>
    </div>
  );
}

export default async function AvailabilityChangesPage({ searchParams }: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;
  if (!hasCapability(ctx, "appointment.manage") && !hasCapability(ctx, "practice.calendar.view"))
    redirect("/practice/setup");

  const admin = createAdminClient();
  const [s, x] = await Promise.all([practiceSessions(admin, ctx), scheduleChanges(admin, ctx)]);

  const { tab } = await searchParams;
  const active = tab === "changes" ? "changes" : "regular";

  const sessions = readingValue(s.sessions, [] as SessionView[]);
  const locations = readingValue(s.locations, [] as LocationView[]);
  const clinics = readingValue(s.clinics, [] as any[]);
  const changes = impactReadingValue(x.changes, [] as ScheduleChangeView[]);
  const queue = impactReadingValue(x.queue, [] as QueuedAction[]);
  const changesUnreadable = x.changes.state === "unreadable" ? x.changes.reason : null;
  const queueUnreadable = x.queue.state === "unreadable" ? x.queue.reason : null;
  const unreviewed = x.unreviewed;

  const liveSessions = sessions.filter(v => v.status === "active" && v.effectiveState === "current");
  const activeLocations = locations.filter(l => l.active);
  const plannedSlots = liveSessions.reduce((n, v) => n + (v.capacity.effective ?? 0), 0);
  const sessionsWithoutCapacity = liveSessions.filter(v => v.capacity.effective === null).length;

  const fortnightEnd = new Date(Date.parse(`${s.today}T12:00:00Z`) + 13 * 86400000).toISOString().slice(0, 10);
  const preview = active === "regular"
    ? await bookingPreview(admin, ctx, { fromDate: s.today, toDate: fortnightEnd })
    : null;
  const nextEntry = preview
    ? preview.days.flatMap((d: any) => d.entries).filter((e: any) => e.offerable)
      .sort((a: any, b: any) => Date.parse(a.from) - Date.parse(b.from))[0] ?? null
    : null;

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
              <span className="text-gray-500">Availability &amp; Changes</span>
            </nav>
            <h1 className="text-2xl font-bold text-gray-900">Availability &amp; Changes</h1>
            <p className="text-[13px] text-gray-500">
              Your regular week, and the one-off changes that bend it. All times are in {s.timezone}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/practice/calendar"
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Open the planner
            </Link>
            <Link href="/practice/setup/patient-booking"
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Patient booking →
            </Link>
          </div>
        </div>

        <nav className="flex flex-wrap gap-1" aria-label="Availability areas">
          {[{ key: "regular", label: "Regular week" }, { key: "changes", label: "Changes & exceptions" }].map(t => (
            <Link key={t.key} href={`/practice/setup/availability-changes?tab=${t.key}`}
              aria-current={active === t.key ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                active === t.key
                  ? "bg-violet-600 text-white"
                  : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}>
              {t.label}
            </Link>
          ))}
        </nav>

        {s.readFailures.length > 0 && <Unreadable what={s.readFailures.join(" ")} />}

        {/* ══ REGULAR WEEK ══════════════════════════════════════════════════════════════════════ */}
        {active === "regular" && (
          s.sessions.state !== "ok" ? (
            <Unreadable what="Your regular week could not be read, so this page is showing nothing rather than showing an empty week." />
          ) : (
            <>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { key: "locations", n: activeLocations.length, label: "Locations active" },
                  { key: "sessions", n: liveSessions.length, label: "Weekly clinics running" },
                  { key: "appointment_types", n: s.typesOffered.length, label: "Appointment types offered" },
                  {
                    key: "capacity",
                    n: sessionsWithoutCapacity > 0 ? null : plannedSlots,
                    label: sessionsWithoutCapacity > 0
                      ? `${sessionsWithoutCapacity} clinic${sessionsWithoutCapacity === 1 ? "" : "s"} hold an unknown number`
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
                recurrenceAvailable={s.recurrenceAvailable}
              />

              {/* ── Where you work — the records from Locations & Clinics, never a second copy. ── */}
              <section className={card}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[14px] text-[var(--cp-primary-deep)]">◎</span>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-bold text-gray-900">Where you work</h3>
                    <p className="text-[11px] text-gray-500">
                      These are your records from Locations &amp; Clinics. Nothing here creates a second
                      copy of them.
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
                          {` · ${l.sessionCount} clinic${l.sessionCount === 1 ? "" : "s"}`}
                        </p>
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

              <div className="grid gap-4 md:grid-cols-2">
                <section className={card}>
                  <h3 className="mb-2 text-[13px] font-bold text-gray-900">What your week adds up to</h3>
                  {liveSessions.length === 0 ? (
                    <p className="text-[11.5px] leading-relaxed text-gray-500">
                      Nothing repeats yet. Add a clinic on any day above.
                    </p>
                  ) : (
                    <ul className="space-y-1.5 text-[11.5px]">
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Working days</span>
                        <span className="ml-auto font-bold text-emerald-700">{new Set(liveSessions.map(v => v.weekday)).size}</span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Hours a week</span>
                        <span className="ml-auto font-bold text-cyan-700">
                          {Number((liveSessions.reduce((n, v) => n + (v.endsMinute - v.startsMinute), 0) / 60).toFixed(1))}
                        </span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Clinics anybody may book</span>
                        <span className="ml-auto font-bold text-violet-700">{liveSessions.filter(v => v.bookingMode !== "none").length}</span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="text-gray-600">Clinics allowing walk-ins</span>
                        <span className="ml-auto font-bold text-amber-700">{liveSessions.filter(v => v.walkInsAllowed).length}</span>
                      </li>
                    </ul>
                  )}
                  <p className="mt-2.5 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
                    Capacity is derived from each clinic&apos;s length and its appointment length. Where
                    you have also set a manual limit, the stricter of the two applies.
                  </p>
                </section>

                <section className={card}>
                  <h3 className="mb-2 text-[13px] font-bold text-gray-900">Next available appointment</h3>
                  {nextEntry ? (
                    <>
                      <p className="text-[13px] font-bold text-[var(--cp-primary-deep)]">
                        {formatDayTime(nextEntry.from, preview!.timezone)}
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
                  {preview && (
                    <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500">
                      {preview.note}
                    </p>
                  )}
                </section>
              </div>

              {sessions.some(v => v.warnings.length > 0) && (
                <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <h3 className="text-[13px] font-bold text-amber-900">Worth a look</h3>
                  <ul className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    {sessions.filter(v => v.warnings.length > 0).slice(0, 6).map(v => (
                      <li key={v.id}>
                        <p className="text-[11.5px] font-semibold text-amber-900">
                          {v.sessionName ?? v.suggestedName}
                        </p>
                        <ul className="text-[10.5px] leading-relaxed text-amber-800/90">
                          {v.warnings.map((w, i) => <li key={i}>· {w}</li>)}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )
        )}

        {/* ══ CHANGES & EXCEPTIONS ══════════════════════════════════════════════════════════════ */}
        {active === "changes" && (
          <>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { key: "changes", n: changesUnreadable ? null : changes.length, label: "Changes in the next 6 months" },
                { key: "affected", n: queueUnreadable ? null : queue.length, label: "Patients waiting on a decision" },
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

            {unreviewed !== null && unreviewed > 0 && (
              <p className="rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[11.5px] leading-relaxed text-gray-600">
                <span className="font-bold">{unreviewed}</span> change
                {unreviewed === 1 ? " was" : "s were"} recorded without anybody checking who was booked
                into {unreviewed === 1 ? "it" : "them"}. That is not the same as nobody being booked in,
                and this page will not draw it as though it were.
              </p>
            )}

            <NotAvailable
              title="Offering the next available appointment, and a waiting list"
              what={"Competen Practice cannot offer a patient the next available appointment, or hold them on a waiting list, when you change a time. The choices are to keep the booking, cancel it, or record that the patient moved to another one."}
              // ⚠ CPR-HFE-REF-001: the practitioner reads `what`; this provenance is not rendered.
              reasonCode="NO_OFFER_STORE_NO_WAITLIST"
              specReference="CPR-AVB-001 s5.3"
              technicalDetail={"s5.3 lists six resolutions and three are real here. What is missing is somewhere to HOLD an offer and anything that would send it. The waiting-list ENTITY exists and rules may enable it, but there is no offer store on this path and no board."} />
          </>
        )}
      </div>
    </div>
  );
}
