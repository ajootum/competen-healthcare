import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { operationsHome } from "@/lib/practice/operations-home";
import { commandCentre } from "@/lib/practice/command-centre";
import { resolvePreferences } from "@/lib/practice/preferences";
import {
  HERO_SWATCH, HERO_ICON, PANEL, FOLLOWUP_SWATCH, COHORT_RING,
  QUEUE_SWATCH, QUICK_SWATCH, QUICK_ICON, PERFORMANCE_SWATCH, SEVERITY,
} from "@/lib/practice/palette";

// CPR-001_v4 PRACTICE COMMAND CENTRE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// LAID OUT TO THE v4 COMP: hero briefing with six stats and a clinic bar · the week's locations ·
// today's timeline · the live waiting queue · follow-up intelligence · operational alerts · tasks ·
// messages · recent patients · patient insights · recent documents · practice performance · quick
// access.
//
// COLOUR IS PART OF THE SPECIFICATION, NOT DECORATION. The first build of this page was near-monochrome
// and every one of the fourteen widgets read at identical weight -- a screen meant to be scanned in ten
// seconds at the start of a clinic became something you had to read word by word. All hues come from
// ./palette.ts, which is itself only CPR-040 tokens; see the reasoning there for which ones carry
// meaning and which are merely there to make a row scannable.
//
// WHAT IS DIFFERENT FROM THE COMP, AND WHY, IS ON THE PAGE ITSELF -- not only in this comment. The
// briefing is derived rather than AI-written; every average carries the number of measurements behind
// it; the cohort counts are the practice's own typed diagnoses rather than a fixed condition list.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const panelTitle = "text-[13px] font-bold text-gray-900";
const panelLink = "ml-auto text-[11px] font-semibold text-[var(--cp-primary)] hover:underline";

