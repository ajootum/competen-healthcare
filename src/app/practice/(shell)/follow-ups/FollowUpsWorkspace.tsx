"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  FOLLOW_UP_VIEWS, FOLLOW_UP_KINDS, FOLLOW_UP_SOURCES, FOLLOW_UP_PRIORITIES,
  LIVE_FOLLOW_UP_STATUSES, DUE_WEEK_DAYS,
} from "@/lib/practice/follow-up-constants";
import type { FollowUpWorkspace as WorkspaceView } from "@/lib/practice/follow-ups";
import { FOLLOWUP_CARD_SWATCH, CARD_SWATCH_UNKEYED, CARE_CARD_UNSUPPLIED, BUTTON } from "@/lib/practice/palette";
import AddFollowUp from "./AddFollowUp";
import RowActions from "./RowActions";

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

const PRIORITY_CHIP: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-700",
  soon: "bg-amber-100 text-amber-700",
  routine: "bg-slate-100 text-slate-500",
};

const dueWord = (f: any) => {
  if (f.closed) return f.closed_at ? String(f.closed_at).slice(0, 10) : "";
  if (f.dueInDays === 0) return "Today";
  if (f.dueInDays === 1) return "Tomorrow";
  if (f.dueInDays < 0) return `${Math.abs(f.dueInDays)} ${Math.abs(f.dueInDays) === 1 ? "day" : "days"} overdue`;
  return `in ${f.dueInDays} days`;
};

export default function FollowUpsWorkspace({
  workspace, canManage, initialView, initialSearch, initialPriority, initialSource, recall,
}: {
  workspace: WorkspaceView;
  canManage: boolean;
  initialView: string;
  initialSearch: string;
  initialPriority: string;
  initialSource: string;
  recall: ReactNode;
}) {
  const [view, setView] = useState(initialView);
  const [adding, setAdding] = useState(false);
  const ctx = useMemo(() => ({ today: workspace.today }), [workspace.today]);

  // THE ROWS FOR THIS TAB, from the same predicate the card above used. Not a second query.
  const active = FOLLOW_UP_VIEWS.find(v => v.key === view) ?? FOLLOW_UP_VIEWS[0];
  const rows = useMemo(
    () => workspace.allRows.filter(f => active.match(f as any, ctx)),
    [workspace.allRows, active, ctx],
  );

  const unavailable = workspace.unavailable;

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
        <div className="flex items-end gap-2">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Search</span>
              <input
                name="q" defaultValue={initialSearch} placeholder="Patient, reason or type"
                className="w-56 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Priority</span>
              <select name="priority" defaultValue={initialPriority}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)]">
                <option value="">All priorities</option>
                {FOLLOW_UP_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Source</span>
              <select name="source" defaultValue={initialSource}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)]">
                <option value="">All sources</option>
                {FOLLOW_UP_SOURCES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </label>
            <button type="submit" className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.quiet}`}>
              Apply
            </button>
          </form>
          {/* ⚠ THE ONLY WAY INTO CARE PATHWAYS UNTIL IT HAS A SIDEBAR ENTRY. navigation.ts is not this
              module's to edit; a shipped screen with no way in is the failure that made /practice/setup
              unreachable once already, so it is reached from the workspace it feeds. */}
          <Link href="/practice/pathways"
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.quiet}`}>
            Care pathways &rarr;
          </Link>
          {canManage && (
            <button type="button" onClick={() => setAdding(v => !v)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.primary}`}>
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
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {workspace.cards.map(c => {
          const s = FOLLOWUP_CARD_SWATCH[c.key] ?? CARD_SWATCH_UNKEYED;
          const dead = c.count === null;
          const selected = view === c.key;
          return (
            <button
              key={c.key} type="button"
              onClick={() => setView(selected ? "all" : c.key)}
              aria-pressed={selected}
              disabled={dead}
              title={c.blurb}
              className={`relative overflow-hidden rounded-2xl border p-4 text-left transition ${
                dead ? `${CARE_CARD_UNSUPPLIED.box} cursor-default` : `${s.box} hover:-translate-y-px hover:shadow-md`} ${
                selected ? "ring-2 ring-[var(--cp-primary)]/50 shadow-sm" : ""}`}
            >
              <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${dead ? CARE_CARD_UNSUPPLIED.accent : s.accent}`} />
              <span className="flex items-start gap-3 pl-1">
                <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[17px] ${dead ? CARE_CARD_UNSUPPLIED.badge : s.badge}`}>
                  {s.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-gray-700">{c.label}</span>
                  {/* ⚠ AN UNREADABLE FIGURE IS AN EM DASH, NEVER A ZERO. "Nothing is overdue" and "I could
                      not find out what is overdue" are different answers and only one means you can
                      stop looking. */}
                  <span className={`block text-[30px] font-bold leading-none ${dead ? CARE_CARD_UNSUPPLIED.figure : s.figure}`}>
                    {dead ? <>&mdash;</> : c.count}
                  </span>
                </span>
              </span>
              <span className={`mt-2 block text-[11px] font-medium ${dead ? CARE_CARD_UNSUPPLIED.caption : s.caption}`}>
                {dead ? "Could not be read" : selected ? "Filtering the queue" : `${c.count === 1 ? "1 follow-up" : `${c.count} follow-ups`}`}
              </span>
            </button>
          );
        })}
      </section>

      {recall}

      {/* ── THE WORK QUEUE (s4, s5) ──────────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-3 pt-2">
          {FOLLOW_UP_VIEWS.map(v => {
            const tab = workspace.tabs.find(t => t.key === v.key);
            const on = view === v.key;
            return (
              <button
                key={v.key} type="button" onClick={() => setView(v.key)} title={v.blurb}
                className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-[12.5px] font-semibold transition ${
                  on
                    ? "border-[var(--cp-primary)] text-[var(--cp-primary-deep)]"
                    : "border-transparent text-gray-500 hover:text-gray-800"}`}
              >
                {v.label}
                <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10.5px] font-bold ${on ? "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" : "bg-gray-100 text-gray-500"}`}>
                  {tab?.count === null || tab === undefined ? "—" : tab.count}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
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
                        <span className="mt-0.5 block text-[10.5px] text-gray-400">{KIND_LABEL[f.kind] ?? f.kind}</span>
                      </td>
                      <td className="max-w-[280px] px-3 py-2.5 text-[12.5px] text-gray-700">
                        {f.reason}
                        {f.outcome && <span className="mt-0.5 block text-[11px] text-gray-400">{f.outcome}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className={`block text-[12.5px] font-semibold ${f.overdue ? "text-rose-700" : "text-gray-700"}`}>
                          {f.effectiveDueOn}
                        </span>
                        <span className={`block text-[10.5px] ${f.overdue ? "text-rose-600" : "text-gray-400"}`}>{dueWord(f)}</span>
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
