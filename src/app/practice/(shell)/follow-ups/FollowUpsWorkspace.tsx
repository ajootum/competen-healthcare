"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  FOLLOW_UP_VIEWS, FOLLOW_UP_KINDS, FOLLOW_UP_SOURCES, FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_ACTION_TYPES, FOLLOW_UP_TYPE_LABELS,
  LIVE_FOLLOW_UP_STATUSES, DUE_WEEK_DAYS,
} from "@/lib/practice/follow-up-constants";
import type { FollowUpWorkspace as WorkspaceView } from "@/lib/practice/follow-ups";
import { FOLLOWUP_CARD_SWATCH, CARD_SWATCH_UNKEYED, CARE_CARD_UNSUPPLIED, BUTTON } from "@/lib/practice/palette";
import AddFollowUp from "./AddFollowUp";
import RowActions from "./RowActions";
import { THEAD, TABLE_SCROLL } from "@/components/practice/PatientTable";
import { useBodyScrollLock } from "../_responsive/use-body-scroll-lock";
// ⚠ THE HOOK LIVES IN THE PLANNER'S FOLDER because phase 4a wrote it there first. It is imported, not
// copied: two matchMedia hooks asking about the same 768px boundary is how one face starts disagreeing
// with the max-md:* classes beside it. It belongs in _responsive/ eventually -- reported, not moved,
// because that folder is not this phase's to edit.
import { useBelowMd } from "../calendar/use-below-md";
import { practiceDayOf } from "@/lib/practice/practice-time";

// CPR-FUP-001 s4/s5 -- the summary cards, the saved views, and the work queue.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE TABS ARE FILTERS, NOT ROUTES (s3, verbatim: "internal views are implemented as tabs and filters
// within the workspace"), AND THEY FILTER THE SAME ROWS THE CARDS COUNTED.
//
// `workspace.allRows` is every obligation the header's filters left. A tab applies FOLLOW_UP_VIEWS'
// own predicate to those rows -- the same predicate, over the same array, that produced the figure on
// the card above it. There is no second query and no second rule, so there is nothing for the card and
// the list to disagree about. A card counting rows while the list it opened counted something else is a
// real bug that shipped on the Patients register this month; the only fix that holds is the one where
// the two cannot drift.
//
// ⚠ COLOUR IS DOING SEMANTIC WORK AND THE FIGURE TAKES THE CARD'S HUE. A tinted badge beside a black
// number leaves the colour on the decoration -- the number is the thing being read. Five grey rectangles
// with five numbers in them have to be READ one at a time; five coloured ones are FOUND. That has been
// written on three screens in this codebase already, each time after "the colors are flat".
//
// THE SWATCHES ARE NOT DECIDED HERE. FOLLOWUP_CARD_SWATCH lives in palette.ts, keyed on these five card
// keys directly, with the reason for each hue written beside it. This page used to hold a private map
// pointing each card at some OTHER card's entry -- "Completed" borrowed `newRegistrations` because that
// entry happens to be emerald -- which rendered correctly while leaving the colour decision in a
// component, tied to a key that names something else. The harness now asserts palette.ts's key set is
// exactly the set followUpWorkspace() emits, in both directions.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const KIND_LABEL = Object.fromEntries(FOLLOW_UP_KINDS) as Record<string, string>;
const SOURCE_LABEL = Object.fromEntries(FOLLOW_UP_SOURCES.map(([c, l]) => [c, l])) as Record<string, string>;

