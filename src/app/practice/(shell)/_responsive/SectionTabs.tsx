"use client";

import { useId } from "react";

// CPR-MOB-001 s5 — "Horizontal tab bar → Scrollable tabs → Scrollable short tabs or section
// selector/dropdown for large tab sets."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// TWO RENDERINGS OF ONE CHOICE, AND THE TAB COUNT DECIDES. A short set stays a tab row at every width
// — s5 explicitly allows scrollable short tabs, and the row scrolls in its own box rather than
// scrolling the page (s4 forbids horizontal scroll for the WORKFLOW, not inside a tab strip). A large
// set — the Documents workspace's seven is the case s12 names — becomes a labelled <select> below md,
// because seven tabs at phone width is either an illegible squeeze or a strip where the current
// section is off-screen. The select is the native control s4 asks for, it announces every option, and
// the current choice is always visible in it.
//
// THE LABEL IS VISIBLE ON THE SELECT AND NAMES THE GROUP OF TABS — placeholders are not labels (s16),
// and "which set of sections am I switching" is exactly what a person mid-task needs the control to
// say.
//
// STATE LIVES IN THE ADOPTING PAGE. Both renderings drive the same `onSelect`, so a phone rotated to
// tablet mid-task keeps its section — s19's filter/state persistence across responsive transitions,
// honoured by there being only one piece of state to persist.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type SectionTab = {
  id: string;
  label: string;
  /** A live count where one exists. Null or zero renders no count — a zero badge is noise. */
  count?: number | null;
};

export default function SectionTabs({ tabs, active, onSelect, label, selectThreshold = 5 }: {
  tabs: SectionTab[];
  active: string;
  onSelect: (id: string) => void;
  /** Accessible name for the tab group, and the VISIBLE label on the mobile select. */
  label: string;
  /** Above this many tabs the below-md rendering degrades to the select. */
  selectThreshold?: number;
}) {
  const selectId = useId();
  const large = tabs.length > selectThreshold;

  return (
    <>
      {/* The tab row. For large sets it exists only from md up; the select below stands in under it. */}
      <div
        role="group"
        aria-label={label}
        className={`${large ? "hidden md:flex" : "flex"} items-center gap-1 overflow-x-auto border-b border-gray-200`}
      >
        {tabs.map(t => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              aria-pressed={on}
              className={`-mb-px flex min-h-[var(--cp-touch)] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[12.5px] font-semibold transition ${
                on
                  ? "border-[var(--cp-primary)] text-[var(--cp-primary-deep)]"
                  : "border-transparent text-gray-500 hover:text-gray-800"}`}
            >
              {t.label}
              {typeof t.count === "number" && t.count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  on ? "bg-[var(--cp-primary-soft)] text-[var(--cp-primary-deep)]" : "bg-gray-100 text-gray-600"}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {large && (
        <div className="md:hidden">
          <label htmlFor={selectId} className="mb-1 block text-[11px] font-semibold text-gray-600">
            {label}
          </label>
          <select
            id={selectId}
            value={active}
            onChange={e => onSelect(e.target.value)}
            className="min-h-[var(--cp-touch)] w-full rounded-lg border border-gray-300 bg-white px-3 text-[14px] text-gray-900"
          >
            {tabs.map(t => (
              <option key={t.id} value={t.id}>
                {t.label}{typeof t.count === "number" && t.count > 0 ? ` (${t.count})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
