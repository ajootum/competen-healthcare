import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { encountersDashboard, type DashboardEncounter, type DashboardSession } from "@/lib/practice/encounter-workspace";
import {
  SESSION_FIGURES, DASHBOARD_PANELS, ENCOUNTER_STATUS_CHIP, ENCOUNTER_STATUS_LABEL,
} from "@/lib/practice/encounter-workspace-constants";
import { formatMinuteOfDay, formatTime, formatDate } from "@/lib/datetime";
import RowMenu from "./RowMenu";
import StartEncounter from "./StartEncounter";

// /practice/encounters -- CPR-ENC-001 s9's four panels: Today's Sessions, Open Encounters, Recently
// Closed, and the attention counts the comp draws as an assistant.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// EVERY PANEL DRAWS THREE STATES, AND THE THIRD ONE IS THE POINT.
//
//   not permitted    "You cannot see X here."           -- nothing was read
//   could not read   "X could not be read."             -- a query failed; this is NOT an empty list
//   empty            "There is no X."                   -- read succeeded, there is genuinely none
//
// An empty Open Encounters panel means the day is finished. A failed one means there may be an unsigned
// consultation from this morning that this screen cannot see. Drawing them the same way is how a
// practitioner goes home with a record still open.
//
// COLOUR IS DOING SEMANTIC WORK, AND THE FIGURE TAKES THE CARD'S COLOUR. The four session figures are
// read at a glance at the start of a clinic; four grey rectangles containing four numbers have to be
// READ, one at a time. The swatches come from palette.ts through encounter-workspace-constants so the
// hue of "walk-in" is the same here as it is on the command centre.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const CARD = "rounded-xl border border-gray-200 bg-white";

/**
 * How many signed records "View all" reaches for, against the twelve the panel shows by default.
 *
 * ⚠ IT IS A CAP, NOT "ALL", AND THE PANEL SAYS SO WHEN IT IS REACHED. A link labelled "View all" over a
 * silently truncated list is the worst of both: the practitioner believes they have seen everything.
 * A practice with more than this many signed encounters needs the patient record or the register, not a
 * longer scroll on a dashboard panel.
 */
const CLOSED_ALL_LIMIT = 100;

