import { redirect } from "next/navigation";
import { primaryNav } from "@/lib/practice/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { dashboardReadModel } from "@/lib/practice/dashboard";
import { formatMinuteOfDay, formatDate } from "@/lib/datetime";
import SessionControls from "./SessionControls";
import SessionTiles from "./SessionTiles";
import SessionSummaryCard from "./SessionSummaryCard";
import QueueWithActions from "./QueueWithActions";
import LiveRefresh from "../LiveRefresh";
import OfflineCacheWriter from "../OfflineCacheWriter";
import { offlineCacheGate } from "@/lib/practice/offline-gate";

// /practice/today -- CPR-V5-004 "Current Session", the practitioner's live operational cockpit.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// IT ASSEMBLES NOTHING. Every figure arrives from `dashboardReadModel` -- the same payload
// /api/v1/practice/dashboard serves and the same one the command centre renders -- so the two screens
// cannot disagree about how many people are waiting. CORE-001 s16: "no widget independently calculates a
// conflicting version of a shared metric." This page's whole job is choosing which of those figures the
// session cockpit shows, and in what order.
//
// ⚠ EVERY NUMBER IS A PAIR OR A NULL, NEVER A PERCENTAGE. The comp prints "On-time Rate 62%",
// "Utilisation 78%" and four "Goal:" lines. The cards below cannot render any of them: their props take
// `value` and `of` separately, `unit` admits only "count" | "minutes", and no `goal` prop exists. 62% of
// eight patients is not a rate, it is five people -- and a goal nothing stores is an invented standard
// presented as the practice's own.
//
// ⚠ TWO FIGURES FROM THE COMP ARE ABSENT ON PURPOSE. Utilisation has no denominator anywhere -- nothing
// links an activity to a slot capacity -- and on-time has no metric and no stored lateness tolerance.
// Inventing the tolerance would be authoring the very standard the figure claims to measure against.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

/** hh:mm in the practice's own zone. The session clock is the practitioner's, never the server's. */
const clock = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });

