import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { commandCentre } from "@/lib/practice/command-centre";
import { resolvePreferences } from "@/lib/practice/preferences";
import { hasCapability } from "@/lib/practice/access";
import { formatMinuteOfDay } from "@/lib/datetime";
import { dashboardReadModel } from "@/lib/practice/dashboard";
import StartYourDay from "./StartYourDay";
import LiveRefresh from "../LiveRefresh";
import OfflineCacheWriter from "../OfflineCacheWriter";
import { offlineCacheGate } from "@/lib/practice/offline-gate";
import { primaryNav } from "@/lib/practice/navigation";
import {
  PANEL, GLANCE_SWATCH, LENS_SWATCH, FOLLOWUP_SWATCH, COHORT_RING,
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

export default async function PracticeCommandCentre() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const admin = createAdminClient();
  const at = new Date();
  const [cc, { effective }] = await Promise.all([
    commandCentre(admin, ctx),
    resolvePreferences(admin, ctx.workspaceId, ctx.userId),
  ]);

  // ── CPR-CORE-001 CORE-08: ONE ASSEMBLED READ MODEL, NOT SEVEN CALLS ───────────────────────────
  //
  // The core rule on the spec's cover page: "dashboard widgets consume shared engines; widgets do not
  // own business logic". This page used to call seven engines and decide its own scope inline. The
  // answers were right and the ARRANGEMENT was wrong: the day a second surface needed the same figures
  // it would have assembled them slightly differently, which is what s16 forbids.
  //
  // The scope decision -- session-scoped after session start, day-scoped before it (s7) -- now lives in
  // the assembler, and /api/v1/practice/dashboard serves the identical payload to any other consumer.
  // ⚠ The offline gate rides alongside, resolved on the SERVER (CP-OFFLINE-SURVEY-001 s3.7) and handed to
  // the writer as plain JSON. No client-side flag evaluation exists in this repository and this does not
  // add the first one.
  const [dash, offline] = await Promise.all([
    dashboardReadModel(admin, ctx, { at }),
    offlineCacheGate(admin, ctx, ctx.userId),
  ]);
  const { plan, session: metrics, glance, queue, followUps: followUpLenses, alerts, drafts, timeline } = dash;
  const canPlan = hasCapability(ctx, "appointment.manage");
  // The rows the brief was derived from, which the alerts, tasks and messages cards render too. Read
  // ONCE by the assembler: this page used to call operationsHome itself as well, so one screen made the
  // same expensive read twice and had two chances to disagree about what was waiting.
  const home = dash.operations ?? { attention: [], blindSpots: [], allClear: false };

  // CPR-360 dashboard customisation, applied with `order` on the grid children rather than by
  // restructuring the page. A hidden widget stays in the markup as display:none: every widget is filled
  // by the same two calls, so not rendering one would save no query -- and a layout expressed as CSS is
  // one that cannot drift out of step with what the page actually contains.
  const widget = (key: string): React.CSSProperties | undefined => {
    const i = effective.dashboardWidgets.findIndex(w => w.key === key);
    if (i === -1) return undefined;
    return effective.dashboardWidgets[i].visible ? { order: i } : { display: "none" };
  };

  // Named in the practitioner's words, not the feeder's key -- "glance" means nothing to the person
  // reading, and an error message that needs the source to decode it is not a message.
  const FEEDER_LABEL: Record<string, string> = {
    plan: "today's plan", glance: "today's figures", queue: "the waiting queue",
    timeline: "the session timeline", followUps: "follow-ups", alerts: "operational alerts",
    drafts: "unfinished encounters",
  };
  // CPR-CORE-001 s7 "Practice Performance": patients seen, avg consult time, avg wait time, clinic
  // delay. Read from the SAME metrics engine the glance tiles use -- command-centre.ts held a third,
  // more wrong implementation of all four and it is deleted.
  const PERFORMANCE_KEYS = ["patients_seen", "average_consult_time", "average_wait_time", "clinic_delay"] as const;
  const performance = dash.metrics
    ? PERFORMANCE_KEYS.map(k => dash.metrics!.metrics[k])
    : [];

  const failedFeeders = Object.entries(dash.feeders)
    .filter(([, state]) => state === "unavailable")
    .map(([key]) => FEEDER_LABEL[key] ?? key);

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">

        {/* ── Title ─────────────────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-baseline gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Practice Command Centre</h1>
            <p className="text-[13px] text-gray-500">
              {/* s7: counts are session-scoped after session start, day-scoped before it. Said on the
                  page, because the same eight numbers mean different things either side of that line. */}
              {dash.scope.kind === "session"
                ? "Scoped to your running session — figures below count this clinic, not the whole day."
                : "Scoped to today — figures below count the whole day until you start a session."}
            </p>
          </div>
          {/* CORE-13 / s12: "every dashboard response must include an as_of timestamp and timezone", and
              s16: the page "does not imply live data when only snapshot data is available". So this reads
              "As of", not "Live" -- the page is a server render, and until the s10 event stream exists
              nothing on it updates by itself. Saying otherwise would be the one claim here nobody could
              check by looking. */}
          <span className="ml-auto flex items-center gap-2">
            <LiveRefresh asOf={dash.asOf} timezone={dash.timezone} />
          <p className="text-[11px] text-gray-500">
            As of {new Date(dash.asOf).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: dash.timezone })}
            {" · "}{dash.timezone}
          </p>
          </span>
        </div>

        {/* ── s14 PARTIAL FAILURE ───────────────────────────────────────────────────────────────── */}
        {/* "Render available cards and show retry on the failed card", and s16: "a failure in one feeder
            does not make the entire dashboard unusable". So this NAMES what could not be read instead of
            blanking the page -- and the cards themselves each say so too. A silent partial load is the
            worst of the three outcomes: it looks like a working dashboard reporting a quiet morning. */}
        {failedFeeders.length > 0 && !dash.unavailable && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-800">
            <span className="font-semibold">Some of this page could not be read just now</span>
            {" — "}{failedFeeders.join(", ")}. Everything else below is current; those cards show no figure
            rather than a nought.
          </p>
        )}
        {dash.unavailable && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[12.5px] text-rose-800">
            <span className="font-semibold">None of this page could be read just now.</span> Nothing below
            is a claim about your practice — it is a claim that the read failed.
          </p>
        )}

        {/* ── Hero briefing ─────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* THE COMP'S TOP ROW: Zone 1 · Today at a Glance · Today's Brief. */}
          <div className="grid gap-4 lg:grid-cols-3">

            {/* ⚠ CPR-V5-001 s2 REPLACES THE GREETING WITH THE CURRENT ACTIVITY. The card that stood here
                said "Good morning, Elisha" and then six counters -- pleasant, and it answered no question
                a practitioner has at 08:00. What replaces it is the one control that changes what every
                other card on this page MEANS, because each of them scopes to the running session. */}
            <StartYourDay plan={plan} metrics={metrics} canPlan={canPlan} />

            {/* ── TODAY AT A GLANCE (s3) ──────────────────────────────────────────────────────── */}
            <div className={card}>
              <div className="mb-3 flex items-center gap-2">
                <h2 className={panelTitle}>Today at a glance</h2>
                {/* THE WINDOW IS ON THE CARD, not assumed. The same eight tiles mean "this clinic"
                    during a session and "today" outside one, and an unlabelled figure is the wrong
                    answer half the time. */}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                  {glance.scope === "session" ? "This session" : "Today"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {glance.tiles.map(t => {
                  // The comp gives every tile a tinted icon badge and a coloured figure, and the colour
                  // MEANS something -- see GLANCE_SWATCH. Drawn grey, all eight read at identical weight
                  // and the emergency tile disappears into the no-show tile beside it.
                  const s = GLANCE_SWATCH[t.key] ?? GLANCE_SWATCH.booked;
                  // s16 requires every metric to be "traceable to source records and a documented
                  // formula". It travels WITH the number, so the tile can say where it came from
                  // without anyone opening a spec -- and say why there is no number when there is not.
                  const why = t.count === null ? (t.reason ?? "No figure available.") : null;
                  return (
                    <Link key={t.key} href={t.href}
                      title={why ?? `${t.formula} Source: ${t.sources.join(", ")}.`}
                      className={`rounded-lg border px-2.5 py-2 transition-shadow hover:shadow-sm ${s.box}`}>
                      <span className="flex items-center justify-between gap-1">
                        {/* A NULL COUNT RENDERS AN EM DASH. "Could not read" and "none" are different
                            answers and a zero is the more dangerous of the two to guess. */}
                        <span className={`text-[19px] font-bold leading-none tabular-nums ${s.figure}`}>
                          {t.count === null ? "—" : t.count}
                        </span>
                        <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] ${s.badge}`}>
                          {s.icon}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-[10.5px] text-gray-600">{t.label}</span>
                      {why && (
                        <span className="mt-0.5 block truncate text-[9.5px] leading-tight text-gray-500">{why}</span>
                      )}
                    </Link>
                  );
                })}
              </div>

              {/* SESSION PROGRESS (s3). Only when a session is running: outside one there is no session
                  to be a proportion of, and the old bar measured the clinic DAY elapsed, which is a
                  different claim that nothing on this page needs. */}
              {metrics && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold text-gray-700">Session progress</span>
                    <span className="text-[11px] tabular-nums text-gray-500">
                      {formatMinuteOfDay(metrics.activity.plannedStartMinute)} – {formatMinuteOfDay(metrics.activity.plannedEndMinute)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--cp-primary)]/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-[var(--cp-primary)] to-[var(--cp-accent)]"
                      style={{ width: `${metrics.progressPercent}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">
                    {metrics.progressPercent}% of the allotted time has passed. This measures the clock,
                    not how much work is done.
                  </p>
                </div>
              )}
            </div>

            {/* Today's brief — the comp's "AI Briefing", named for what it is. */}
            <div className={card}>
              <div className="mb-3 flex items-center gap-2">
                <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] ${PANEL.brief.badge}`}>
                  {PANEL.brief.icon}
                </span>
                <h2 className={panelTitle}>Today&apos;s brief</h2>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                  {/* FROM THE PAYLOAD, not typed here. s3 requires a derived brief to disclose that it
                      IS derived, when it was calculated and what from -- and a badge hardcoded in one
                      component's JSX is a promise only that component keeps. */}
                  {dash.brief.status}
                </span>
              </div>
              {dash.brief.items.length === 0 ? (
                <p className="text-[12px] text-gray-500">
                  {dash.brief.unavailable
                    ? "Nothing here could be read, so this is not a claim that nothing is waiting."
                    : "Nothing is waiting on you."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {dash.brief.items.slice(0, 4).map(i => (
                    <li key={i.key}>
                      {/* s7: "actionable sentences with SOURCE LINKS". The tooltip carries the rows the
                          sentence was counted from, as stable identifiers -- never names, which s13
                          forbids returning on their own. */}
                      <Link href={i.href}
                        title={`Counted from ${i.count} record${i.count === 1 ? "" : "s"}${i.refsArePartial ? `, ${i.sourceRefs.length} shown` : ""}: ${i.sourceRefs.map(r => `${r.table}/${r.id.slice(0, 8)}`).join(", ")}`}
                        className="flex items-start gap-2 text-[12px] leading-snug text-gray-700 hover:text-[var(--cp-primary)]">
                        <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY[i.severity]?.dot ?? "bg-slate-400"}`} />
                        <span>{i.sentence}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {/* Blind spots NAMED. An empty brief a caller cannot see past is not a calm morning. */}
              {dash.brief.blindSpots.length > 0 && (
                <p className="mt-2 text-[10.5px] leading-snug text-amber-700">
                  Not included, because you do not have access: {dash.brief.blindSpots.join(", ")}.
                </p>
              )}
              {/* THE ONE SENTENCE THAT KEEPS THE PANEL HONEST. The comp badges this "AI · BETA". */}
              {/* THE SENTENCE THAT KEEPS THE PANEL HONEST is now the payload's own `method` plus the time
                  it was calculated and the number of rows behind it -- s3's three disclosures, carried in
                  the data rather than retyped here where they could drift from what was actually done.
                  The comp badges this card "AI · BETA". It is neither. */}
              <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-400">
                {dash.brief.method}{" "}Calculated at{" "}
                {new Date(dash.brief.calculatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: dash.timezone })}
                {dash.brief.sourceRefs.length > 0
                  ? ` from ${dash.brief.sourceRefs.length} record${dash.brief.sourceRefs.length === 1 ? "" : "s"}.`
                  : "."}
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

        {/* ══ CPR-V5-001 ZONES 2, 3 AND 5: RUN YOUR CLINIC · CURRENT ENCOUNTER · SESSION STATUS ══ */}
        <section className="grid gap-4 xl:grid-cols-3">

          {/* ── ZONE 2: THE QUEUE, SPLIT THREE WAYS (s4) ───────────────────────────────────────── */}
          <div className={card}>
            <div className="mb-3 flex items-center gap-2">
              <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[10px] font-bold text-white">2</span>
              <h2 className={panelTitle}>Run your clinic</h2>
              {queue.total !== null && (
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">{queue.total}</span>
              )}
              <Link href="/practice/calendar" className={panelLink}>View all →</Link>
            </div>

            {queue.unavailable ? (
              <p className="text-[12px] text-gray-500">The queue could not be read just now.</p>
            ) : queue.total === 0 ? (
              <p className="text-[12px] text-gray-500">Nobody is waiting.</p>
            ) : (
              <div className="space-y-3">
                {/* A GROUP WITH NOBODY IN IT DOES NOT RENDER. The comp shows three headings because its
                    fixture has all three; an empty "EMERGENCY (0)" every morning trains people to stop
                    reading the word emergency. */}
                {queue.groups.filter(g => g.entries.length > 0).map(g => (
                  <div key={g.key}>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">
                      {g.label} ({g.entries.length})
                    </p>
                    <ul className="space-y-0.5">
                      {g.entries.map(e => (
                        <li key={e.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-gray-50">
                          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            g.key === "emergency" ? "bg-[var(--cmp-text-danger)]"
                              : g.key === "walk_ins" ? "bg-[var(--cmp-text-warning)]" : "bg-[var(--cp-primary)]"}`} />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-800">{e.name}</span>
                          {/* Waiting time is the number that decides who is seen next, so it is the one
                              shown -- not the time they arrived, which the reader would have to subtract. */}
                          <span className="shrink-0 text-[11px] tabular-nums text-gray-500">{e.waitingMinutes} min</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* ── SESSION TIMELINE (s4: "chronological operational events") ────────────────────── */}
            {/* WHAT HAPPENED, NOT WHAT IS PLANNED. The engine returns the two separately, and only
                `events` is drawn here: an activity that never ran would otherwise sit in the timeline
                all afternoon looking as though it had. */}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="mb-1.5 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">Session timeline</p>
                {/* PARTIAL IS ITS OWN STATE. One source failing while others succeed produces a real but
                    incomplete day, and a card that said nothing would be claiming a quiet morning it
                    never actually checked. */}
                {timeline.partial && !timeline.unavailable && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                    Incomplete
                  </span>
                )}
              </div>
              {timeline.unavailable ? (
                <p className="text-[12px] text-gray-500">The day could not be read just now.</p>
              ) : timeline.events.length === 0 ? (
                <p className="text-[12px] text-gray-500">Nothing has happened yet today.</p>
              ) : (
                <ol className="space-y-0.5">
                  {timeline.events.map(e => (
                    <li key={e.id} className="flex items-center gap-2">
                      <span className="w-9 shrink-0 text-[11px] tabular-nums text-gray-500">{e.timeLabel}</span>
                      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        e.interruption ? "bg-red-500" : "bg-emerald-500"}`} />
                      <span className={`min-w-0 flex-1 truncate text-[12px] ${
                        e.interruption ? "font-semibold text-red-700" : "text-gray-800"}`}>
                        {e.label}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          {/* ── ZONE 3: CURRENT ENCOUNTER (s4) ─────────────────────────────────────────────────── */}
          {/* ⚠ THE POINT OF V5: "Encounter is the primary object in the system" (s10). These four are
              the four ways a patient reaches a practitioner -- booked, walked in, an emergency, or
              someone you go looking for -- and all four start the SAME encounter, which is what s9 means
              by "inpatient and outpatient workflows use the same encounter engine". */}
          <div className={card}>
            <div className="mb-3 flex items-center gap-2">
              <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[10px] font-bold text-white">3</span>
              <h2 className={panelTitle}>Current encounter</h2>
              <Link href="/practice/encounters" className={panelLink}>All encounters →</Link>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Each of the four carries the hue of the ROUTE the patient took to get here, matching the
                  comp: booked is the ordinary indigo, a walk-in is the amber this codebase already uses
                  for "waiting" (QUEUE_SWATCH), and an emergency is red wherever it appears. The colour is
                  the fastest part of the button to read, so it should carry the urgency rather than
                  decorate it. */}
              {[
                { href: "/practice/calendar", label: "Booked Patient", icon: "☺", tone: "border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/5 hover:bg-[var(--cp-primary)]/10", icon_tone: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" },
                { href: "/practice/patients?walk_in=1", label: "Walk-in Patient", icon: "⏱", tone: "border-amber-200 bg-amber-50/60 hover:bg-amber-50", icon_tone: "bg-amber-100 text-amber-700" },
                { href: "/practice/patients?emergency=1", label: "Emergency Patient", icon: "✚", tone: "border-red-200 bg-red-50/60 hover:bg-red-50", icon_tone: "bg-red-100 text-red-700" },
                { href: "/practice/search", label: "Search Patient", icon: "⌕", tone: "border-violet-200 bg-violet-50/60 hover:bg-violet-50", icon_tone: "bg-violet-100 text-violet-700" },
              ].map(a => (
                <Link key={a.href} href={a.href}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-center transition-shadow hover:shadow-sm ${a.tone}`}>
                  <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-md text-[12px] ${a.icon_tone}`}>
                    {a.icon}
                  </span>
                  <span className="text-[11px] font-semibold leading-tight text-gray-700">{a.label}</span>
                </Link>
              ))}
            </div>

            {/* DRAFT ENCOUNTERS -- s4 "support draft encounters and continuation". This is what makes
                s10's "supports interruptions without breaking workflow" true rather than aspirational:
                an emergency mid-consultation leaves a draft, and the draft is on the front page. */}
            {drafts === null ? (
              <p className="mt-3 border-t border-gray-100 pt-2.5 text-[11.5px] text-gray-500">
                Draft encounters could not be read just now.
              </p>
            ) : drafts.length > 0 && (
              <div className="mt-3 border-t border-gray-100 pt-2.5">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">
                  Unfinished ({drafts.length})
                </p>
                <ul className="space-y-0.5">
                  {drafts.map(d => (
                    <li key={d.id}>
                      <Link href={`/practice/encounters/${d.id}`}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-gray-50">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-800">{d.patientName}</span>
                        <span className="shrink-0 text-[11px] font-semibold text-[var(--cp-primary)]">Continue →</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ACTIVE FOLLOW-UPS, FIVE LENSES (s6). ⚠ THESE OVERLAP AND ARE NEVER SUMMED -- a scheduled
                investigation result due today is in three of them. Five questions about one list. */}
            <div className="mt-3 border-t border-gray-100 pt-2.5">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">Active follow-ups</p>
              <div className="grid grid-cols-5 gap-1">
                {followUpLenses.map(l => {
                  const s = LENS_SWATCH[l.key] ?? LENS_SWATCH.due_today;
                  return (
                    <Link key={l.key} href={l.href}
                      className={`rounded-lg border px-1 py-1.5 text-center transition-shadow hover:shadow-sm ${s.box}`}>
                      <span className={`block text-[15px] font-bold leading-none tabular-nums ${s.figure}`}>
                        {l.count === null ? "—" : l.count}
                      </span>
                      <span className="mt-0.5 block text-[9px] leading-tight text-gray-600">{l.label}</span>
                    </Link>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[9.5px] leading-relaxed text-gray-400">
                These five overlap and do not add up — one follow-up can be counted in three of them.
              </p>
            </div>
          </div>

          {/* ── ZONE 5: SESSION STATUS + OPERATIONAL ALERTS (s5) ───────────────────────────────── */}
          <div className="flex flex-col gap-4">
            {metrics && (
              <div className={card}>
                <div className="mb-3 flex items-center gap-2">
                  <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[10px] font-bold text-white">5</span>
                  <h2 className={panelTitle}>Session status</h2>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {[
                    ["Session", metrics.activity.label],
                    ["Location", [metrics.activity.facilityName, metrics.activity.room].filter(Boolean).join(" – ") || "Not recorded"],
                    ["Started", new Date(metrics.startedAtIso).toISOString().slice(11, 16)],
                    ["Time remaining", metrics.minutesRemaining === null ? "Past its planned end"
                      : `${Math.floor(metrics.minutesRemaining / 60)}h ${metrics.minutesRemaining % 60}m`],
                    ["Patients seen", metrics.patientsSeen === null ? "—" : String(metrics.patientsSeen)],
                    ["Patients remaining", metrics.patientsRemaining === null ? "—" : String(metrics.patientsRemaining)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[10px] uppercase tracking-wide text-gray-400">{k}</dt>
                      <dd className="truncate text-[12.5px] font-semibold text-gray-900">{v}</dd>
                    </div>
                  ))}
                </dl>
                {/* RUNNING BEHIND IS ABSENT WHEN IT CANNOT BE MEASURED, not shown as zero. It is
                    projected from the average time actually taken so far times the patients actually
                    left -- with no completed encounter there is no average, and a projection built on a
                    default would be the one figure here somebody might change their afternoon over. */}
                {metrics.runningBehindMinutes !== null && (
                  <p className="mt-3 rounded-lg bg-[var(--cmp-surface-warning)] px-2.5 py-2 text-[11.5px] font-semibold text-[var(--cmp-text-warning)]">
                    Running {metrics.runningBehindMinutes} min behind — projected from {metrics.averageMinutesPerPatient} min
                    a patient across {metrics.patientsSeen} seen so far.
                  </p>
                )}
              </div>
            )}

            <div className={card}>
              <div className="mb-3 flex items-center gap-2">
                <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[10px] font-bold text-white">4</span>
                <h2 className={panelTitle}>Operational alerts</h2>
              </div>
              {alerts.unavailable ? (
                <p className="text-[12px] text-gray-500">Alerts could not be read just now.</p>
              ) : alerts.alerts.length === 0 ? (
                <p className="text-[12px] text-gray-500">Nothing is waiting on you.</p>
              ) : (
                <ul className="space-y-1.5">
                  {alerts.alerts.map(a => (
                    <li key={a.key}>
                      <Link href={a.href} className="flex items-start gap-2 text-[12px] leading-snug text-gray-700 hover:text-[var(--cp-primary)]">
                        <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          a.tone === "danger" ? "bg-[var(--cmp-text-danger)]"
                            : a.tone === "warning" ? "bg-[var(--cmp-text-warning)]" : "bg-[var(--cp-primary)]"}`} />
                        <span>{a.text}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {/* A COUNT OF NOUGHT DOES NOT RENDER AN ALERT AT ALL. Four standing reassurances would
                  make this card wallpaper, and the one real alert would be missed inside it. */}
            </div>
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
            {performance.length === 0 ? (
              <p className="col-span-full text-[12px] text-gray-500">
                Today&rsquo;s figures could not be read just now.
              </p>
            ) : performance.map(p => (
              <div key={p.key} className="rounded-lg bg-[var(--cp-canvas)] px-3 py-2.5"
                title={p.value === null ? (p.reason ?? "") : `${p.formula} Source: ${p.sources.join(", ")}.`}>
                {p.value !== null ? (
                  <>
                    <p className={`text-[22px] font-bold leading-none ${PERFORMANCE_SWATCH[p.key] ?? "text-gray-900"}`}>
                      {p.value}{p.unit === "minutes" ? <span className="ml-0.5 text-[12px] font-semibold opacity-70">min</span> : null}
                    </p>
                    <p className="mt-1 text-[11px] leading-tight text-gray-600">{p.label}</p>
                    {/* NO AVERAGE WITHOUT ITS DENOMINATOR. "18 min" over three consultations is not a
                        measurement, and the comp shows four such figures with no n at all. Anything
                        DROPPED by a documented exclusion is disclosed too -- a mean over eight of
                        twenty is a different claim from a mean over eight. */}
                    {p.observations !== null && (
                      <p className="text-[9px] leading-tight text-gray-400">
                        over {p.observations} {p.observations === 1 ? "measurement" : "measurements"}
                        {p.excluded > 0 ? `, ${p.excluded} excluded` : ""}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[22px] font-bold leading-none text-gray-300">—</p>
                    <p className="mt-1 text-[11px] leading-tight text-gray-500">{p.label}</p>
                    {/* Three different reasons behind one em dash: could not read, not permitted, or
                        not yet knowable. The card says which. */}
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

        {/* The offline copy, a BY-PRODUCT of this successful render. Silent here: the command centre has
            fourteen widgets already, and /practice/today carries the status line. */}
        <OfflineCacheWriter
          workspaceId={ctx.workspaceId}
          gate={{ state: offline.state, reason: offline.reason, purge: offline.purge }}
          nav={primaryNav(ctx.capabilities).map(i => ({ href: i.href, label: i.label, icon: i.icon }))}
        />
      </div>
    </div>
  );
}
