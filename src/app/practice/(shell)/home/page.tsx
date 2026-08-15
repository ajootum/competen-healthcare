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
import { PANEL, GLANCE_SWATCH, QUICK_SWATCH, QUICK_ICON, SEVERITY } from "@/lib/practice/palette";

// PRACTICE COMMAND CENTRE -- CPR-001_v4, SIMPLIFIED BY CPR-HFE-001 v1.1 s4 (2026-08-15).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// TODAY IS DAY ORIENTATION, NOT THE LIVE CLINIC AND NOT A DASHBOARD. s4.1's five zones and nothing
// else: current activity (StartYourDay), today's plan in time order, needs-attention (cross-day
// obligations only), what's next, and the planner handoff. Everything the v4 comp put here that
// OPERATES the clinic or ANALYSES the practice moved to its canonical home (s4.2/s10):
//
//   detailed waiting queue, encounter launcher, session status, live session timeline and
//   session-operational alerts -> CURRENT SESSION · patient insights, practice performance ->
//   PRACTICE INTELLIGENCE · weekly locations -> PLANNER · recent documents -> DOCUMENTS ·
//   follow-up detail -> FOLLOW-UPS · recent patients -> PATIENTS.
//
// What remains may show a COUNT THAT ROUTES ("3 waiting -> Current Session") and never a second
// console -- s10's summary-pointer rule, stated on each card. Empty Tasks/Messages cards are HIDDEN
// (s4.2): they render only as actionable exceptions, because a standing "nothing new" card trains
// the eye to skip the one day it says something else.
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
  // followUps/alerts/timeline stay in the PAYLOAD (Current Session reads the same read model);
  // this page stopped rendering them under HFE-001 s4.2 -- their canonical homes have them.
  const { plan, session: metrics, glance, queue, drafts } = dash;
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
  // The four "Practice performance (today)" figures LEFT this page (HFE-001 s4.2: performance and
  // longitudinal metrics belong to Practice Intelligence; the session's own operational figures
  // belong to Session Complete). The metrics still ride the payload for the surfaces that own them.

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

          {/* ── Planner handoff (s4.1) -- the large weekly locations panel moved to the Planner
                 (s4.2), its canonical home. What stays is the ROUTE there, with today's shape. ── */}
          <div className={card} style={widget("locations")}>
            <PanelHead k="locations" title="Planner" href="/practice/calendar" hrefLabel="Open Planner" />
            <p className="text-[12px] leading-relaxed text-gray-700">
              Schedule changes, the week&apos;s locations, availability and booking all live in the
              Practice Planner.
            </p>
            <Link href="/practice/calendar"
              className="mt-2 block rounded-lg border border-dashed border-[var(--cp-primary)]/40 py-2 text-center text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/5">
              Open Planner &rarr;
            </Link>
            <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
              The weekly locations panel lives there now &mdash; one canonical home per information
              type (CPR-HFE-001 s10), and a pointer here instead of a copy.
            </p>
          </div>
        </section>

        {/* ══ CPR-HFE-001 v1.1 s4: POINTERS, NOT CONSOLES ═════════════════════════════════════════
            The detailed waiting queue, the encounter launcher, the session status panel, the live
            session timeline and the session-operational alerts ALL moved to Current Session -- their
            canonical home (s4.2). What stays here is s10's allowed form: a count that ROUTES. The
            zone cards below are day orientation and cross-day obligations only (s13). ═══════════ */}
        <section className="grid gap-4 lg:grid-cols-3">
          {/* ── Live clinic pointer ──────────────────────────────────────────────────────────────── */}
          <div className={card}>
            <PanelHead k="queue" title="Live clinic" href="/practice/today" hrefLabel="Open Current Session" />
            <Link href="/practice/today"
              className="flex items-baseline gap-2 rounded-lg border border-gray-100 px-3 py-2 text-[12.5px] hover:bg-gray-50">
              <span className="text-gray-800">
                {queue.unavailable ? "The queue could not be read just now"
                  : queue.total === 0 ? "Nobody is waiting" : `${queue.total} waiting`}
              </span>
              <span className="ml-auto font-semibold text-[var(--cp-primary-deep)]">Queue &rarr;</span>
            </Link>
            {metrics && (
              <p className="mt-2 text-[12px] text-gray-700">
                <span className="font-semibold">{metrics.activity.label}</span> is running
                {metrics.activity.facilityName ? ` at ${metrics.activity.facilityName}` : ""} &mdash;
                its progress, queue and controls live on Current Session.
              </p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
              One cockpit: starting, pausing and finishing consultations happens in Current Session.
              This card only says whether anyone is waiting, and routes there.
            </p>
          </div>

          {/* ── Unfinished encounters -- a cross-day obligation, so it stays (s4.1 Needs attention) ── */}
          <div className={card}>
            <PanelHead k="timeline" title="Unfinished encounters" href="/practice/encounters" hrefLabel="All encounters" />
            {drafts === null ? (
              <p className="text-[12px] text-gray-500">Draft encounters could not be read just now.</p>
            ) : drafts.length === 0 ? (
              <p className="text-[12px] text-gray-500">Nothing is left open.</p>
            ) : (
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
            )}
          </div>

          {/* ── Needs attention -- s4.1: ONLY cross-session/day obligations (operations-home's
                 attention list). The session-operational alerts moved to Current Session. ───────── */}
          <div className={card} style={widget("alerts")}>
            <PanelHead k="alerts" title="Needs attention" />
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
            {home.blindSpots.length > 0 && (
              <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-500">
                Not shown to you: {home.blindSpots.join(", ")}. This list cannot tell you whether anything
                is waiting there.
              </p>
            )}
          </div>
        </section>

        {/* ── s4.1: Today's plan in time order · Planner handoff via Quick access · exceptions ──── */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className={card} style={widget("schedule")}>
            <PanelHead k="timeline" title="Today's plan" href="/practice/calendar" hrefLabel="Open Planner" />
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
            <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] text-gray-400">
              Schedule changes and the wider week live in the Planner (s4.1 planner handoff).
            </p>
          </div>

          <div className={card} style={widget("quick_actions")}>
            <PanelHead k="quick" title="Quick access" />
            {cc.quickAccess.length === 0 ? (
              <p className="text-[12px] text-gray-400">No action here is available to you.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
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

          {/* ── s4.2: EMPTY TASKS/MESSAGES CARDS ARE HIDDEN -- they render only as actionable
                 exceptions. A standing "Nothing new" card trains the eye to skip the one day it
                 says something else. ─────────────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            {home.attention.find((a: any) => a.kind === "task_due") && (
              <div className={card} style={widget("tasks")}>
                <PanelHead k="tasks" title="Tasks for today" href="/practice/tasks" hrefLabel="Go to tasks" />
                <ul className="space-y-1.5">
                  {(home.attention.find((a: any) => a.kind === "task_due")?.sample ?? []).map((t: any, i: number) => (
                    <li key={i} className="flex items-baseline gap-2 text-[12px]">
                      <span aria-hidden className="text-cyan-400">☐</span>
                      <span className="min-w-0 flex-1 truncate text-gray-800">{t.label ?? t.title ?? String(t)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(home.attention.find((a: any) => a.kind === "message_unread")
              || home.attention.find((a: any) => a.kind === "incoming_unreviewed")) && (
              <div className={card} style={widget("messages")}>
                <PanelHead k="messages" title="Messages" href="/practice/messages" hrefLabel="Go to inbox" />
                <ul className="space-y-2">
                  {[home.attention.find((a: any) => a.kind === "message_unread"),
                    home.attention.find((a: any) => a.kind === "incoming_unreviewed")].filter(Boolean).map((a: any) => (
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
              </div>
            )}
          </div>
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
          userId={ctx.userId}
          gate={{ state: offline.state, reason: offline.reason, purge: offline.purge }}
          nav={primaryNav(ctx.capabilities).map(i => ({ href: i.href, label: i.label, icon: i.icon }))}
        />
      </div>
    </div>
  );
}