export default async function CurrentSessionPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "practice.home.view")) redirect("/practice/home");

  const admin = createAdminClient();
  // ⚠ THE OFFLINE GATE IS RESOLVED ON THE SERVER, BESIDE THE DASHBOARD, AND HANDED DOWN AS PLAIN JSON.
  // CP-OFFLINE-SURVEY-001 s3.7: "the flag resolved server-side and passed into the client component as a
  // prop -- do not build a client evaluator." In parallel because it is a gate on a by-product; a screen
  // that waited for it serially would pay for a feature nobody is looking at.
  const [dash, offline] = await Promise.all([
    dashboardReadModel(admin, shell.ctx),
    offlineCacheGate(admin, shell.ctx, shell.ctx.userId),
  ]);
  const { plan, session, queue, timeline, brief, metrics } = dash;
  const canControl = hasCapability(shell.ctx, "appointment.manage");

  // The lifecycle state, derived from the two timestamps and the pause ledger -- never stored.
  const state: "NOT_STARTED" | "RUNNING" | "PAUSED" =
    !session ? "NOT_STARTED" : session.isPaused ? "PAUSED" : "RUNNING";

  const m = metrics?.metrics;
  /** A metric becomes a tile. `of` stays null unless the pair is genuinely known. */
  const tile = (key: keyof NonNullable<typeof m>, label: string, href: string | null) => {
    const x = m?.[key];
    return {
      key: String(key), label, href,
      value: x?.value ?? null,
      of: null as number | null,
      unit: (x?.unit ?? "count") as "count" | "minutes",
      reason: x?.reason ?? (m ? null : "Today's figures could not be read."),
      observations: x?.observations ?? null,
      basis: x?.formula ?? null,
    };
  };

  return (
    <div className="max-w-6xl">
      {/* ── ZONE 1: THE SESSION HEADER AND ITS CONTROLS ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Current Session</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {formatDate(plan.date)} · {dash.scope.kind === "session"
              ? "figures below count this session, not the whole day"
              : "nothing is running — day figures live on the Command Centre, not here (s5.2)"}
          </p>
        </div>
        <LiveRefresh asOf={dash.asOf} timezone={dash.timezone} />
      </div>

      {plan.unavailable && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          Today&rsquo;s plan could not be read just now. Nothing below is a claim that your day is empty —
          it is a claim that this page could not find out.
        </p>
      )}

      <div className="mt-4">
        {session ? (
          <SessionControls
            activityId={session.activity.id}
            header={{
              title: session.activity.title,
              activityLabel: session.activity.label,
              facilityName: session.activity.facilityName,
              room: session.activity.room,
              state,
              startedAtLabel: clock(session.startedAtIso, dash.timezone),
              plannedWindowLabel:
                `${formatMinuteOfDay(session.activity.plannedStartMinute)} – ${formatMinuteOfDay(session.activity.plannedEndMinute)}`,
              elapsedMinutes: session.minutesElapsed,
              // ⚠ THE ELAPSED FIGURE IS ONLY TRUSTWORTHY IF THE PAUSE LEDGER WAS READ. When it was not,
              // `pausedMinutes` is null and this clock has NOT had interruptions taken out of it -- so
              // the header says so rather than showing a number it cannot stand behind.
              elapsedReason: session.pausedMinutes === null
                ? "The pause ledger could not be read, so this is the raw clock and may overstate the session."
                : null,
              pausedMinutes: session.pausedMinutes,
              pausedReason: session.pausedMinutes === null ? "Could not be read." : null,
              pauseCount: null,
              overrunMinutes: session.activity.overrunMinutes,
              canControl,
            }}
          />
        ) : (
          /* ── CPR-HFE-001 v1.1 s5.2: THE NO-ACTIVE-SESSION STATE. No zero grids, no day-scoped
                figures wearing session clothes -- a simple statement, the next planned activity where
                one exists, and the two routes onward. Everything session-scoped below renders ONLY
                when a session exists, because fabricating session metrics from whole-day activity is
                exactly what s5.2 forbids. ─────────────────────────────────────────────────────── */
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">No active session</h2>
            {(() => {
              // ⚠ THIS PREDICATE USED TO READ `startedAtIso`/`endedAtIso` -- fields PlannedActivity has
              // NEVER carried (they are startedAt/endedAt), behind an `(a: any)` that hid it. Both reads
              // were always undefined, the predicate was always TRUE, and this card named the day's
              // FIRST activity as "next planned" even when it was already running or finished. The
              // IntelSlice phantom-field class again, found 2026-08-16 by removing the `any` for the CI
              // lint gate. `state` is the engine's own derivation of exactly this question.
              const next = plan.activities.find(a => a.state === "planned") ?? null;
              return next ? (
                <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Next planned</p>
                  <p className="mt-0.5 text-[13px] font-semibold text-gray-900">{next.title ?? next.label}</p>
                  <p className="text-[11px] text-gray-500">
                    {formatMinuteOfDay(next.plannedStartMinute)} – {formatMinuteOfDay(next.plannedEndMinute)}
                    {next.facilityName ? ` · ${next.facilityName}` : ""}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">
                  Nothing further is planned for today.
                </p>
              );
            })()}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/practice/home"
                className="rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:opacity-90">
                Start from the Command Centre →
              </Link>
              <Link href="/practice/calendar"
                className="rounded-lg border border-gray-200 px-3.5 py-2 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50">
                Open Planner
              </Link>
            </div>
          </section>
        )}
      </div>


      {/* s5.1: everything below is the RUNNING session's cockpit, and renders only when one
          exists -- the six tiles, the queue, the summary and the session activity log. */}
      {session && (<>
      {/* ── THE SIX TILES ─────────────────────────────────────────────────────────────────────── */}
      <div className="mt-4">
        <SessionTiles
          scopeLabel={dash.scope.kind === "session" ? "This session" : "Today"}
          unavailableReason={dash.feeders.glance === "unavailable"
            ? "Today's figures could not be read just now, so no number is shown rather than a nought." : null}
          tiles={[
            tile("booked", "Booked", "/practice/calendar"),
            // Seen is a PAIR -- four of twelve, never "33%". The denominator is what makes it mean anything.
            { ...tile("completed", "Seen", "/practice/encounters"), of: m?.booked.value ?? null },
            tile("waiting", "Waiting", "/practice/calendar"),
            tile("walk_in", "Walk-ins", "/practice/calendar"),
            tile("emergency", "Emergency", "/practice/calendar"),
            {
              key: "time_remaining", label: "Time remaining", href: null,
              value: session?.minutesRemaining ?? null, of: null, unit: "minutes" as const,
              reason: !session ? "No session is running."
                : session.minutesRemaining === null ? "Past its planned end." : null,
              observations: null,
              basis: "The planned end, pushed out by any time the session was paused.",
            },
          ]}
        />
      </div>

      {/* ── RUN YOUR CLINIC: the queue, and the session's own summary ─────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* CPR-ADOPT-001 s2. The client wrapper supplies the handlers a server component cannot --
            see QueueWithActions for why the card's action props were never once drawn before this. */}
        <QueueWithActions
          href="/practice/calendar"
          unavailableReason={queue.unavailable ? "The queue could not be read just now." : null}
          truncatedNotice={queue.capped
            ? `Showing the first ${queue.groups.reduce((n, g) => n + g.entries.length, 0)} of ${queue.total} waiting.`
              + " The tab counts below are of what is shown here. This is not the whole queue."
            : null}
          canCapture={hasCapability(shell.ctx, "encounter.edit")}
          people={queue.groups.flatMap(g => g.entries.map(e => ({
            id: e.id,
            name: e.name,
            group: g.key as "booked" | "walk_ins" | "emergency",
            status: e.status,
            waitingMinutes: e.waitingMinutes,
            waitingReason: null,
            timeLabel: e.timeLabel,
            href: null,
            patientId: e.patientId,
          })))}
        />

        <SessionSummaryCard
          unavailableReason={metrics ? null : "The session's figures could not be read just now."}
          // The brief's own sentences, unchanged. This page writes none of its own, which is how s7's
          // "no unsupported prediction" is kept: there is nothing here capable of predicting.
          notes={brief.items.slice(0, 4).map(i => ({
            key: i.key, sentence: i.sentence, severity: i.severity, href: i.href,
            count: i.count,
            sourceLabel: i.sourceRefs.length > 0
              ? `${i.sourceRefs.length} record${i.sourceRefs.length === 1 ? "" : "s"}` : null,
          }))}
          notesMethod={brief.method}
          notesUnavailableReason={brief.unavailable
            ? "The brief could not be read, so this is not a claim that nothing is waiting." : null}
          figures={[
            {
              key: "patients_seen", label: "Patients seen", href: "/practice/encounters",
              value: m?.patients_seen.value ?? null, of: m?.booked.value ?? null,
              unit: "count" as const, reason: m?.patients_seen.reason ?? null,
              observations: m?.patients_seen.observations ?? null,
              excluded: m?.patients_seen.excluded ?? null,
            },
            {
              key: "average_consult_time", label: "Average consult time", href: null,
              value: m?.average_consult_time.value ?? null, of: null, unit: "minutes" as const,
              reason: m?.average_consult_time.reason ?? null,
              observations: m?.average_consult_time.observations ?? null,
              excluded: m?.average_consult_time.excluded ?? null,
            },
            {
              key: "paused", label: "Time paused", href: null,
              value: session?.pausedMinutes ?? null, of: null, unit: "minutes" as const,
              reason: !session ? "No session is running."
                : session.pausedMinutes === null ? "The pause ledger could not be read." : null,
              observations: null, excluded: null,
            },
          ]}
        />
      </div>

      {/* ── TODAY'S TIMELINE ──────────────────────────────────────────────────────────────────── */}
      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="tl-h">
        <div className="mb-2 flex items-center gap-2">
          <h2 id="tl-h" className="text-[13px] font-bold text-gray-900">Today&rsquo;s timeline</h2>
          {/* PARTIAL IS ITS OWN STATE. One source failing while others succeed is a real but incomplete
              day, and a card that said nothing would claim a quiet morning it never checked. */}
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
              <li key={e.id} className="flex items-center gap-2.5">
                <span className="w-10 shrink-0 text-[11px] tabular-nums text-gray-500">{e.timeLabel}</span>
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  e.interruption ? "bg-red-500" : "bg-emerald-500"}`} />
                <span className={`min-w-0 flex-1 truncate text-[12px] ${
                  e.interruption ? "font-semibold text-red-700" : "text-gray-800"}`}>
                  {e.label}{e.detail ? ` · ${e.detail}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      </>)}
      {/* s5.3: the "How this session ran" performance summary left the LIVE state -- its
          figures belong to Session Complete and the governed reports, where the session is
          finished enough to be summarised. */}

      <p className="mt-4 text-[10.5px] text-gray-400">
        As of {clock(dash.asOf, dash.timezone)} · {dash.timezone}. Every figure above is the same one the
        command centre shows, read once and shared, so the two screens cannot disagree.
      </p>

      {/* The offline copy, written as a BY-PRODUCT of this successful render. Nothing above waits for it,
          and its one line of status says what is held and when it goes. */}
      <OfflineCacheWriter
        workspaceId={shell.ctx.workspaceId}
        userId={shell.ctx.userId}
        gate={{ state: offline.state, reason: offline.reason, purge: offline.purge }}
        nav={primaryNav(shell.ctx.capabilities).map(i => ({ href: i.href, label: i.label, icon: i.icon }))}
        showStatus
      />
    </div>
  );
}