/** The Status column. ⚠ These are DERIVED words, not column values -- see dueState in follow-ups.ts. */
function statusChip(f: any): { label: string; className: string; title: string } {
  if (f.status === "DRAFT")
    return { label: "Draft", className: "bg-slate-100 text-slate-600 ring-slate-200", title: "Composed, and owed by nobody yet." };
  if (f.status === "COMPLETED")
    return { label: "Completed", className: "bg-emerald-100 text-emerald-700 ring-emerald-200", title: "Closed as done." };
  if (f.status === "MISSED")
    return { label: "Missed", className: "bg-slate-100 text-slate-600 ring-slate-200", title: "Somebody decided to stop chasing this. Reversible." };
  if (f.status === "CANCELLED")
    return { label: "Cancelled", className: "bg-slate-100 text-slate-500 ring-slate-200", title: "No longer needed." };
  if (f.overdue)
    return { label: "Overdue", className: "bg-rose-100 text-rose-700 ring-rose-200", title: "Derived from the due date against this practice's today. Nothing ran to set it." };
  if (f.status === "SCHEDULED")
    return {
      label: f.late ? "Booked, after it was due" : "Scheduled",
      className: f.late ? "bg-amber-100 text-amber-700 ring-amber-200" : "bg-sky-100 text-sky-700 ring-sky-200",
      title: f.bookedFor ? `Booked for ${f.bookedFor}.` : "An appointment exists.",
    };
  if (f.status === "DEFERRED")
    return { label: `Deferred to ${f.deferred_until}`, className: "bg-violet-100 text-violet-700 ring-violet-200", title: "Pushed to a later date on purpose. It comes back on that date." };
  if (f.dueState === "due_today")
    return { label: "Due today", className: "bg-cyan-100 text-cyan-700 ring-cyan-200", title: "Due on this practice's today." };
  return { label: "Open", className: "bg-slate-100 text-slate-600 ring-slate-200", title: "Committed, not due yet." };
}

/** CPR-MOB-001 s5: how many summary cards a phone leads with before "View more". Four, because the
    fifth is Completed and a work queue leads with what is owed. */
const MOBILE_CARD_LEAD = 4;

const PRIORITY_CHIP: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-700",
  soon: "bg-amber-100 text-amber-700",
  routine: "bg-slate-100 text-slate-500",
};

const dueWord = (f: any, timezone: string) => {
  // The practice closed it on the practice's day. The Completed CARD is counted on the server with
  // the same rule (see follow-up-constants.ts); without this the row underneath showed a different
  // date from the card that counted it.
  if (f.closed) return f.closed_at ? practiceDayOf(timezone, f.closed_at) ?? "" : "";
  if (f.dueInDays === 0) return "Today";
  if (f.dueInDays === 1) return "Tomorrow";
  if (f.dueInDays < 0) return `${Math.abs(f.dueInDays)} ${Math.abs(f.dueInDays) === 1 ? "day" : "days"} overdue`;
  return `in ${f.dueInDays} days`;
};

