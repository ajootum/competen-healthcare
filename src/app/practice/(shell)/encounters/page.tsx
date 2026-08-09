import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { encountersLanding, type EncountersLanding } from "@/lib/practice/encounters-landing";
import {
  LANDING_TABS, HISTORY_PERIODS, HISTORY_STATES, HISTORY_PAGE_SIZE,
  COMPLETION_OVERDUE_MINUTES, COMPLETION_THRESHOLD_IS_CONFIGURABLE,
  PATHWAY_LABEL, isLandingTab, type LandingTabKey,
} from "@/lib/practice/encounters-landing-constants";
import { ENCOUNTER_STATUS_CHIP, ENCOUNTER_STATUS_LABEL } from "@/lib/practice/encounter-workspace-constants";
import { formatDateTime, formatDate } from "@/lib/datetime";
import StartEncounter from "./StartEncounter";
import {
  CARD, Figure, PanelState, patientLabel, ContextStrip, WorkSection, AttentionPanel,
} from "./Board";

// /practice/encounters -- CPR-ENC-LANDING-001, the Encounters landing page.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE FROZEN DECISION, AND WHAT IT COST THE PREVIOUS BOARD (spec s0, s17, s19)
//
//   "Do not reproduce the Current Session queue, appointment list, waiting-room management, or session
//    dashboard on this page. Encounter context may be inherited from Current Session, but the Encounters
//    workspace remains a clinical-record workbench."
//
// The board this replaces opened with "Today's sessions": one card per session, each carrying four
// figures (Booked / Walk-ins / Completed / Open) and a "View patients" button. That IS a session
// dashboard, and it was the first thing on the page. It is gone -- s4.2 asks for "a compact strip only",
// and one strip is what there now is. The four figures were real and they still are; they live on the
// command centre, which owns the day.
//
// THREE OTHER THINGS MOVED OUT, ALL FROM THE ATTENTION PANEL. s4.6 excludes overdue follow-ups,
// unreviewed incoming documents and draft letters BY NAME; the old panel counted all three. They are
// real work and they are not encounter work.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE SCREEN MOST PEOPLE WILL MEET IS THE EMPTY ONE, AND IT IS DESIGNED FOR FIRST.
//
// The approved comp shows three named patients, three signed encounters and populated attention counts.
// The live practice has two patients, one open encounter and nothing signed. So every empty state here
// is compact, positive, and NAMES THE STATE IT IS EMPTY OF (s14, AC-12) -- an empty panel that does not
// say which state it is empty of reads as a page that failed to load.
//
// EVERY FILTER IS IN THE URL rather than in component state: a practitioner who has narrowed the board
// and then follows a link into an encounter must come back to the same view, and a filtered board
// somebody is reading over a colleague's shoulder has to be a link they can be sent.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