function PanelHeading({ panel, title, subtitle, action }: {
  panel: string; title: string; subtitle?: string; action?: React.ReactNode;
}) {
  const badge = DASHBOARD_PANELS[panel];
  return (
    <div className="flex items-start gap-2.5">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] ${badge.badge}`}>
        {badge.icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-[14px] font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

/** The one place any of the three states is rendered, so no panel can invent a fourth. */
function PanelState({ permitted, unavailable, empty, what }: {
  permitted: boolean; unavailable: boolean; empty: string; what: string;
}) {
  if (!permitted) {
    return (
      <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-500">
        You do not hold the permission to see {what} in this workspace. Nothing was read.
      </p>
    );
  }
  if (unavailable) {
    return (
      <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
        <strong>{what} could not be read.</strong> This is not an empty list &mdash; do not take it as one.
      </p>
    );
  }
  return <p className="mt-3 text-[12px] text-gray-400">{empty}</p>;
}

function patientLabel(e: DashboardEncounter) {
  // ⚠ "Unknown patient" IS A CLAIM ABOUT THE RECORD. When the name read failed, the name is unknown to
  // this screen, not missing from the record, and the two sentences are different.
  if (e.patientNameUnavailable) return "Name could not be read";
  return e.patientName ?? "Unnamed record";
}

function SessionCard({ s, active }: { s: DashboardSession; active: boolean }) {
  const stateChip = s.state === "running"
    ? "bg-violet-100 text-violet-700 ring-1 ring-violet-200"
    : s.state === "done"
      ? "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
      : "bg-sky-100 text-sky-700 ring-1 ring-sky-200";
  const stateWord = s.state === "running" ? "In progress" : s.state === "done" ? "Finished" : "Upcoming";

  return (
    <li className={`${CARD} p-3.5`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-gray-900">{s.title}</p>
          <p className="text-[11px] text-gray-500">
            {formatMinuteOfDay(s.plannedStartMinute)}&ndash;{formatMinuteOfDay(s.plannedEndMinute)}
            {" · "}{s.activityType}
            {s.facility ? ` · ${s.facility}` : ""}
            {s.room ? ` · ${s.room}` : ""}
          </p>
        </div>
        <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${stateChip}`}>{stateWord}</span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {SESSION_FIGURES.map(f => {
          const v = s.figures[f.key];
          return (
            <div key={f.key} className={`rounded-lg border px-2 py-1.5 text-center ${v === null ? "border-dashed border-slate-300 bg-white" : f.swatch.box}`}>
              {/* ⚠ A FIGURE THAT COULD NOT BE COUNTED IS AN EM DASH, NEVER A NOUGHT. A nought is a claim
                  that there were none of them. */}
              <p className={`text-[17px] font-bold leading-none ${v === null ? "text-slate-300" : f.swatch.figure}`}>
                {v === null ? "—" : String(v).padStart(2, "0")}
              </p>
              <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">{f.label}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[10px] text-gray-400">
        Counted from the encounters filed against this session, not from the diary &mdash; nobody is
        claimed to have arrived who has not.
      </p>

      {/* ⚠ ONE ACTION, AND IT IS NAMED FOR WHAT IT DOES. The comp gives each card a different verb --
          "View patients", "Start round", "Open queue" -- chosen by the kind of session. Two of those
          three describe STARTING something, and nothing here starts a session: an encounter is opened
          from a patient or a checked-in appointment, and a button that only navigated while saying
          "Start round" would be the screen making a claim the click does not honour. So all three become
          the one they all actually were, and it filters the lists below to this session's own records. */}
      <Link href={active ? "/practice/encounters" : `/practice/encounters?session=${s.id}`}
        aria-pressed={active}
        className={`mt-2.5 block rounded-lg border px-2 py-1.5 text-center text-[11px] font-semibold ${
          active
            ? "border-[var(--cp-primary)]/40 bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
            : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
        {active ? "Showing this session — clear" : "View patients"}
      </Link>
    </li>
  );
}

export default async function EncountersPage({ searchParams }: {
  searchParams: Promise<{ session?: string; closed?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "encounter.list")) redirect("/practice/home");

  // ⚠ BOTH OF THESE NARROW OR WIDEN WHAT IS ON SCREEN, so both are in the URL rather than in component
  // state: a practitioner who has filtered to one session and then follows a link into an encounter must
  // come back to the same list, and a filtered view somebody is reading over a colleague's shoulder has
  // to be a link they can be sent.
  const { session: sessionParam, closed: closedParam } = await searchParams;
  const sessionFilter = sessionParam || null;
  const showAllClosed = closedParam === "all";

  const admin = createAdminClient();
  // THE CLOCK IS THE ENGINE'S, not this component's. Calling Date.now() during a render is an impure
  // call the React compiler rejects outright, and the elapsed time of a consultation is data the loader
  // owns -- so encountersDashboard measures it once and hands each row its own `elapsedMinutes`.
  const dash = await encountersDashboard(admin, shell.ctx, showAllClosed ? { closedLimit: CLOSED_ALL_LIMIT } : {});

  // ⚠ THE FILTER IS APPLIED HERE AND NOT IN THE ENGINE, and that has a consequence worth naming rather
  // than hiding: the loader reads a bounded window, so filtering it to one session shows that session's
  // records WITHIN THAT WINDOW, not every record it ever had. The panels below say so when a filter is
  // on. Pushing the filter into the query would fix the bound and cost a second read path for the same
  // figures -- the thing the card/list agreement on this page exists to prevent.
  const inFilter = (e: DashboardEncounter) => !sessionFilter || e.activityId === sessionFilter;
  const live = dash.open.items.filter(e => e.status !== "COMPLETED" && inFilter(e));
  const completedUnsigned = dash.open.items.filter(e => e.status === "COMPLETED" && inFilter(e));
  const closedItems = dash.closed.items.filter(inFilter);

  // The session's own words if it is one of today's; otherwise whatever an encounter calls it. Never an
  // id: "Showing 8f3c-…" tells a practitioner nothing about what they are looking at.
  const filterName = sessionFilter
    ? dash.sessions.items.find(s => s.id === sessionFilter)?.title
      ?? dash.open.items.concat(dash.closed.items).find(e => e.activityId === sessionFilter)?.sessionTitle
      ?? null
    : null;
  const closedCapped = showAllClosed && dash.closed.items.length >= CLOSED_ALL_LIMIT;

  // Read once here rather than per row: the row menu offers the patient record, and a link that 403s on
  // arrival is worse than a line that says it cannot be followed.
  const canSeePatient = hasCapability(shell.ctx, "patient.list");
  // ⚠ COMPUTED HERE, ON THE SERVER, FROM THE CAPABILITY TABLE -- never inferred in the browser
  // (SHELL-001 s9.1). The picker hides its register branch on the second of these; the API refuses it
  // again on arrival, which is what makes the hiding a courtesy rather than the control.
  const canStartEncounter = hasCapability(shell.ctx, "encounter.create");
  const canRegisterPatient = hasCapability(shell.ctx, "patient.create");

  const row = (e: DashboardEncounter) => {
    const mins = e.elapsedMinutes;
    return (
      <li key={e.id} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50">
        <div className="col-span-12 min-w-0 sm:col-span-3">
          <Link href={`/practice/encounters/${e.id}`} className="text-[13px] font-semibold text-gray-900 hover:underline">
            {patientLabel(e)}
          </Link>
          {e.reasonForVisit && <p className="truncate text-[11px] text-gray-500">{e.reasonForVisit}</p>}
        </div>
        <p className="col-span-4 text-[11px] capitalize text-gray-600 sm:col-span-2">
          {String(e.entryPathway).replace(/_/g, " ")}
        </p>
        <p className="col-span-8 truncate text-[11px] text-gray-500 sm:col-span-3">
          {e.sessionTitle ?? <span className="text-gray-400">No session recorded</span>}
          <span className="text-gray-400"> · {String(e.encounterMode).replace(/_/g, " ")}</span>
        </p>
        <p className="col-span-4 font-mono text-[11px] text-gray-500 sm:col-span-1">{formatTime(e.startedAt)}</p>
        <p className="col-span-4 font-mono text-[11px] text-gray-400 sm:col-span-1">
          {mins === null ? "—" : `${mins}m`}
        </p>
        <div className="col-span-4 flex items-center justify-end gap-2 sm:col-span-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ENCOUNTER_STATUS_CHIP[e.status] ?? "bg-gray-100 text-gray-500"}`}>
            {ENCOUNTER_STATUS_LABEL[e.status] ?? e.status}
          </span>
          <Link href={`/practice/encounters/${e.id}`}
            className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-white">
            Continue
          </Link>
          <RowMenu encounterId={e.id} patientId={e.patientId} activityId={e.activityId}
            sessionTitle={e.sessionTitle} canSeePatient={canSeePatient} />
        </div>
      </li>
    );
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Encounters</h1>
          <p className="text-[13px] text-gray-500">Your patient encounters today and recently.</p>
        </div>
        {/* ⚠ THIS WAS A LINK TO /practice/patients, AND THAT IS THE DEFECT THE OWNER FOUND WALKING THE
            PRODUCT: "Start encounter takes me to patient section". The press started nothing. It
            changed the page to a register that did not know why anybody had arrived, whose own
            equivalent action lives in a panel that appears only after a patient is selected. An
            encounter genuinely needs a patient -- so the button asks for one HERE, over this board,
            and the next screen after choosing is the consultation itself. */}
        <StartEncounter canStart={canStartEncounter} canRegisterPatient={canRegisterPatient} />
      </div>

      {/* ⚠ A FILTERED LIST SAYS SO, LOUDLY AND WITH A WAY OUT. A narrowed board that looks like the whole
          board is how somebody goes home believing nothing is open. */}
      {sessionFilter && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/5 px-3 py-2">
          <span className="text-[12px] text-gray-800">
            Showing only <strong>{filterName ?? "one session"}</strong>. Everything below is this
            session&rsquo;s records &mdash; it is not the whole day.
          </span>
          <Link href="/practice/encounters"
            className="ml-auto rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
            Clear filter
          </Link>
        </div>
      )}

      {/* ── Today's sessions ───────────────────────────────────────────────────────────────────── */}
      <section className="mt-5">
        <PanelHeading panel="sessions" title="Today's sessions"
          subtitle={`${formatDate(`${dash.today}T00:00:00Z`, "UTC")} · ${dash.timezone}`}
          action={<Link href="/practice/calendar" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">View calendar</Link>} />
        {dash.sessions.items.length === 0 ? (
          <PanelState permitted={dash.sessions.permitted} unavailable={dash.sessions.unavailable}
            what="today's sessions" empty="Nothing is planned for today. Encounters can still be opened without a session." />
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-3">
            {dash.sessions.items.map(s => <SessionCard key={s.id} s={s} active={s.id === sessionFilter} />)}
          </ul>
        )}
      </section>

      {/* ── Open encounters ────────────────────────────────────────────────────────────────────── */}
      <section className={`mt-5 ${CARD} p-4`}>
        <PanelHeading panel="open" title={`Open encounters${dash.open.unavailable || !dash.open.permitted ? "" : ` (${live.length})`}`}
          subtitle="Started and not finished. These are the records that still need you." />
        {live.length === 0 ? (
          <PanelState permitted={dash.open.permitted} unavailable={dash.open.unavailable}
            what="open encounters"
            empty={sessionFilter
              // ⚠ TWO DIFFERENT SENTENCES. "This session has nothing open" and "nothing is open" are not
              // the same fact, and only the second one means the practitioner is finished.
              ? "Nothing is open for this session. Other sessions may still have open records — clear the filter to see them."
              : "Nothing is open. Start one from a patient record or from a checked-in appointment."} />
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">{live.map(row)}</ul>
        )}

        {completedUnsigned.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-[12px] font-bold text-amber-800">
              {completedUnsigned.length} completed, not signed
            </p>
            <p className="mt-0.5 text-[11px] text-gray-700">
              The consultation is finished but the record is not final. Until it is signed it can still be edited.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">{completedUnsigned.map(row)}</ul>
          </div>
        )}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* ── Recently closed ──────────────────────────────────────────────────────────────────── */}
        <section className={`lg:col-span-2 ${CARD} p-4`}>
          <PanelHeading panel="closed"
            title={showAllClosed ? "Closed encounters" : "Recently closed"}
            subtitle="Signed and amended records, newest first."
            action={
              // ⚠ THE LINK CHANGES WHAT IS READ, not just what is shown. "View all" re-runs the loader
              // with a bigger bound rather than revealing rows that were already fetched and hidden --
              // a client-side reveal would have quietly capped at twelve however it was labelled.
              dash.closed.permitted && !dash.closed.unavailable ? (
                <Link href={showAllClosed
                  ? `/practice/encounters${sessionFilter ? `?session=${sessionFilter}` : ""}`
                  : `/practice/encounters?closed=all${sessionFilter ? `&session=${sessionFilter}` : ""}`}
                  className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  {showAllClosed ? "Show recent only" : "View all"}
                </Link>
              ) : undefined
            } />
          {closedItems.length === 0 ? (
            <PanelState permitted={dash.closed.permitted} unavailable={dash.closed.unavailable}
              what="closed encounters"
              empty={sessionFilter
                ? showAllClosed
                  ? "Nothing signed for this session."
                  : "Nothing signed for this session in the recent window. Try View all."
                : "Nothing has been signed yet."} />
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {closedItems.map(e => (
                <li key={e.id}>
                  <Link href={`/practice/encounters/${e.id}`}
                    className="block rounded-lg border border-gray-100 p-2.5 hover:bg-gray-50">
                    <p className="truncate text-[12px] font-semibold text-gray-900">{patientLabel(e)}</p>
                    <p className="truncate text-[11px] text-gray-500">
                      {e.reasonForVisit ?? String(e.entryPathway).replace(/_/g, " ")}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ENCOUNTER_STATUS_CHIP[e.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {ENCOUNTER_STATUS_LABEL[e.status] ?? e.status}
                      </span>
                      {/* ⚠ THE OUTCOME IS SHOWN ONLY WHEN ONE WAS RECORDED. A missing outcome is not
                          "stable" and must never be drawn as one. */}
                      {e.outcome && <span className="text-[10px] capitalize text-gray-500">outcome: {e.outcome}</span>}
                      <span className="ml-auto font-mono text-[10px] text-gray-400">
                        {e.signedAt ? formatDate(e.signedAt) : formatDate(e.startedAt)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* ⚠ THE BOUND IS PRINTED WHENEVER IT COULD BE HIDING SOMETHING. "View all" that silently stops
              at a hundred is worse than no link at all: the practitioner believes they have seen the lot. */}
          {closedCapped && (
            <p className="mt-2.5 text-[10px] text-gray-500">
              Stopped at {CLOSED_ALL_LIMIT} records. There may be older signed encounters that are not
              here &mdash; a patient&rsquo;s full history is on their record, not on this panel.
            </p>
          )}
          {!showAllClosed && sessionFilter && closedItems.length > 0 && (
            <p className="mt-2.5 text-[10px] text-gray-500">
              Filtered from the most recent signed records only. One from this session outside that window
              is not here &mdash; use <strong>View all</strong>.
            </p>
          )}
        </section>

        {/* ── What needs attention ─────────────────────────────────────────────────────────────── */}
        <section className={`${CARD} p-4`}>
          <PanelHeading panel="attention" title="What needs attention" />
          {/* ⚠ THE COMP CALLS THIS PANEL "AI Practice Assistant". THESE ARE NOT AI, AND THE HEADING SAYS
              SO. Every figure below is a count of rows that exist. Nothing is inferred, predicted or
              ranked. Dressing four SQL counts as an intelligence is how a practitioner comes to trust an
              inference that was never made -- so the assistant is a link at the bottom, where it belongs. */}
          <ul className="mt-3 flex flex-col gap-1.5">
            {dash.attention.map(a => (
              <li key={a.key}>
                {!a.permitted ? (
                  <p className="rounded-lg bg-gray-50 px-2.5 py-2 text-[11px] text-gray-500">
                    {a.label} &mdash; not visible to you
                  </p>
                ) : (
                  <Link href={a.href}
                    className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-2 hover:bg-gray-50">
                    <span className={`text-[15px] font-bold ${a.count === null ? "text-slate-300" : a.count > 0 ? "text-rose-700" : "text-gray-400"}`}>
                      {a.count === null ? "—" : a.count}
                    </span>
                    <span className="text-[11px] text-gray-700">{a.label}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-400">
            Counts of records, not predictions. An em dash means the count could not be read &mdash; it does
            not mean nought.
          </p>
          <Link href="/practice/assistant"
            className="mt-2 inline-block text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Ask the practice assistant →
          </Link>
        </section>
      </div>
    </div>
  );
}