/** The comp's panel header: a tinted icon badge, a title, and a link on the right. */
function PanelHead({ k, title, href, hrefLabel, count }: {
  k: string; title: string; href?: string; hrefLabel?: string; count?: number | null;
}) {
  const p = PANEL[k] ?? PANEL.brief;
  return (
    <div className="mb-3 flex items-center gap-2">
      <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] ${p.badge}`}>
        {p.icon}
      </span>
      <h2 className={panelTitle}>{title}</h2>
      {typeof count === "number" && (
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">{count}</span>
      )}
      {href && <Link href={href} className={panelLink}>{hrefLabel ?? "View all"} →</Link>}
    </div>
  );
}

const dayName = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const dayNumber = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function PracticeCommandCentre() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const admin = createAdminClient();
  const [home, cc, { effective }] = await Promise.all([
    operationsHome(admin, ctx),
    commandCentre(admin, ctx),
    resolvePreferences(admin, ctx.workspaceId, ctx.userId),
  ]);

  // CPR-360 dashboard customisation, applied with `order` on the grid children rather than by
  // restructuring the page. A hidden widget stays in the markup as display:none: every widget is filled
  // by the same two calls, so not rendering one would save no query -- and a layout expressed as CSS is
  // one that cannot drift out of step with what the page actually contains.
  const widget = (key: string): React.CSSProperties | undefined => {
    const i = effective.dashboardWidgets.findIndex(w => w.key === key);
    if (i === -1) return undefined;
    return effective.dashboardWidgets[i].visible ? { order: i } : { display: "none" };
  };

  const readAt = new Date(cc.readAtIso);
  const hourInPractice = Number(
    readAt.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: cc.timezone }),
  );
  const firstName = cc.greetingName;

  const clinicLine = cc.clinic.state === "before"
    ? "Your clinic has not opened yet."
    : cc.clinic.state === "finished"
      ? "Your clinic has closed for the day."
      : cc.heroStats[0].value === 0 ? "Nothing is booked today."
        : `You have ${cc.heroStats[0].value} in the diary today.`;

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">

        {/* ── Title ─────────────────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-baseline gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Practice Command Centre</h1>
            <p className="text-[13px] text-gray-500">Your operational overview and daily command centre.</p>
          </div>
          <p className="ml-auto text-[11px] text-gray-500">
            Read at {readAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: cc.timezone })}
            {" · "}{cc.timezone}
          </p>
        </div>

        {/* ── Hero briefing ─────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* The comp's hero is a tinted panel, not a white card -- it is the one block on the page
                that is a greeting rather than a worklist. */}
            <div className="rounded-xl border border-[var(--cp-primary)]/15 bg-gradient-to-br from-[var(--cp-primary)]/[0.06] to-white p-4">
              <h2 className="text-[19px] font-bold text-gray-900">
                {greeting(hourInPractice)}{firstName ? `, ${firstName}` : ""}
              </h2>
              <p className="mt-0.5 text-[13px] text-gray-500">{clinicLine}</p>

              {/* Six stats. Each carries its own tinted icon so the row can be scanned rather than
                  read -- see palette.ts for why only "Overdue Reviews" has a hue that means something. */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {cc.heroStats.map(s => {
                  const sw = HERO_SWATCH[s.key] ?? HERO_SWATCH.new_patients;
                  return (
                    <div key={s.key}>
                      {s.available ? (
                        <Link href={s.href} className="group block">
                          <span aria-hidden className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg text-[13px] ${sw.badge}`}>
                            {HERO_ICON[s.key] ?? "•"}
                          </span>
                          <p className={`text-[24px] font-bold leading-none ${sw.figure}`}>{s.value}</p>
                          <p className="mt-1 text-[11px] leading-tight text-gray-500 group-hover:text-gray-800">{s.label}</p>
                        </Link>
                      ) : (
                        <>
                          <span aria-hidden className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-[13px] text-gray-300">
                            {HERO_ICON[s.key] ?? "•"}
                          </span>
                          <p className="text-[24px] font-bold leading-none text-gray-300">—</p>
                          <p className="mt-1 text-[11px] leading-tight text-gray-400">{s.label}</p>
                          <p className="text-[9px] leading-tight text-gray-400">not visible to you</p>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Clinic window. The bar is the day elapsed, not work completed -- a very different
                  claim, and one nothing here measures. */}
              <div className="mt-4 border-t border-[var(--cp-primary)]/10 pt-3">
                <div className="flex flex-wrap items-baseline gap-2 text-[12px]">
                  <span className="font-semibold text-gray-800">
                    Clinic: {cc.clinic.opensLabel} – {cc.clinic.closesLabel}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    cc.clinic.state === "in_progress" ? "bg-emerald-100 text-emerald-800"
                      : cc.clinic.state === "before" ? "bg-cyan-100 text-cyan-800"
                        : "bg-slate-100 text-slate-600"}`}>
                    {cc.clinic.state === "in_progress" ? "In progress"
                      : cc.clinic.state === "before" ? "Not open yet" : "Closed"}
                  </span>
                  {cc.clinic.estimatedFinishLabel && (
                    <span className={`ml-auto ${cc.clinic.runningLate ? "font-semibold text-amber-700" : "text-gray-600"}`}>
                      Last booking ends: {cc.clinic.estimatedFinishLabel}
                      {cc.clinic.runningLate ? " — after closing" : ""}
                    </span>
                  )}
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--cp-primary)]/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-[var(--cp-primary)] to-[var(--cp-accent)]"
                    style={{ width: `${cc.clinic.progressPercent ?? 0}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-gray-400">
                  The bar shows how much of the clinic day has passed, not how much work is done.
                </p>
              </div>
            </div>

            {/* Today's brief — the comp's "AI Briefing", named for what it is. */}
            <div className={card}>
              <div className="mb-3 flex items-center gap-2">
                <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] ${PANEL.brief.badge}`}>
                  {PANEL.brief.icon}
                </span>
                <h2 className={panelTitle}>Today&apos;s brief</h2>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                  Derived
                </span>
              </div>
              {home.attention.length === 0 ? (
                <p className="text-[12px] text-gray-500">
                  {home.allClear ? "Nothing is waiting on you." : "Nothing to raise from what you can see."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {home.attention.slice(0, 4).map((a: any) => (
                    <li key={a.kind}>
                      <Link href={a.href} className="flex items-start gap-2 text-[12px] leading-snug text-gray-700 hover:text-[var(--cp-primary)]">
                        <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY[a.severity]?.dot ?? "bg-slate-400"}`} />
                        <span>{a.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {/* THE ONE SENTENCE THAT KEEPS THE PANEL HONEST. The comp badges this "AI · BETA". */}
              <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-400">
                Worked out from your diary, follow-ups and inbox — not written by a model, and it makes no
                prediction about how long anyone will take.
              </p>
            </div>
          </div>

          {/* ── My locations this week ──────────────────────────────────────────────────────────── */}
          <div className={card} style={widget("locations")}>
            <PanelHead k="locations" title="My locations this week" href="/practice/calendar" hrefLabel="Full schedule" />
            <ul className="space-y-1">
              {cc.weekLocations.map(d => (
                <li key={d.date} className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${
                  d.isToday ? "bg-[var(--cp-primary)]/8 ring-1 ring-inset ring-[var(--cp-primary)]/20" : ""}`}>
                  <div className="w-11 shrink-0">
                    <p className={`text-[12px] font-semibold ${d.isToday ? "text-[var(--cp-primary-deep)]" : "text-gray-700"}`}>{dayName(d.date)}</p>
                    <p className="text-[10px] text-gray-400">{dayNumber(d.date)}</p>
                  </div>
                  <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${
                    d.placeRecorded ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-300"}`}>
                    ◎
                  </span>
                  <div className="min-w-0 flex-1">
                    {d.placeRecorded ? (
                      <>
                        <p className="truncate text-[12px] font-semibold text-gray-800">{d.locationName}</p>
                        <p className="truncate text-[10px] text-gray-500">
                          {d.appointmentCount} booked
                          {d.otherLocationCount > 0 ? ` · and ${d.otherLocationCount} other ${d.otherLocationCount === 1 ? "place" : "places"}` : ""}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[12px] text-gray-400">
                          {d.appointmentCount === 0 ? "Nothing booked" : `${d.appointmentCount} booked`}
                        </p>
                        {/* A day with bookings but no place is NOT the same as a day with nothing on. */}
                        {d.appointmentCount > 0 && (
                          <p className="text-[10px] text-amber-700">no place recorded</p>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Row: timeline · queue · follow-up intelligence ─────────────────────────────────────── */}
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-4 lg:grid-cols-3">

            <div className={card} style={widget("schedule")}>
              <PanelHead k="timeline" title="Today's timeline" href="/practice/calendar" hrefLabel="Full calendar" />
              {cc.timeline.length === 0 ? (
                <p className="text-[12px] text-gray-400">Nothing in the diary today.</p>
              ) : (
                <ul className="space-y-2">
                  {cc.timeline.slice(0, 8).map(t => (
                    <li key={t.id} className="flex items-baseline gap-2">
                      <span className="w-10 shrink-0 text-[11px] tabular-nums text-gray-400">{t.timeLabel}</span>
                      <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full ring-2 ring-white" style={{ background: t.colour }} />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gray-800">{t.patientName}</span>
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                        style={{ background: `color-mix(in srgb, ${t.colour} 14%, white)`, color: t.colour }}>
                        {t.typeLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {cc.timeline.length > 8 && (
                <p className="mt-2 text-[11px] text-gray-400">and {cc.timeline.length - 8} more today</p>
              )}
            </div>

            <div className={card} style={widget("queue")}>
              <PanelHead k="queue" title="Waiting queue" href="/practice/calendar" hrefLabel="Full queue"
                count={cc.queue ? cc.queue.length : undefined} />
              {!cc.queue ? (
                <p className="text-[12px] text-gray-400">The queue is not visible to you.</p>
              ) : cc.queue.length === 0 ? (
                <p className="text-[12px] text-gray-400">Nobody is waiting.</p>
              ) : (
                <ul className="space-y-2">
                  {cc.queue.slice(0, 7).map(q => {
                    const sw = QUEUE_SWATCH[q.status] ?? QUEUE_SWATCH.PAUSED;
                    return (
                      <li key={q.id} className="flex items-center gap-2">
                        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${sw.dot}`} />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gray-800">{q.patientName}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${sw.chip}`}>
                          {q.status.replace(/_/g, " ").toLowerCase()}
                        </span>
                        {/* Waited-for, not arrived-at: the number a clinic acts on. */}
                        <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-gray-400">
                          {q.waitingMinutes} min
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className={card} style={widget("followups")}>
              <PanelHead k="followups" title="Follow-up intelligence" href="/practice/follow-ups" />
              {!cc.followUpIntelligence ? (
                <p className="text-[12px] text-gray-400">Follow-ups are not visible to you.</p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {cc.followUpIntelligence.map(t => {
                    const sw = FOLLOWUP_SWATCH[t.key] ?? FOLLOWUP_SWATCH.need_booking;
                    // A RED NOUGHT TRAINS PEOPLE TO IGNORE RED. Overdue only takes its colour when
                    // there is something overdue.
                    const loud = t.tone === "critical" && t.value > 0;
                    return (
                      <div key={t.key} className={`rounded-lg border px-2 py-2.5 text-center ${loud ? sw.box : t.tone === "critical" ? "border-gray-200" : sw.box}`}>
                        <p className={`text-[19px] font-bold leading-none ${loud || t.tone !== "critical" ? sw.figure : "text-gray-400"}`}>
                          {t.value}
                        </p>
                        <p className="mt-1 text-[9px] leading-tight text-gray-600">{t.label}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Operational alerts ──────────────────────────────────────────────────────────────── */}
          <div className={card} style={widget("alerts")}>
            <PanelHead k="alerts" title="Operational alerts" />
            {home.attention.length === 0 && home.blindSpots.length === 0 ? (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-2.5 py-2">
                <span aria-hidden className="mt-0.5 text-[12px] text-emerald-600">✓</span>
                <p className="text-[12px] text-emerald-900">Nothing owed, and nothing hidden from you.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {home.attention.map((a: any) => {
                  const sv = SEVERITY[a.severity] ?? SEVERITY.normal;
                  return (
                    <li key={a.kind}>
                      <Link href={a.href} className={`block rounded-lg border-l-[3px] py-0.5 pl-2.5 group ${sv.border}`}>
                        <p className={`text-[12px] font-semibold ${sv.text} group-hover:underline`}>{a.title}</p>
                        <p className="text-[11px] leading-snug text-gray-500">{a.detail}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {/* A ZERO IS EARNED; A BLIND SPOT IS NAMED. "Nothing is owed" and "you cannot see what is
                owed" are different sentences, and conflating them tells a locum their day is clear. */}
            {home.blindSpots.length > 0 && (
              <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-500">
                Not shown to you: {home.blindSpots.join(", ")}. This list cannot tell you whether anything
                is waiting there.
              </p>
            )}
          </div>
        </section>

        {/* ── Row: tasks · messages · recent patients ─────────────────────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className={card} style={widget("tasks")}>
            <PanelHead k="tasks" title="Tasks for today" href="/practice/tasks" hrefLabel="Go to tasks" />
            {home.attention.find((a: any) => a.kind === "task_due") ? (
              <ul className="space-y-1.5">
                {(home.attention.find((a: any) => a.kind === "task_due")?.sample ?? []).map((t: any, i: number) => (
                  <li key={i} className="flex items-baseline gap-2 text-[12px]">
                    <span aria-hidden className="text-cyan-400">☐</span>
                    <span className="min-w-0 flex-1 truncate text-gray-800">{t.label ?? t.title ?? String(t)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-gray-400">Nothing due from you today.</p>
            )}
            <Link href="/practice/tasks"
              className="mt-3 block rounded-lg border border-dashed border-cyan-300 py-1.5 text-center text-[11px] font-semibold text-cyan-700 hover:bg-cyan-50">
              + Create new task
            </Link>
          </div>

          <div className={card} style={widget("messages")}>
            <PanelHead k="messages" title="Messages" href="/practice/messages" hrefLabel="Go to inbox" />
            {(() => {
              const m = home.attention.find((a: any) => a.kind === "message_unread");
              const r = home.attention.find((a: any) => a.kind === "incoming_unreviewed");
              if (!m && !r) return <p className="text-[12px] text-gray-400">Nothing new.</p>;
              return (
                <ul className="space-y-2">
                  {[m, r].filter(Boolean).map((a: any) => (
                    <li key={a.kind}>
                      <Link href={a.href} className="flex items-start gap-2 hover:text-[var(--cp-primary)]">
                        <span aria-hidden className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY[a.severity]?.dot ?? "bg-slate-400"}`} />
                        <span className="min-w-0">
                          <span className="block text-[12px] font-semibold text-gray-800">{a.title}</span>
                          <span className="block text-[11px] text-gray-500">{a.detail}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>

          <div className={card} style={widget("recent_patients")}>
            <PanelHead k="recent_patients" title="Recent patients" href="/practice/patients" />
            {!cc.recentPatients ? (
              <p className="text-[12px] text-gray-400">Patient records are not visible to you.</p>
            ) : cc.recentPatients.length === 0 ? (
              <p className="text-[12px] text-gray-400">You have not opened a record yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {cc.recentPatients.map((p, i) => (
                  <li key={p.id}>
                    <Link href={`/practice/patients/${p.id}`} className="flex items-center gap-2 text-[12px] hover:text-[var(--cp-primary)]">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${COHORT_RING[i % COHORT_RING.length]}`}>
                        {p.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-gray-800">{p.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {/* Says where the list comes from: it is the reader's own access log, not a global feed. */}
            <p className="mt-2 text-[10px] text-gray-400">Records you opened, most recent first.</p>
          </div>
        </section>

        {/* ── Row: patient insights · recent documents · quick access ──────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className={card} style={widget("insights")}>
            <PanelHead k="insights" title="Patient insights" href="/practice/reports" hrefLabel="View dashboard" />
            {!cc.patientInsights ? (
              <p className="text-[12px] text-gray-400">Consultations are not visible to you.</p>
            ) : cc.patientInsights.cohorts.length === 0 ? (
              <p className="text-[12px] text-gray-400">No diagnosis has been recorded yet.</p>
            ) : (
              <>
                <div className="grid grid-cols-5 gap-1.5">
                  {cc.patientInsights.cohorts.map((c, i) => (
                    <div key={c.label} className="text-center">
                      <span aria-hidden className={`mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold ${COHORT_RING[i % COHORT_RING.length]}`}>
                        {c.count}
                      </span>
                      <p className="line-clamp-2 text-[9px] leading-tight text-gray-500">{c.label}</p>
                    </div>
                  ))}
                </div>
                {/* COUNTED AS TYPED. The comp names five neurology cohorts; those are the designer's
                    specialty, and bucketing into them would invent a coding nobody performed. */}
                <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
                  Patients per diagnosis, counted exactly as it was typed
                  {cc.patientInsights.otherLabelCount > 0
                    ? ` — ${cc.patientInsights.otherLabelCount} other ${cc.patientInsights.otherLabelCount === 1 ? "label" : "labels"} not shown.`
                    : "."}
                </p>
              </>
            )}
          </div>

          <div className={card} style={widget("documents")}>
            <PanelHead k="documents" title="Recent documents" href="/practice/documents" />
            {cc.recentDocuments.length === 0 ? (
              <p className="text-[12px] text-gray-400">Nothing issued yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {cc.recentDocuments.map((d: any) => (
                  <li key={d.id}>
                    <Link href={`/practice/documents/${d.id}`} className="flex items-baseline gap-2 text-[12px] hover:text-[var(--cp-primary)]">
                      <span aria-hidden className="text-amber-500">▦</span>
                      <span className="min-w-0 flex-1 truncate text-gray-800">{d.title}</span>
                      <span className="shrink-0 text-[10px] text-gray-400">
                        {new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: cc.timezone })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={card} style={widget("quick_actions")}>
            <PanelHead k="quick" title="Quick access" />
            {cc.quickAccess.length === 0 ? (
              <p className="text-[12px] text-gray-400">No action here is available to you.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {cc.quickAccess.map((a, i) => (
                  <Link key={a.key} href={a.href}
                    className={`rounded-lg border px-2 py-2.5 text-center transition-shadow hover:shadow-sm ${QUICK_SWATCH[i % QUICK_SWATCH.length]}`}>
                    <span aria-hidden className="block text-[15px] leading-none">{QUICK_ICON[a.key] ?? "•"}</span>
                    <span className="mt-1.5 block text-[10px] font-semibold leading-tight">{a.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Practice performance ─────────────────────────────────────────────────────────────────── */}
        <section className={card} style={widget("health")}>
          <PanelHead k="performance" title="Practice performance (today)" href="/practice/reports" hrefLabel="View report" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cc.performance.map(p => (
              <div key={p.key} className="rounded-lg bg-[var(--cp-canvas)] px-3 py-2.5">
                {p.value !== null ? (
                  <>
                    <p className={`text-[22px] font-bold leading-none ${PERFORMANCE_SWATCH[p.key] ?? "text-gray-900"}`}>
                      {p.value}{p.unit ? <span className="ml-0.5 text-[12px] font-semibold opacity-70">{p.unit}</span> : null}
                    </p>
                    <p className="mt-1 text-[11px] leading-tight text-gray-600">{p.label}</p>
                    {/* NO AVERAGE WITHOUT ITS DENOMINATOR. "18 min" over three consultations is not a
                        measurement, and the comp shows four such figures with no n at all. */}
                    {p.overCount !== null && (
                      <p className="text-[9px] leading-tight text-gray-400">
                        over {p.overCount} {p.overCount === 1 ? "measurement" : "measurements"}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[22px] font-bold leading-none text-gray-300">—</p>
                    <p className="mt-1 text-[11px] leading-tight text-gray-500">{p.label}</p>
                    <p className="text-[9px] leading-tight text-gray-400">{p.reason}</p>
                  </>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-gray-400">
            Measured from check-in, consultation start and consultation end. No comparison with yesterday
            or last week — nothing has recorded a baseline to compare against.
          </p>
        </section>

        {/* ── What this screen will not claim ──────────────────────────────────────────────────────── */}
        <details className={card}>
          <summary className="cursor-pointer list-none text-[12px] font-semibold text-gray-600 hover:text-gray-900">
            <span className="mr-1 text-gray-400">›</span>
            {cc.refused.length} things the design shows that this build will not claim
          </summary>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {cc.refused.map(r => (
              <li key={r.key}>
                <p className="text-[12px] font-semibold text-gray-700">{r.label}</p>
                <p className="text-[11px] leading-relaxed text-gray-500">{r.detail}</p>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