export default function FollowUpsWorkspace({
  workspace, canManage, initialView, initialSearch, initialPriority, initialSource, initialType, recall,
}: {
  workspace: WorkspaceView;
  canManage: boolean;
  initialView: string;
  initialSearch: string;
  initialPriority: string;
  initialSource: string;
  initialType: string;
  recall: ReactNode;
}) {
  const [view, setView] = useState(initialView);
  const [adding, setAdding] = useState(false);
  // ⚠ THE SAME ctx THE SERVER BUILT, timezone INCLUDED. The tab counts come from the server and the
  // rows are filtered here by the same predicate; if this ctx were missing the zone the client would
  // measure the Completed window differently from the card sitting above it.
  const ctx = useMemo(
    () => ({ today: workspace.today, timezone: workspace.timezone }),
    [workspace.today, workspace.timezone],
  );

  // ── CPR-MOB-001 s5/s11 row 2: THE FILTER ROW BECOMES ONE BUTTON AND A SHEET, BELOW md ────────────
  // Four controls and an Apply are a fifth of a phone screen before a single obligation is on it. The
  // row folds behind ONE trigger that CARRIES THE COUNT, so a narrowed board can never look like the
  // whole board on the one screen size where the controls are out of sight -- the same fear the period
  // navigator's "This is not the whole queue" sentence exists for.
  //
  // ⚠ THE COUNT IS OF THE FILTERS THE SERVER APPLIED, not of what is typed into the sheet. These props
  // are the resolved query the read used; counting the inputs' live values would make the button lie
  // for the seconds between typing and applying.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [allCards, setAllCards] = useState(false);
  const belowMd = useBelowMd();
  useBodyScrollLock(filtersOpen && belowMd);
  const activeFilters = [initialSearch, initialPriority, initialType, initialSource]
    .filter(v => v.trim().length > 0).length;

  // ⚠ ONE LIST, TWO FACES. The desktop tab bar and the below-md chip strip map over THIS, not over
  // FOLLOW_UP_VIEWS twice: a second lookup is a second chance for one face to show a count the other
  // does not. `?? null` folds "no tab came back" into the same em dash an unreadable count renders as,
  // which is what the desktop bar already did inline.
  const tabItems = useMemo(
    () => FOLLOW_UP_VIEWS.map(v => ({
      key: v.key, label: v.label, blurb: v.blurb,
      count: workspace.tabs.find(t => t.key === v.key)?.count ?? null,
    })),
    [workspace.tabs],
  );

  // THE ROWS FOR THIS TAB, from the same predicate the card above used. Not a second query.
  const active = FOLLOW_UP_VIEWS.find(v => v.key === view) ?? FOLLOW_UP_VIEWS[0];
  const rows = useMemo(
    () => workspace.allRows.filter(f => active.match(f as any, ctx)),
    [workspace.allRows, active, ctx],
  );

  const unavailable = workspace.unavailable;

  // ⚠ WHICH SUMMARY CARDS A PHONE MAY FOLD, AND THE TWO THAT ARE NEVER FOLDABLE.
  // Not the one currently filtering the queue -- the summary must always contain the filter in force,
  // or the board looks unfiltered while it is not. And not an unreadable one: an em-dash card is the
  // report of a failed count, and tidying a failure off a small screen is how "I could not find out"
  // becomes "there is nothing".
  const foldable = workspace.cards.filter((c, i) =>
    i >= MOBILE_CARD_LEAD && view !== c.key && c.count !== null).length;

  return (
    <div className="flex flex-col gap-5">
      {/* ── HEADER: search, filters, +Add (s4) ───────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Follow-ups</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Continuity of care &mdash; what you committed to, and whether it has happened. Not an
            appointment book: nothing here books anybody in.
          </p>
        </div>
        <div className="flex items-end gap-2 max-md:w-full max-md:flex-wrap">
          {/* The trigger, below md only. It says how many filters are on IN DIGITS beside the word --
              a coloured dot would put the whole warning on a hue (s4). */}
          <button
            type="button" onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen}
            className={`min-h-[var(--cp-touch)] rounded-lg border px-3 text-[12.5px] font-semibold md:hidden ${
              activeFilters > 0
                ? "border-[var(--cp-primary-border)] bg-[var(--cp-primary)]/5 text-[var(--cp-primary-deep)]"
                : "border-gray-200 bg-white text-gray-700"}`}
          >
            Filters ({activeFilters}) {filtersOpen ? "⌃" : "⌄"}
          </button>
          {/* A real, labelled way out (s17: never gesture-only), mounted only while the panel actually
              IS a sheet -- so a rotation to tablet width cannot strand a backdrop over a visible row. */}
          {filtersOpen && belowMd && (
            <button type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)}
              className="fixed inset-0 z-40 cursor-default bg-black/40 md:hidden" />
          )}
          <form
            method="get"
            onKeyDown={e => { if (e.key === "Escape") setFiltersOpen(false); }}
            className={`${filtersOpen
              ? "flex max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-50 max-md:max-h-[85vh] max-md:flex-col max-md:flex-nowrap max-md:items-stretch max-md:gap-3 max-md:overflow-y-auto max-md:rounded-t-2xl max-md:border-t max-md:border-gray-200 max-md:bg-white max-md:p-4 max-md:pb-[calc(var(--cp-safe-bottom)_+_16px)] max-md:shadow-2xl"
              : "hidden md:flex"} flex-wrap items-end gap-2`}
          >
            <div className="flex w-full items-center justify-between md:hidden">
              <h2 className="text-[15px] font-bold text-gray-900">Filters</h2>
              <button type="button" onClick={() => setFiltersOpen(false)}
                className="flex min-h-[var(--cp-touch)] items-center rounded-lg px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
                Close
              </button>
            </div>
            <label className="flex flex-col gap-0.5 max-md:w-full">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Search</span>
              {/* max-md:text-[16px] is not styling: under 16px iOS zooms the page on focus (s16). */}
              <input
                name="q" defaultValue={initialSearch} placeholder="Patient, reason or type"
                className="w-56 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:min-h-[var(--cp-touch)] max-md:w-full max-md:text-[16px]"
              />
            </label>
            <label className="flex flex-col gap-0.5 max-md:w-full">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Priority</span>
              <select name="priority" defaultValue={initialPriority}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] max-md:min-h-[var(--cp-touch)] max-md:w-full max-md:text-[16px]">
                <option value="">All priorities</option>
                {FOLLOW_UP_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            {/* CPR-FUP-002 s12: the action-type filter. Options are the offered nine plus the
                legacy codes still living on older rows -- a filter that could not select an
                existing row would make that row unfindable. */}
            <label className="flex flex-col gap-0.5 max-md:w-full">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Type</span>
              <select name="type" defaultValue={initialType}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] max-md:min-h-[var(--cp-touch)] max-md:w-full max-md:text-[16px]">
                <option value="">All types</option>
                {FOLLOW_UP_ACTION_TYPES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                <option value="appointment">Appointment (legacy)</option>
                <option value="review">Review (legacy)</option>
                <option value="contact">Contact (legacy)</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5 max-md:w-full">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Source</span>
              <select name="source" defaultValue={initialSource}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] max-md:min-h-[var(--cp-touch)] max-md:w-full max-md:text-[16px]">
                <option value="">All sources</option>
                {FOLLOW_UP_SOURCES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </label>
            <button type="submit" className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold max-md:hidden ${BUTTON.quiet}`}>
              Apply
            </button>
            {/* THE SHEET'S OWN CLOSURE IS A REAL SUBMIT, not a Done that closes over unapplied inputs.
                These filters are a GET form the server reads -- a sheet that dismissed itself without
                submitting would leave the typed narrowing invisible AND unapplied. Two buttons rather
                than one restyled: the desktop control is left byte-identical. */}
            <button
              type="submit"
              className="flex min-h-[var(--cp-touch-primary)] w-full items-center justify-center rounded-xl bg-[var(--cp-primary)] px-4 text-[14px] font-semibold text-white md:hidden"
            >
              Apply filters
            </button>
          </form>
          {/* ⚠ THE ONLY WAY INTO CARE PATHWAYS UNTIL IT HAS A SIDEBAR ENTRY. navigation.ts is not this
              module's to edit; a shipped screen with no way in is the failure that made /practice/setup
              unreachable once already, so it is reached from the workspace it feeds. */}
          <Link href="/practice/pathways"
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center ${BUTTON.quiet}`}>
            Care pathways &rarr;
          </Link>
          {canManage && (
            <button type="button" onClick={() => setAdding(v => !v)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold max-md:min-h-[var(--cp-touch)] ${BUTTON.primary}`}>
              {adding ? "Close" : "+ Add follow-up"}
            </button>
          )}
        </div>
      </header>

      {adding && canManage && <AddFollowUp onClose={() => setAdding(false)} />}

      {unavailable && (
        <p className="rounded-xl bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12.5px] text-[var(--cmp-text-warning)]">
          <span className="font-semibold">The follow-up list could not be read.</span>{" "}
          This is not an empty board &mdash; the read did not return, so nothing below can be trusted to
          be complete.
          {workspace.detail && <span className="mt-0.5 block font-mono text-[11px] opacity-80">{workspace.detail}</span>}
        </p>
      )}

      {/* ── s4's FIVE SUMMARY CARDS ──────────────────────────────────────────────────────────────── */}
      {/* CPR-MOB-001 s5 ("prioritise 3-4 key metrics, hide secondary metrics behind View more") and
          s11 row 4 (care gaps: summary card -> filtered detail list). BELOW md THE GRID IS TWO
          COLUMNS AND THE CARDS ARE COMPACT -- five full-width cards is 500px of counting before a
          single obligation is on screen, on the one board whose purpose is the obligations.
          ⚠ THE CARD IS STILL THE FILTER. Tapping one still sets the tab, so the summary->detail
          mechanism s11 asks for is the one this board already had; nothing about it is mobile-only.
          ⚠ WHAT GETS FOLDED IS THE ONE CARD THAT IS NOT WORK. Cards arrive in FOLLOW_UP_VIEWS order,
          so the tail is "Completed" -- the only card counting things nobody owes anybody. Its count
          is not lost: the tab chip below carries the same figure from the same predicate. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {workspace.cards.map((c, i) => {
          const s = FOLLOWUP_CARD_SWATCH[c.key] ?? CARD_SWATCH_UNKEYED;
          const dead = c.count === null;
          const selected = view === c.key;
          const folded = !allCards && i >= MOBILE_CARD_LEAD && !selected && !dead;
          return (
            <button
              key={c.key} type="button"
              onClick={() => setView(selected ? "all" : c.key)}
              aria-pressed={selected}
              disabled={dead}
              title={c.blurb}
              className={`relative overflow-hidden rounded-2xl border p-4 text-left transition max-md:p-3 ${
                dead ? `${CARE_CARD_UNSUPPLIED.box} cursor-default` : `${s.box} hover:-translate-y-px hover:shadow-md`} ${
                selected ? "ring-2 ring-[var(--cp-primary)]/50 shadow-sm" : ""} ${folded ? "max-md:hidden" : ""}`}
            >
              <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${dead ? CARE_CARD_UNSUPPLIED.accent : s.accent}`} />
              <span className="flex items-start gap-3 pl-1">
                {/* The glyph is decoration and it is the first thing to go: at two columns on a 360px
                    screen its 40px is the difference between "Awaiting action" reading and eliding. */}
                <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[17px] max-md:hidden ${dead ? CARE_CARD_UNSUPPLIED.badge : s.badge}`}>
                  {s.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-gray-700 max-md:whitespace-normal">{c.label}</span>
                  {/* ⚠ AN UNREADABLE FIGURE IS AN EM DASH, NEVER A ZERO. "Nothing is overdue" and "I could
                      not find out what is overdue" are different answers and only one means you can
                      stop looking. */}
                  <span className={`block text-[30px] font-bold leading-none max-md:text-[26px] ${dead ? CARE_CARD_UNSUPPLIED.figure : s.figure}`}>
                    {dead ? <>&mdash;</> : c.count}
                  </span>
                </span>
              </span>
              <span className={`mt-2 block text-[11px] font-medium max-md:mt-1.5 ${dead ? CARE_CARD_UNSUPPLIED.caption : s.caption}`}>
                {dead ? "Could not be read" : selected ? "Filtering the queue" : `${c.count === 1 ? "1 follow-up" : `${c.count} follow-ups`}`}
              </span>
            </button>
          );
        })}
        {foldable > 0 && (
          <button
            type="button" onClick={() => setAllCards(v => !v)} aria-expanded={allCards}
            className="col-span-2 flex min-h-[var(--cp-touch)] items-center justify-center rounded-xl border border-gray-200 bg-white text-[12.5px] font-semibold text-[var(--cp-primary-deep)] md:hidden"
          >
            {allCards
              ? "Show fewer summaries"
              : `View ${foldable} more ${foldable === 1 ? "summary" : "summaries"}`}
          </button>
        )}
      </section>

      {recall}

      {/* ── THE WORK QUEUE (s4, s5) ──────────────────────────────────────────────────────────────── */}
      {/* ⚠ CPR-MOB-001 s11 row 5, ANSWERED BY NOT BUILDING IT: "use selection mode only when
          mobile-safe; otherwise defer complex bulk operations to larger screens."
          THIS BOARD HAS NO BULK OPERATIONS ON ANY SCREEN SIZE. There is no checkbox column, no
          select-all, no multi-row action anywhere in this workspace, and the write API is one
          obligation at a time (PATCH /follow-ups/{id}) -- Complete demands words per row, Defer demands
          a date per row, and both are refusals the engine makes individually. So there is nothing to
          defer and nothing to shrink: adding a phone-only selection mode would be a NEW capability
          needing a new endpoint, which is exactly what s19 forbids a responsive layer from inventing
          ("do not maintain separate mobile pages with duplicate business logic").
          Somebody adding bulk settle later should add it to the desktop table AND this card list from
          one shared handler -- not here, and not mobile-first. */}
      <section className="rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-3 pt-2 max-md:hidden">
          {tabItems.map(t => {
            const on = view === t.key;
            return (
              <button
                key={t.key} type="button" onClick={() => setView(t.key)} title={t.blurb}
                className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-[12.5px] font-semibold transition ${
                  on
                    ? "border-[var(--cp-primary)] text-[var(--cp-primary-deep)]"
                    : "border-transparent text-gray-500 hover:text-gray-800"}`}
              >
                {t.label}
                <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10.5px] font-bold ${on ? "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" : "bg-gray-100 text-gray-500"}`}>
                  {t.count === null ? "—" : t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ══ CPR-MOB-001 s11 row 2: THE SAME TABS AS CHIPS (below md) ═════════════════════════════
            "Status filters -> chips or filter sheet", and this board's status filters ARE its tabs
            (s3's tabs-are-filters doctrine). The underline bar reads as chrome at the top of a table;
            at 360px, wrapped, it reads as nothing at all. Chips carry the same words, the same counts
            and the same setView -- one selected state, in words and fill, never fill alone (s4).

            ⚠ THEY WRAP, THEY DO NOT SCROLL SIDEWAYS. Eight filters in a horizontal scroller puts
            "Closed" and "Drafts" off the right edge behind a gesture with no visible alternative
            (s17). Four rows of chips is taller and tells the truth about how many filters exist. */}
        <div className="flex flex-wrap gap-1.5 border-b border-gray-100 p-3 md:hidden">
          {tabItems.map(t => {
            const on = view === t.key;
            return (
              <button
                key={t.key} type="button" onClick={() => setView(t.key)} title={t.blurb} aria-pressed={on}
                className={`inline-flex min-h-[var(--cp-touch)] items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-semibold ${
                  on
                    ? "border-[var(--cp-primary)] bg-[var(--cp-primary)] text-white"
                    : "border-gray-200 bg-white text-gray-600"}`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold ${on ? "bg-white/25 text-white" : "bg-gray-100 text-gray-500"}`}>
                  {t.count === null ? "—" : t.count}
                </span>
              </button>
            );
          })}
        </div>

        <p className="border-b border-gray-100 px-4 py-2 text-[11.5px] leading-relaxed text-gray-500">
          {active.blurb}
        </p>

        {rows.length === 0 ? (
          // ── s9's EMPTY STATE ──────────────────────────────────────────────────────────────────
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--cp-primary)]/10 text-[22px] text-[var(--cp-primary-deep)]">↻</span>
            <p className="text-[14px] font-semibold text-gray-800">
              {unavailable ? "Nothing could be read" : "No follow-ups in this view"}
            </p>
            <p className="max-w-lg text-[12.5px] leading-relaxed text-gray-500">
              {unavailable
                ? "The read did not return. This is not the same as there being nothing here."
                : <>
                    Follow-ups are created from encounters, investigations, referrals and documents &mdash;
                    they appear here as soon as somebody commits to seeing a patient again. Completed ones
                    stay in history. Today is {workspace.today} in {workspace.timezone}.
                  </>}
            </p>
            {!unavailable && (
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                {canManage && (
                  <button type="button" onClick={() => setAdding(true)}
                    className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.primary}`}>
                    + Add follow-up
                  </button>
                )}
                <button type="button" onClick={() => setView("completed")}
                  className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.quiet}`}>
                  View completed
                </button>
                <Link href="/practice/today"
                  className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.quiet}`}>
                  Open current session
                </Link>
              </div>
            )}
          </div>
        ) : (
          <>
          {/* s8: shared patient-table chrome -- the header holds while a long list scrolls.
              max-md:hidden: this table is 900px wide by declaration, which below md is exactly the
              horizontal scroll s4 forbids for a core workflow. The cards after it are the same rows'
              second face (CPR-MOB-001 s11 row 1). */}
          <div className={`${TABLE_SCROLL} max-md:hidden`}>
            <table className="w-full min-w-[900px] text-left">
              <thead className={THEAD}>
                <tr className="border-b border-gray-100 text-[10.5px] uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2 font-semibold">Patient</th>
                  <th className="px-3 py-2 font-semibold">Reason</th>
                  <th className="px-3 py-2 font-semibold">Due date</th>
                  <th className="px-3 py-2 font-semibold">Priority</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(f => {
                  const chip = statusChip(f);
                  const live = (LIVE_FOLLOW_UP_STATUSES as readonly string[]).includes(f.status);
                  return (
                    <tr key={f.id} className={`border-b border-gray-50 align-top last:border-0 ${f.overdue ? "bg-rose-50/40" : ""}`}>
                      <td className="px-4 py-2.5">
                        <Link href={`/practice/patients/${f.patient_id}`}
                          className="text-[13px] font-semibold text-gray-900 hover:underline">
                          {f.patient_name ?? "Unknown patient"}
                        </Link>
                        <span className="mt-0.5 block text-[10.5px] text-gray-400">{KIND_LABEL[f.kind] ?? f.kind}{f.follow_up_type ? ` · ${FOLLOW_UP_TYPE_LABELS[f.follow_up_type] ?? f.follow_up_type}` : ""}</span>
                      </td>
                      <td className="max-w-[280px] px-3 py-2.5 text-[12.5px] text-gray-700">
                        {f.reason}
                        {f.outcome && <span className="mt-0.5 block text-[11px] text-gray-400">{f.outcome}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className={`block text-[12.5px] font-semibold ${f.overdue ? "text-rose-700" : "text-gray-700"}`}>
                          {f.effectiveDueOn}
                        </span>
                        <span className={`block text-[10.5px] ${f.overdue ? "text-rose-600" : "text-gray-400"}`}>{dueWord(f, workspace.timezone)}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold capitalize ${PRIORITY_CHIP[f.priority] ?? PRIORITY_CHIP.routine}`}>
                          {f.priority}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className="text-[12px] text-gray-600">{SOURCE_LABEL[f.source] ?? f.source}</span>
                        {f.origin_workspace && (
                          <span className="mt-0.5 block text-[10.5px] text-gray-400">from {f.origin_workspace.replace("_", " ")}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span title={chip.title} className={`rounded px-2 py-0.5 text-[10.5px] font-bold ring-1 ${chip.className}`}>
                          {chip.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <RowActions followUp={f} canManage={canManage && live} today={workspace.today} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ══ CPR-MOB-001 s11 row 1: THE SAME OBLIGATIONS AS ACTIONABLE CARDS (below md) ═══════════
              "Actionable cards with patient, condition/reason, due status and primary action" -- over
              `rows`, the SAME array the table above renders, through the SAME statusChip / dueWord /
              PRIORITY_CHIP / SOURCE_LABEL helpers. No second predicate and no second vocabulary: the
              two faces cannot disagree about what "Overdue" means or which rows are in this tab.

              ⚠ THE ACTION STATEMENT IS THE HEADLINE (CPR-FUP-002 s12 / FUP-09). "Ring the family about
              the audiology appointment" is what the practitioner has to DO; "Clinical condition ·
              Contact patient" is how the product files it. On the desktop table the taxonomy sits in
              column one under the name and the reason is column two, which at card width would put the
              filing above the work. So the reason leads at 15px, the taxonomy is a grey supporting
              line, and the patient is a full-size link directly beneath -- present, tappable, and not
              competing with the sentence that says what is owed.

              ⚠ STATUS IS WORDS FIRST, TINT SECOND (s4: never colour alone). The same chip the table
              renders, with the same title text, so a red card and a red row say the identical thing. */}
          <ul className="flex flex-col gap-2.5 p-3 md:hidden">
            {rows.map(f => {
              const chip = statusChip(f);
              const live = (LIVE_FOLLOW_UP_STATUSES as readonly string[]).includes(f.status);
              return (
                <li key={f.id}
                  className={`rounded-xl border p-3.5 ${f.overdue ? "border-rose-200 bg-rose-50/40" : "border-gray-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-gray-900">
                      {f.reason}
                    </p>
                    <span title={chip.title}
                      className={`shrink-0 rounded px-2 py-0.5 text-[10.5px] font-bold ring-1 ${chip.className}`}>
                      {chip.label}
                    </span>
                  </div>
                  {f.outcome && <p className="mt-0.5 text-[12px] text-gray-500">{f.outcome}</p>}
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {KIND_LABEL[f.kind] ?? f.kind}
                    {f.follow_up_type ? ` · ${FOLLOW_UP_TYPE_LABELS[f.follow_up_type] ?? f.follow_up_type}` : ""}
                  </p>

                  <Link href={`/practice/patients/${f.patient_id}`}
                    className="mt-1 inline-flex min-h-[var(--cp-touch)] items-center text-[13.5px] font-semibold text-[var(--cp-primary-deep)] underline-offset-2 hover:underline">
                    {f.patient_name ?? "Unknown patient"}
                  </Link>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`text-[12.5px] font-semibold ${f.overdue ? "text-rose-700" : "text-gray-700"}`}>
                      {f.effectiveDueOn}
                    </span>
                    <span className={`text-[11.5px] ${f.overdue ? "text-rose-600" : "text-gray-500"}`}>{dueWord(f, workspace.timezone)}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold capitalize ${PRIORITY_CHIP[f.priority] ?? PRIORITY_CHIP.routine}`}>
                      {f.priority}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">
                    {SOURCE_LABEL[f.source] ?? f.source}
                    {f.origin_workspace ? ` · from ${f.origin_workspace.replace("_", " ")}` : ""}
                  </p>

                  {/* THE SAME RowActions THE TABLE ROW USES -- one guarded fetch, one set of refusal
                      rules, one Complete that still demands words. It carries its own below-md face
                      (a full-width Reschedule first, everything else at thumb height). */}
                  <RowActions followUp={f} canManage={canManage && live} today={workspace.today} />
                </li>
              );
            })}
          </ul>
          </>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
          <span>
            Showing {rows.length} of {workspace.readCount} follow-ups read.
          </span>
          <span>All dates are this practice&rsquo;s own day in {workspace.timezone} &mdash; {workspace.today}.</span>
          <span>Follow-ups are not appointments.</span>
          {workspace.truncated && (
            <span className="font-semibold text-[var(--cmp-text-warning)]">
              The read limit was reached, so every figure above is a floor rather than a total.
            </span>
          )}
        </div>
      </section>

      {/* ── THE HONEST VERSION OF THE COMP'S "COMPLETION" DONUT ──────────────────────────────────── */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Settled in the last 30 days</h2>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">
            {/* ⚠ NO RATE, NO RING, NO PERCENTAGE. The design draws a completion donut labelled with a
                figure. A completion RATE needs a denominator -- everything that was due in the window,
                including what is still open and what was raised after -- and this engine does not
                compute one. Three counts and the words for what each counts is the honest form of the
                same panel. */}
            Counts, not a rate. A completion percentage would need a denominator this engine does not
            compute, and a number labelled as a rate is read as one.
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {[
              ["Completed", workspace.cards.find(c => c.key === "completed")?.count ?? null, "text-emerald-700", "bg-emerald-50/70 border-emerald-200/80"],
              ["Still open", workspace.allRows.filter(f => (LIVE_FOLLOW_UP_STATUSES as readonly string[]).includes(f.status)).length, "text-[var(--cp-primary-deep)]", "bg-[var(--cp-primary)]/[0.06] border-[var(--cp-primary)]/25"],
              ["Overdue", workspace.cards.find(c => c.key === "overdue")?.count ?? null, "text-rose-700", "bg-rose-50 border-rose-200"],
            ].map(([label, n, figure, box]) => (
              <div key={String(label)} className={`rounded-xl border p-3 ${box}`}>
                <dd className={`text-[26px] font-bold leading-none ${figure}`}>{n === null ? <>&mdash;</> : String(n)}</dd>
                <dt className="mt-1 text-[11px] font-semibold text-gray-600">{String(label)}</dt>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Where these came from</h2>
          <p className="mt-0.5 text-[11.5px] text-gray-500">
            CPR-FUP-002 s3: encounters are the primary source. Every figure is the rows carrying that
            source in what was read.
          </p>
          <ul className="mt-2 flex flex-col">
            {FOLLOW_UP_SOURCES.map(([code, label]) => {
              const n = workspace.allRows.filter(f => f.source === code).length;
              if (n === 0) return null;
              return (
                <li key={code} className="flex items-baseline gap-2 border-b border-gray-50 py-1.5 last:border-0">
                  <span className="text-[12.5px] text-gray-700">{label}</span>
                  <span className="ml-auto text-[12.5px] font-bold text-gray-800">{n}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-gray-400">
            A source with no rows is not listed. Documents, investigations and referrals will appear here
            as those modules start raising obligations &mdash; the vocabulary already holds them.
          </p>
        </div>
      </section>

      <p className="text-[11px] leading-relaxed text-gray-400">
        &ldquo;Overdue&rdquo;, &ldquo;due today&rdquo; and &ldquo;due this week&rdquo; ({DUE_WEEK_DAYS} days,
        today included) are worked out from the due date against today in {workspace.timezone}, every time
        this page is read. Nothing is stored and nothing has to run &mdash; which is why a practice that
        has not opened this app for a fortnight sees the whole backlog the moment it does.
      </p>
    </div>
  );
}
