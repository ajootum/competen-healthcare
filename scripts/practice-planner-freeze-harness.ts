/**
 * CPR-PLN-002 -- THE PRACTICE PLANNER'S FUNCTIONAL FREEZE.
 *
 * s16: "Upon implementation and acceptance of this specification, the Practice Planner is FROZEN."
 * These pins ARE the freeze: the next change to the planner's information architecture arrives holding
 * a defect or a genuinely new requirement, or this file goes red.
 *
 * ⚠ AND ONE ARRIVED. CPR-PLAN-002 "Practice Planner Views" (2026-08-16 -- PLAN, not PLN; a different
 * document) is the newer specification and governs the four views. Where its text moves a frozen
 * property the pin is REPOINTED below with the section that moved it; where it is silent, PLN-002's
 * freeze stands untouched. What it moved, and what it did not:
 *
 *   REPOINTED  1h  Agenda gains s8.3's ITEM PREVIEW -- selection-gated, never permanent. The
 *                  PLN-002 half ("no PERMANENT side panel, no Day Inspector, no day canvas under
 *                  Agenda") still holds and is still asserted.
 *   NEW (s6)       the CPR-PLAN-002 pins -- the PAST/TODAY/UPCOMING agenda, one-line session rows
 *                  with names behind the chevron, the bounded Next-7 default, the Day view's
 *                  empty-book collapse, week/month overflow bounds, the compact filter control.
 *   UNMOVED        the Day-gated appointment book, one Day Inspector, no queue, no encounter
 *                  creation, one date control, the 24-hour clock, every honesty sentence, and the
 *                  Week default. CPR-PLAN-002 says nothing against any of them.
 *
 * WHAT IT PINS -- PROPERTIES, NEVER TALLIES. This repo's recorded lesson is that a pinned count goes
 * red against correct work; every assertion below is about structure (which mode mounts what),
 * sentences (the honesty language that must keep rendering), or control inventory (what exists, what
 * routes, what is refused) -- and each scan carries a control proving it read something real.
 *
 *   1. s6/s13: the four modes are four COMPOSITIONS -- Week has no appointment book under it, Day owns
 *      the book, Month owns the calendar grid, Agenda is the list with no permanent side panel.
 *   2. s5.3: ONE Day Inspector -- Overview / Follow-ups / Checks -- where six cards used to stack, and
 *      the replaced cards' capabilities are routed, not dropped.
 *   3. s5.1/s5.3: AI Planner and Legend are disclosures, not permanent cards; Quick Actions live in
 *      + Add Activity's type menu; the AI language stays honest about what does not exist.
 *   4. s8/s12: canonical routing -- no queue console, no encounter creation, one date control; and the
 *      honesty sentences (typed travel allowance, unreadable-day, no percentages) still render.
 *   5. s4: the frozen vocabulary -- Day/Week/Month/Agenda, Week as the default -- via the constants
 *      the screens actually import.
 *
 *   npx --yes tsx scripts/practice-planner-freeze-harness.ts
 *
 * Source pins and pure constants only: no database, no env. It must stay runnable on a bare checkout,
 * because the freeze is a statement about the CODE.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PLANNER_VIEWS, DEFAULT_PLANNER_VIEW,
  AGENDA_BANDS, AGENDA_QUICK_RANGES, AGENDA_DEFAULT_AHEAD_DAYS,
} from "../src/lib/practice/planner-constants";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const CAL = ["src", "app", "practice", "(shell)", "calendar"];
const src = (name: string) => readFileSync(join(process.cwd(), ...CAL, name), "utf8");

/**
 * ⚠ ABSENCE PINS SCAN CODE, NOT COMMENTS. A comment that NAMES the removed thing while explaining its
 * removal is the classic needle-matches-itself trap this repo has already paid for -- "Prev/Next" in a
 * comment about why the strip left would fail an assertion about the strip itself. Presence pins that
 * deliberately target a marker comment keep using the raw source.
 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter(l => !l.trim().startsWith("//")).join("\n");

async function main() {
  console.log("\nCPR-PLN-002 Practice Planner freeze harness\n");

  const page = src("page.tsx");
  const workspace = src("PlannerWorkspace.tsx");
  const inspector = src("DayInspector.tsx");
  const console_ = src("CalendarConsole.tsx");
  const opsHeader = src("OperationsHeader.tsx");
  const ribbon = src("AvailabilityRibbon.tsx");
  const context = src("ContextPanel.tsx");
  const agenda = src("AgendaList.tsx");
  const weekPanel = src("WeekPanel.tsx");
  const monthGrid = src("MonthGrid.tsx");
  const filtersBar = src("PlannerFilters.tsx");
  const actions = src("ActivityActions.tsx");
  // Comment-free variants, for every pin about something being ABSENT.
  const pageC = stripComments(page);
  const workspaceC = stripComments(workspace);
  const inspectorC = stripComments(inspector);
  const consoleC = stripComments(console_);
  const opsHeaderC = stripComments(opsHeader);
  const ribbonC = stripComments(ribbon);
  const contextC = stripComments(context);
  const agendaC = stripComments(agenda);
  ok("0b. control -- stripping comments removed something, so the absence pins are not scanning raw text",
    pageC.length < page.length && consoleC.length < console_.length && agendaC.length < agenda.length);

  // ⚠ THE SCAN'S OWN CONTROL, FIRST. Every pin below is a needle in one of these haystacks; a haystack
  // that failed to load would let an absence-pin pass on an empty string.
  ok("0. control -- every scanned file was read and is not trivially empty",
    [page, workspace, inspector, console_, opsHeader, ribbon, context, agenda, weekPanel, monthGrid,
      filtersBar, actions].every(s => s.length > 800),
    [page, workspace, inspector, console_, opsHeader, ribbon, context, agenda, weekPanel, monthGrid,
      filtersBar, actions].map(s => s.length).join(","));

  // ══ 1. s6/s13: FOUR MODES, FOUR COMPOSITIONS ═════════════════════════════════════════════════════

  // The appointment book is read and mounted behind the Day gate -- not merely hidden.
  const gate = page.indexOf('if (view === "day")');
  ok("1a. ⚠ page.tsx gates the appointment book on the DAY view",
    gate !== -1 && page.includes("dayOperations"));
  ok("1b. ⚠ and the book's four reads run only INSIDE that gate -- Week/Month/Agenda do not pay for a "
    + "book they must not show",
    gate !== -1
    && ["await calendarDay(", "loadDay(", "locationDay(", "timelineDay("]
      .every(call => page.indexOf(call) > gate),
    ["await calendarDay(", "loadDay(", "locationDay(", "timelineDay("]
      .map(c => `${c}@${page.indexOf(c)}`).join(" "));
  ok("1c. the book's panels are mounted from the gate, not from the always-rendered tail",
    ["<AvailabilityRibbon", "<Timeline", "<CalendarConsole", "<OperationsHeader", "<CalendarFooter", "<WhereYouAre"]
      .every(tag => page.indexOf(tag) > gate));

  // Week mode: rail + canvas + ONE inspector, and none of the book's components imported here.
  const weekBranch = workspace.slice(
    workspace.indexOf('period.view === "week"'),
    workspace.indexOf('period.view === "day"'));
  ok("1d. ⚠ Week mode is My Week + selected-day canvas + Day Inspector, and nothing else",
    weekBranch.includes("<WeekPanel") && weekBranch.includes("{detail}")
    && weekBranch.includes("{inspector}") && !weekBranch.includes("dayOperations"));
  ok("1e. ⚠ the workspace itself imports NO appointment-book component -- the book cannot come back "
    + "under Week without this line going red",
    !/import\s+(Timeline|CalendarConsole|OperationsHeader|AvailabilityRibbon|CalendarFooter|WhereYouAre)\b/.test(workspaceC));

  // Day mode: the book precedes the canvas (s6's primary content, s10's DOM order).
  const dayBranch = workspace.slice(
    workspace.indexOf('period.view === "day"'),
    workspace.indexOf('period.view === "month"'));
  ok("1f. Day mode mounts the book FIRST, then the canvas and inspector",
    dayBranch.indexOf("{dayOperations}") !== -1
    && dayBranch.indexOf("{dayOperations}") < dayBranch.indexOf("{detail}")
    && dayBranch.includes("{inspector}"));

  // Month mode: the grid, and no second calendar anywhere else.
  const monthBranch = workspace.slice(
    workspace.indexOf('period.view === "month"'),
    workspace.indexOf("// AGENDA"));
  ok("1g. Month mode is the calendar grid plus the inspector",
    monthBranch.includes("<MonthGrid") && monthBranch.includes("{inspector}"));
  ok("1g-control. and MonthGrid is mounted in the month branch ONLY -- one calendar, not two",
    workspace.split("<MonthGrid").length === 2);

  // Agenda: the list, the filters above it, and NO permanent side panel.
  //
  // ⚠ REPOINTED 2026-08-16 FOR CPR-PLAN-002 s8.3: "Selecting an item populates the Item Preview panel;
  // it should not force navigation away." So Agenda now carries a preview column -- and BOTH halves are
  // pinned: the preview EXISTS and is GATED ON A SELECTION (never permanent, which is the PLN-002
  // property that still stands), and the Day Inspector and day canvas still never mount under Agenda.
  const agendaBranch = workspace.slice(workspace.indexOf("// AGENDA"));
  ok("1h. ⚠ Agenda mode is the chronological list -- no Day Inspector column, no day canvas",
    agendaBranch.includes("<AgendaList") && !agendaBranch.includes("{inspector}")
    && !agendaBranch.includes("{detail}"));
  ok("1h2. ⚠ CPR-PLAN-002 s8.3: the Item Preview mounts ONLY while a session is selected, and it is "
    + "the same ContextPanel the Day Inspector renders -- one vocabulary, two surfaces (HFE-07)",
    agendaBranch.includes("{session && (") && agendaBranch.includes("Item preview")
    && agendaBranch.includes("<ContextPanel"));
  ok("1h-control. the agenda marker exists, so 1h sliced a real branch and not the whole file",
    workspace.includes("// AGENDA: the chronological list"));

  // ══ 2. s5.3: ONE DAY INSPECTOR WHERE SIX CARDS STOOD ═════════════════════════════════════════════

  ok("2a. ⚠ the old right rail is GONE as a file, and nothing imports it",
    !existsSync(join(process.cwd(), ...CAL, "RightRail.tsx"))
    && !pageC.includes("RightRail") && !workspaceC.includes("RightRail"));
  ok("2b. the Day Inspector exists with exactly the three specified tabs",
    inspector.includes('{ key: "overview", label: "Overview"')
    && inspector.includes('{ key: "followups", label: "Follow-ups"')
    && inspector.includes('{ key: "checks", label: "Checks"')
    && inspector.includes('role="tablist"'));
  ok("2c. Overview is the default tab, and it renders the day/session context panel",
    inspector.includes('useState<TabKey>("overview")') && inspector.includes("<ContextPanel"));
  ok("2d. ⚠ NO LIVE QUEUE ANYWHERE IN THE PLANNER: nothing in the calendar route calls the queue API",
    [pageC, workspaceC, inspectorC, consoleC, contextC].every(s => !s.includes("/api/v1/practice/queue")));
  ok("2e. s10: below the desktop breakpoint the inspector is collapsible, not a forced column",
    inspector.includes("xl:hidden") && inspector.includes('openOnSmall ? "block" : "hidden xl:block"'));
  ok("2f. the Follow-ups tab points at the board instead of duplicating the workflow",
    inspector.includes('href="/practice/follow-ups"')
    && inspector.includes("does not redefine one as a task"));
  ok("2g. ⚠ the Checks tab is deterministic and says so -- and it carries the name-only booking "
    + "warning the old briefing card held",
    inspector.includes("None of them is clinical")
    && inspector.includes("booked by name only, with no clinical record attached"));
  ok("2h. an unreadable day is not a clean bill in Checks",
    inspector.includes("nothing was checked on it"));
  ok("2i. the inspector's planner.ts import is TYPE-ONLY -- a value import breaks next build on pages "
    + "nobody touched",
    /import type \{[^}]*\} from "@\/lib\/practice\/planner"/.test(inspector));

  // ══ 3. s5.1/s5.3: DISCLOSURES, NOT PERMANENT CARDS ═══════════════════════════════════════════════

  ok("3a. ⚠ AI Planner is a header disclosure -- a control with expanded state, not an anchor to a card",
    workspace.includes("setAiOpen") && workspace.includes("aria-expanded={aiOpen}")
    && !workspaceC.includes("#planner-ai"));
  ok("3b. ⚠ and its language stays honest about what does not exist",
    workspace.includes("AI Planner -- not yet available.")
    && workspace.includes("does not suggest slots"));
  ok("3c. the Legend is a control that opens a compact panel, and colour stays non-load-bearing",
    workspace.includes("aria-expanded={legendOpen}")
    && workspace.includes("Colour only makes the week scannable"));
  ok("3d. ⚠ Quick Actions are + Add Activity's type menu -- rendered from PLANNER_QUICK_ACTIONS, "
    + "never a hand-typed row",
    workspace.includes("PLANNER_QUICK_ACTIONS.map")
    && workspace.includes("Nothing is written until you add it."));
  ok("3e. s5.1: a zero that says nothing steps aside on small widths only -- desktop keeps every figure",
    workspace.includes("quietOnSmall") && workspace.includes('quietOnSmall ? "max-md:hidden" : ""'));

  // ══ 4. s8/s12: CANONICAL ROUTING AND THE HONESTY SENTENCES ═══════════════════════════════════════

  ok("4a. ⚠ the console does not create encounters -- starting a consultation ROUTES to Current Session",
    !consoleC.includes("/api/v1/practice/encounters")
    && console_.includes("Start the consultation in Current Session"));
  ok("4b. the waiting pointer survives exactly as HFE-001 froze it",
    console_.includes("Manage in Current Session") && console_.includes('href="/practice/today"'));
  ok("4c. check-in stays in the book: marking an arrival is appointment-book work",
    console_.includes('"arrive"') && console_.includes("Check in"));
  ok("4d. ⚠ ONE date control on the screen: the console's own Prev/Next strip is gone",
    !consoleC.includes("‹ Prev") && !consoleC.includes("Next ›")
    && !consoleC.includes("?date=${iso}"));
  ok("4e. the Day-mode summary kept two cards and routed two -- no briefing, no second follow-up "
    + "overview",
    !opsHeaderC.includes("Before you start") && !opsHeaderC.includes("/practice/follow-ups")
    && opsHeader.includes("Today's clinic") && opsHeader.includes("Time booked"));
  ok("4e-control. the load card still refuses the comp's percentage in words",
    opsHeader.includes("dividing by a number nobody recorded"));
  ok("4f. ⚠ Day mode does not repeat a week dashboard: the ribbon's This-week strip is gone",
    !ribbonC.includes("This week") && ribbon.includes("Availability"));
  ok("4g. ⚠ the travel figure stays an ALLOWANCE, never a measured time",
    workspace.includes('note="not measured"') && inspector.includes("TRAVEL_BASIS_NOTE")
    && inspector.includes("TRAVEL_BASIS_LABEL"));
  ok("4h. ⚠ no rendered percentage anywhere in the planner workspace or inspector",
    !/[\d}]\s*%/.test(workspaceC) && !/[\d}]\s*%/.test(inspectorC));
  ok("4h-control. and the needle can find one when it is there", /[\d}]\s*%/.test("82%"));
  ok("4i. an unreadable day keeps its sentence in the workspace header",
    workspace.includes("could not be read."));
  ok("4j. booking a patient from the inspector JUMPS to the Day-mode book -- s8 forbids a second "
    + "booking surface over one store",
    context.includes("#appointment-book") && !contextC.includes("<form"));
  ok("4j-control. and the Day view still carries the anchor the jump lands on",
    page.includes('id="appointment-book"'));

  // ══ 5. s4: THE FROZEN VOCABULARY, FROM THE CONSTANTS THE SCREENS IMPORT ══════════════════════════

  ok("5a. ⚠ the four primary presentation modes are Day / Week / Month / Agenda, exactly",
    PLANNER_VIEWS.map(v => v.key).join(",") === "day,week,month,agenda",
    PLANNER_VIEWS.map(v => v.key).join(","));
  ok("5b. Week is the default planning workspace (s5.2)", DEFAULT_PLANNER_VIEW === "week",
    String(DEFAULT_PLANNER_VIEW));
  ok("5c. the route is still /practice/calendar -- the freeze renames nothing",
    workspace.includes("/api/v1/practice/planner")
    && readFileSync(join(process.cwd(), "src", "lib", "practice", "navigation.ts"), "utf8")
      .includes('"/practice/calendar"'));

  // ══ 6. CPR-PLAN-002 "PRACTICE PLANNER VIEWS" (2026-08-16) -- THE NEWER DOCUMENT'S OWN PINS ═════════
  //
  // Everything below is a property CPR-PLAN-002's TEXT requires. The comps beside it show three figures
  // this build refuses -- "not seen" (folds a recorded DNA and a booking nobody wrote anything about
  // into one number), an Agenda-settings card (no preference store holds any of it), and "Free time
  // (est.)" where the real subtraction already exists unlabelled as an estimate -- and pin 6e is the
  // refusal that must not quietly unhappen.

  // ---- s8.1: the agenda is PAST / TODAY / UPCOMING, rendered from the one band list ----
  ok("6a. ⚠ AGENDA_BANDS is exactly past/today/upcoming and the list renders FROM it",
    AGENDA_BANDS.map(b => b.key).join(",") === "past,today,upcoming"
    && agenda.includes("AGENDA_BANDS.map"),
    AGENDA_BANDS.map(b => b.key).join(","));

  // ---- s3: contextual quick ranges -- the Agenda's own three; Custom stays the navigator's ----
  ok("6b. the Agenda's quick ranges are Today / Next 7 days / Next 30 days, rendered from the constant",
    AGENDA_QUICK_RANGES.map(r => r.label).join("|") === "Today|Next 7 days|Next 30 days"
    && agenda.includes("AGENDA_QUICK_RANGES.map"),
    AGENDA_QUICK_RANGES.map(r => r.label).join("|"));
  ok("6c. ⚠ s8.1: a BARE agenda URL defaults to the bounded Next-7 horizon, not the anchor's whole month",
    AGENDA_DEFAULT_AHEAD_DAYS === 7 && pageC.includes("AGENDA_DEFAULT_AHEAD_DAYS"),
    String(AGENDA_DEFAULT_AHEAD_DAYS));
  ok("6d. s8.3: history and future EXTEND on request, one step at a time, through the URL",
    agenda.includes("earlier days") && agenda.includes("more days")
    && agenda.includes("AGENDA_EXTEND_STEP_DAYS"));

  // ---- s8.2/s8.3: one-line rows, names behind the chevron, and the honest outcome words ----
  ok("6e. ⚠ a past session row uses the engine's outcome vocabulary -- NEVER the comp's 'not seen', "
    + "which would fold a recorded DNA and an unrecorded outcome into one accusation",
    !agendaC.includes("not seen") && agendaC.includes("not recorded")
    && agendaC.includes('n("did_not_attend")'));
  ok("6e-control. and the needle finds the refused phrase when it is there",
    "4 booked · 1 not seen".includes("not seen"));
  ok("6f. ⚠ patient rows inside a session render BEHIND its expansion -- collapsed rows carry counts, "
    + "not names (s8.3)",
    agendaC.indexOf("{open && (") !== -1
    && agendaC.indexOf("{inside.map(a => <AppointmentRow") > agendaC.indexOf("{open && (")
    && agenda.includes('aria-expanded={open}'));
  ok("6g. s8.2: 'No bookings in this session' is no longer a standing full-width row of the agenda",
    !agendaC.includes("No bookings in this session"));
  ok("6g-control. the sentence still exists where the DAY view legitimately says it, so 6g is not "
    + "passing on a phrase that never existed",
    stripComments(src("DayPlanner.tsx")).includes("No bookings in this session."));

  // ---- s5.2: the Day view's empty-book collapse -- one inline state, and the console stays ----
  ok("6h. ⚠ on a day with nothing booked and no availability, the quiet panels step aside behind ONE "
    + "inline state",
    pageC.includes("const bookEmpty") && pageC.includes("{!bookEmpty && <AvailabilityRibbon")
    && /\{!bookEmpty &&\s*\(\s*<Timeline/.test(pageC)
    && pageC.includes("{!bookEmpty && <OperationsHeader") && pageC.includes("{!bookEmpty && <CalendarFooter")
    && pageC.includes("{!bookEmpty && <WhereYouAre"));
  ok("6h-control. ⚠ and the BOOKING CONSOLE is never behind that gate -- an empty day still books its "
    + "first patient",
    !pageC.includes("bookEmpty && <CalendarConsole") && pageC.includes("<CalendarConsole"));
  ok("6i. the inline empty state says both halves were read and points at the next useful action",
    page.includes("an empty day, not a failed one") && page.includes("/practice/setup/availability"));

  // ---- s6/s7: bounded week cards and month cells, overflow named rather than silent ----
  ok("6j. week day cards are BOUNDED: sessions and activities cap out with a named '+N more'",
    weekPanel.includes("WEEK_SESSION_MAX") && weekPanel.includes("WEEK_ACTIVITY_MAX")
    && weekPanel.includes("more session") && weekPanel.includes("more on this day"));
  ok("6j2. and the week's compact session line carries the null-aware booked/free counts",
    weekPanel.includes("capacityPhrase(s.capacity)"));
  ok("6k. ⚠ a month cell's THIRD activity is a named overflow, not a silent drop",
    monthGrid.includes("more activit"));

  // ---- s3/s5.2: the compact filter control, and actions behind a disclosure ----
  ok("6l. filters fold behind one control that carries the ACTIVE count on constrained widths",
    filtersBar.includes("Filters ({activeCount})") && filtersBar.includes("aria-expanded={filtersOpen}"));
  ok("6m. a block's eight actions sit behind one Actions disclosure until asked for (s5.2)",
    actions.includes("setActionsOpen") && actions.includes("Actions ⌄"));

  // ---- HFE-10: one action from Week or Agenda to the corresponding Day ----
  ok("6n. the week card and the agenda day heading both reach the Day view in one action",
    weekPanel.includes("Open Day view") && agenda.includes("Open day"));
  // walkthrough defect #1, 2026-08-16). A native type="time" input draws AM/PM columns on any
  // machine whose OS locale says so -- the product must not leave its clock format to the
  // visitor's operating system. Comment-stripped, because the replacement inputs carry comments
  // that NAME the forbidden attribute (the needle-in-documentation lesson).
  const timeInputFiles = readdirSync("src/app/practice/(shell)/calendar")
    .filter(f => f.endsWith(".tsx"))
    .filter(f => /type="time"|type="datetime-local"/.test(
      stripComments(readFileSync(`src/app/practice/(shell)/calendar/${f}`, "utf8"))));
  ok("planner time entry is the 24-hour text pattern -- no native time picker anywhere in the folder",
    timeInputFiles.length === 0, timeInputFiles.join(", "));
  ok("...and the 24-hour pattern is genuinely present where times are entered, so the pin is not scanning an empty folder",
    /pattern="\^\(\[01\]\?/.test(readFileSync("src/app/practice/(shell)/calendar/AddActivityForm.tsx", "utf8")));

  report();
}

function report() {
  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} passed, ${fails.length} failed`);
  fails.forEach(f => console.log(`  - ${f}`));
  if (fails.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