function href(base: string, params: Record<string, string | number | null | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export default async function EncountersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "encounter.list")) redirect("/practice/home");

  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };

  const tab: LandingTabKey = isLandingTab(one("tab")) ? (one("tab") as LandingTabKey) : "open";
  const sessionFilter = one("session") ?? null;
  const q = (one("q") ?? "").trim();
  const historyPage = Number.parseInt(one("hpage") ?? "0", 10) || 0;

  const admin = createAdminClient();
  // THE CLOCK IS THE ENGINE'S, not this component's. Calling Date.now() during a render is an impure
  // call the React compiler rejects outright, and the elapsed time of a consultation is data the loader
  // owns -- so encountersLanding measures it once and hands each row its own `elapsedMinutes`.
  const d: EncountersLanding = await encountersLanding(admin, shell.ctx, {
    tab, session: sessionFilter, q: q || null,
    historyPeriod: one("hperiod") ?? null, historyState: one("hstate") ?? null,
    historyFrom: one("hfrom") ?? null, historyTo: one("hto") ?? null,
    historyPage,
  });

  const tabDef = (k: LandingTabKey) => LANDING_TABS.find(t => t.key === k)!;
  const keep = { session: sessionFilter, q: q || null };
  // ⚠ THE PAGE GOES WHERE THE ACTION WENT. Every tab and every history control carries a fragment, so
  // pressing one from halfway down a long board brings the thing it changed into view rather than
  // silently re-rendering something above the fold. That defect was found and fixed twice this week.
  const tabHref = (k: LandingTabKey) => href("/practice/encounters", { ...keep, tab: k === "open" ? null : k });
  const historyHref = (over: Record<string, string | number | null>) => href("/practice/encounters", {
    ...keep, tab: tab === "open" ? null : tab,
    hperiod: d.historyFilter.period, hstate: d.historyFilter.state,
    hfrom: d.historyFilter.from, hto: d.historyFilter.to, hpage: d.historyFilter.page || null,
    ...over,
  });

  const countFor = (k: LandingTabKey): number | null =>
    k === "open" ? d.counts.open
      : k === "ready" ? d.counts.ready
        : k === "completed_today" ? d.counts.completedToday
          : k === "attention" ? d.counts.attention
            : d.counts.all;

  return (
    <div className="max-w-6xl">
      {/* ── s4.1: header ───────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Encounters</h1>
          <p className="text-[13px] text-gray-500">Create, continue and review clinical encounters.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* ⚠ A PLAIN GET FORM, NOT A CLIENT COMPONENT. The result is a URL, which is shareable, is in
              the back button, and works from the keyboard before any JavaScript has loaded. */}
          <form method="get" action="/practice/encounters" className="flex items-center gap-1.5">
            {tab !== "open" && <input type="hidden" name="tab" value={tab} />}
            {sessionFilter && <input type="hidden" name="session" value={sessionFilter} />}
            <label htmlFor="enc-q" className="sr-only">Search patient or encounter</label>
            <input id="enc-q" name="q" defaultValue={q} placeholder="Search patient or encounter…"
              className="w-[240px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-900 placeholder:text-gray-400 focus:border-[var(--cp-primary)] focus:outline-none" />
            <button type="submit"
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Search
            </button>
          </form>

          {/* ⚠ ALREADY BUILT AND DELIBERATELY UNTOUCHED (CPR-FLOW-001, commit c5de6f9b). The picker
              opens over this board, reuses the register's own search and registration form, and lands on
              the consultation. It IS s8's "lightweight encounter launcher" and it is not re-implemented
              here. The comp draws a dropdown chevron beside it; a chevron opening the same panel the
              button already opens would be two controls for one act. */}
          <StartEncounter canStart={d.can.create} canRegisterPatient={hasCapability(shell.ctx, "patient.create")} />
        </div>
      </div>

      {/* ── s4.2: the current context strip. COMPACT, AND ONE STRIP ONLY. ──────────────────────── */}
      <div className="mt-4">
        <ContextStrip context={d.context} />
      </div>

      {/* ⚠ A FILTERED BOARD SAYS SO, LOUDLY AND WITH A WAY OUT. A narrowed board that looks like the
          whole board is how somebody goes home believing nothing is open. */}
      {sessionFilter && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/5 px-3 py-2">
          <span className="text-[12px] text-gray-800">
            Showing only one session&rsquo;s records. Every figure and every list below is narrowed to it
            &mdash; this is not the whole practice.
          </span>
          <Link href={href("/practice/encounters", { tab: tab === "open" ? null : tab, q: q || null })}
            className="ml-auto rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
            Clear session filter
          </Link>
        </div>
      )}

      {/* ── s4.3: the status tabs. EACH IS A FILTER, NOT A PASSIVE KPI. ────────────────────────── */}
      <nav aria-label="Encounter filters" className="mt-4 flex flex-wrap gap-1 border-b border-gray-200">
        {LANDING_TABS.map(t => {
          const active = t.key === tab;
          return (
            <Link key={t.key} href={`${tabHref(t.key)}#work`} aria-current={active ? "page" : undefined}
              className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-[12.5px] font-semibold ${
                active
                  ? "border-[var(--cp-primary)] text-[var(--cp-primary-deep)]"
                  : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              {t.label}
              {t.key !== "all" && <span className="ml-1 text-gray-400">(<Figure value={countFor(t.key)} />)</span>}
            </Link>
          );
        })}
      </nav>
      {d.countsUnavailable && (
        <p className="mt-2 text-[11px] text-rose-700">
          At least one of these figures could not be counted and is shown as an em dash. An em dash is
          not nought &mdash; do not read the board as empty where one appears.
        </p>
      )}

      {/* ── s4.1 / s9: what the search found ───────────────────────────────────────────────────── */}
      {d.search && (
        <section className={`mt-4 ${CARD} p-4`}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-[15px] font-bold text-gray-900">
              Results for &ldquo;{d.search.query}&rdquo;
            </h2>
            <Link href={href("/practice/encounters", { tab: tab === "open" ? null : tab, session: sessionFilter })}
              className="ml-auto text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Clear search
            </Link>
          </div>
          {!d.search.ran ? (
            <p className="mt-2 text-[12px] text-gray-500">
              Nothing has been searched yet &mdash; a search needs at least two characters. This is not a
              result of nobody matching.
            </p>
          ) : (
            <>
              {/* ⚠ A FAILED PROBE NEVER RENDERS AS "NOBODY MATCHES". That sentence is what sends
                  somebody to register a patient who is already on the register -- a split clinical
                  record, which is the harm the duplicate check exists to prevent. */}
              {!d.search.patientsComplete && (
                <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                  <strong>Part of the patient search did not answer.</strong> {d.search.patientsDetail}{" "}
                  Nobody can be said to be absent from this result.
                </p>
              )}
              {d.search.encountersUnavailable && (
                <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                  <strong>The encounter search could not be run.</strong>{" "}
                  {d.search.encountersDetail} This is not a search that matched nothing.
                </p>
              )}

              <h3 className="mt-3 text-[12px] font-bold text-gray-700">Patients</h3>
              {!d.search.patientsPermitted ? (
                <p className="text-[12px] text-gray-500">
                  Patients were not searched &mdash; your role does not carry patient.list.
                </p>
              ) : d.search.patients.length === 0 ? (
                <p className="text-[12px] text-gray-500">
                  {d.search.patientsComplete
                    ? "Nobody on the register matches."
                    : "No matching patient was returned by the probes that answered."}
                </p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {d.search.patients.map(p => (
                    <li key={p.id}>
                      <Link href={`/practice/patients/${p.id}`}
                        className="block rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12.5px] text-gray-800 hover:bg-gray-50">
                        <span className="font-semibold">{p.displayName}</span>
                        {p.practiceId && <span className="ml-2 font-mono text-[11px] text-gray-500">{p.practiceId}</span>}
                        <span className="ml-2 text-[11px] text-gray-400">matched on {p.matchedBy}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mt-3 text-[12px] font-bold text-gray-700">Encounters</h3>
              {!d.search.encountersPermitted ? (
                <p className="text-[12px] text-gray-500">
                  Encounters were not searched &mdash; your role does not carry encounter.list.
                </p>
              ) : d.search.encounters.length === 0 ? (
                <p className="text-[12px] text-gray-500">
                  {d.search.encountersUnavailable
                    ? "No encounter result, because the query did not run."
                    : "No encounter matches that text."}
                </p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {d.search.encounters.map(e => (
                    <li key={e.id}>
                      <Link href={`/practice/encounters/${e.id}`}
                        className="block rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12.5px] text-gray-800 hover:bg-gray-50">
                        <span className="font-semibold">{patientLabel(e)}</span>
                        <span className="ml-2 text-[11px] text-gray-500">
                          {PATHWAY_LABEL[e.entryPathway] ?? e.entryPathway} · {formatDate(e.startedAt)}
                        </span>
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${ENCOUNTER_STATUS_CHIP[e.status] ?? "bg-gray-100 text-gray-500"}`}>
                          {ENCOUNTER_STATUS_LABEL[e.status] ?? e.status}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10.5px] text-gray-400">
                This box searches patients and encounter records only. Documents, follow-ups, tasks and
                messages are searched from the practice search, not here.
              </p>
            </>
          )}
        </section>
      )}

      <div id="work" className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {tab === "open" ? (
            <>
              {/* ── s4.4: the hero work area ─────────────────────────────────────────────────── */}
              <WorkSection id="open" title="Open encounters" subtitle={tabDef("open").note}
                panel={d.open} what="open encounters" empty={tabDef("open").empty}
                canSeePatient={d.can.patient} canSign={d.can.sign} count={d.counts.open} />

              {/* ── s4.5: a SEPARATE state. "Do not mix these with incomplete drafts." ───────── */}
              <WorkSection id="ready" title="Ready to sign" subtitle={tabDef("ready").note}
                panel={d.ready} what="encounters ready to sign" empty={tabDef("ready").empty}
                canSeePatient={d.can.patient} canSign={d.can.sign} count={d.counts.ready} />
            </>
          ) : (
            <WorkSection id="filtered" title={tabDef(tab).label} subtitle={tabDef(tab).note}
              panel={d.tabList} what={tabDef(tab).label.toLowerCase()} empty={tabDef(tab).empty}
              canSeePatient={d.can.patient} canSign={d.can.sign} count={countFor(tab)} />
          )}
        </div>

        {/* ── s4.6: encounter attention. ENCOUNTER-SPECIFIC ONLY. ────────────────────────────── */}
        <AttentionPanel rows={d.attention} />
      </div>

      {/* ── s4.7: encounter history ────────────────────────────────────────────────────────────── */}
      <section id="history" className={`mt-6 ${CARD} p-4`}>
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-gray-900">Encounter history</h2>
            <p className="text-[12px] text-gray-500">Completed and amended encounters, newest first.</p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1" role="group" aria-label="History period">
              {HISTORY_PERIODS.map(p => (
                <Link key={p.key} href={`${historyHref({ hperiod: p.key, hpage: null })}#history`}
                  aria-current={d.historyFilter.period === p.key ? "true" : undefined}
                  className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold ${
                    d.historyFilter.period === p.key
                      ? "border-[var(--cp-primary)]/40 bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                  {p.label}
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="History state">
              {HISTORY_STATES.map(s => (
                <Link key={s.key} href={`${historyHref({ hstate: s.key, hpage: null })}#history`}
                  aria-current={d.historyFilter.state === s.key ? "true" : undefined}
                  className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold ${
                    d.historyFilter.state === s.key
                      ? "border-[var(--cp-primary)]/40 bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                  {s.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* s4.7's Custom range. The two boxes are always here rather than behind the Custom button:
            a control that reveals the control that does the thing is two presses for one act. */}
        <form method="get" action="/practice/encounters" className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="hperiod" value="custom" />
          {tab !== "open" && <input type="hidden" name="tab" value={tab} />}
          {sessionFilter && <input type="hidden" name="session" value={sessionFilter} />}
          {q && <input type="hidden" name="q" value={q} />}
          <input type="hidden" name="hstate" value={d.historyFilter.state} />
          <label className="text-[11px] text-gray-500">
            From
            <input type="date" name="hfrom" defaultValue={d.historyFilter.from ?? ""}
              className="ml-1 rounded-lg border border-gray-200 px-2 py-1 text-[11.5px]" />
          </label>
          <label className="text-[11px] text-gray-500">
            To
            <input type="date" name="hto" defaultValue={d.historyFilter.to ?? ""}
              className="ml-1 rounded-lg border border-gray-200 px-2 py-1 text-[11.5px]" />
          </label>
          <button type="submit"
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50">
            Apply custom range
          </button>
        </form>

        {d.history.items.length === 0 ? (
          <>
            <PanelState permitted={d.history.permitted} unavailable={d.history.unavailable}
              detail={d.history.detail} what="encounter history"
              empty={
                // ⚠ s14: "explain the active filter and offer reset". An empty register under a narrow
                // filter is not an empty register, and the sentence names the state it is empty of.
                d.historyFilter.state === "amended"
                  ? "Nothing has been amended in this period. No signed record has been reopened and re-signed."
                  : d.historyFilter.state === "signed"
                    ? "Nothing has been signed in this period."
                    : "Nothing has been signed or amended in this period."
              } />
            {d.history.permitted && !d.history.unavailable && (
              <Link href={`${href("/practice/encounters", { ...keep, tab: tab === "open" ? null : tab, hperiod: "30d" })}#history`}
                className="mt-2 inline-block text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                Reset to the last 30 days, all states →
              </Link>
            )}
          </>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="py-1.5 font-semibold">Patient</th>
                  <th className="py-1.5 font-semibold">Encounter</th>
                  <th className="py-1.5 font-semibold">Date &amp; time</th>
                  <th className="py-1.5 font-semibold">Session</th>
                  <th className="py-1.5 font-semibold">Status</th>
                  <th className="py-1.5 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {d.history.items.map(e => (
                  <tr key={e.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="text-[12.5px] font-semibold text-gray-900">{patientLabel(e)}</span>
                      {e.patientIdentifier && (
                        <span className="ml-2 font-mono text-[11px] text-gray-500">{e.patientIdentifier}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[12px] text-gray-600">
                      {PATHWAY_LABEL[e.entryPathway] ?? e.entryPathway}
                      {e.reasonForVisit && <span className="block text-[11px] text-gray-400">{e.reasonForVisit}</span>}
                    </td>
                    <td className="py-2 pr-3 text-[12px] text-gray-600">{formatDateTime(e.startedAt)}</td>
                    <td className="py-2 pr-3 text-[12px] text-gray-500">
                      {e.sessionTitle ?? <span className="text-gray-400">No session</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {/* ⚠ AC-11: SIGNED AND AMENDED ARE VISUALLY DISTINCT. The shared status chip gives
                          both the same emerald, which is right for "closed" and wrong here -- an amended
                          record is one that was signed and then changed, and a reader has to see that at
                          a glance. */}
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        e.status === "AMENDED"
                          ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300"
                          : ENCOUNTER_STATUS_CHIP[e.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {ENCOUNTER_STATUS_LABEL[e.status] ?? e.status}
                      </span>
                      {e.status === "AMENDED" && (
                        <span className="mt-0.5 block text-[10.5px] text-gray-500">
                          {/* ⚠ THERE IS NO amended_at COLUMN. This is derived from the immutable status
                              history, and when THAT read failed the row says so rather than printing the
                              signature date as though it were the amendment. */}
                          {e.amendedAtUnavailable
                            ? "amended — when could not be read"
                            : e.amendedAt ? `amended ${formatDate(e.amendedAt)}` : "amended — no transition recorded"}
                        </span>
                      )}
                      {e.status === "SIGNED" && e.signedAt && (
                        <span className="mt-0.5 block text-[10.5px] text-gray-500">signed {formatDate(e.signedAt)}</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <Link href={`/practice/encounters/${e.id}`}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-[10.5px] text-gray-500">
            Filtered on when the consultation <strong>started</strong>, in {d.timezone}. Page{" "}
            {d.historyFilter.page + 1}, {HISTORY_PAGE_SIZE} records a page.
          </p>
          <div className="ml-auto flex gap-2">
            {d.historyFilter.page > 0 && (
              <Link href={`${historyHref({ hpage: d.historyFilter.page - 1 })}#history`}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50">
                ← Previous
              </Link>
            )}
            {d.historyHasMore && (
              <Link href={`${historyHref({ hpage: d.historyFilter.page + 1 })}#history`}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50">
                Next →
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ⚠ THE THRESHOLD IS PRINTED, AND SO IS THE FACT THAT IT IS NOT YET CONFIGURABLE. s7 asks for a
          configurable completion-aging threshold; practice_configuration has no column for one and this
          change carries no migration, so the default is stated here rather than left as an unexplained
          colour change on a card at some hour of the night. */}
      <p className="mt-4 text-[10.5px] text-gray-400">
        An open encounter is marked <strong>Completion overdue</strong> after{" "}
        {Math.round(COMPLETION_OVERDUE_MINUTES / 60)} hours. That is a records signal, not a clinical
        one &mdash; it says a consultation was left unfinished, and nothing about the patient.
        {COMPLETION_THRESHOLD_IS_CONFIGURABLE
          ? ""
          : " This practice cannot yet change it: there is no setting for it in this build."}
      </p>
    </div>
  );
}
