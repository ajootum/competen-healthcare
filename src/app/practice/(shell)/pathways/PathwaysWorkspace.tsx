"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PathwayWorkspace as WorkspaceView, PatientPathwayView } from "@/lib/practice/pathways";
import { AT_RISK_REFUSAL, PATHWAY_TRIGGERS } from "@/lib/practice/pathways-constants";
import { PATHWAY_CARD_SWATCH, CARD_SWATCH_UNKEYED, CARE_CARD_UNSUPPLIED, BUTTON } from "@/lib/practice/palette";
import StageTrack from "./StageTrack";
import PatientPathwayPanel, { ProgressChip } from "./PatientPathwayPanel";
import AssignPathway from "./AssignPathway";
import TemplateDesigner from "./TemplateDesigner";
import { THEAD, TABLE_SCROLL } from "@/components/practice/PatientTable";

// CPR-FUP-003 s12 -- the Care Pathways workspace.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ FIVE CARDS, AND THE DESIGN HAS FIVE TOO -- BUT THEY ARE NOT THE SAME FIVE.
//
// The comp draws: Active Pathways (24, across 18 patients) · On Track · At Risk · Overdue · Completed.
//
//   "Across 18 patients" IS A SECOND FIGURE OVER A DIFFERENT THING, and it gets its own card rather than
//   being a caption under the first. A count of enrolments and a count of people are different numbers
//   the moment one patient is on two plans -- which s11 exists to permit -- and a caption is exactly
//   where a second figure goes to be misread as a restatement of the first.
//
//   "AT RISK" IS NOT RENDERED. It is a judgement, and there is no date rule that produces it. See
//   AT_RISK_REFUSAL: the refusal is printed on the page rather than left as a silent omission, because
//   the design shows the chip and somebody will otherwise put it back.
//
// ⚠ EVERY FIGURE IS THE LENGTH OF A LIST. Each card carries the ids it counted and clicking it filters
// the table to exactly those rows -- the same array, not a second query.
//
// ⚠ COLOUR: tinted card, tinted icon badge, and THE FIGURE IN THE CARD'S HUE. It is decided in
// palette.ts, not here: PATHWAY_CARD_SWATCH is keyed on PATHWAY_CARD_SHAPE's own five keys, with the
// reason for each hue written beside it. This page used to hold a private map pointing each card at some
// OTHER card's entry -- "Completed" borrowed `resultsToReview` because that entry happens to be sky --
// which drew the right colour while leaving the decision in a component under a key naming something
// else. The harness now asserts the two key sets are identical in both directions.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const TRIGGER_LABEL = Object.fromEntries(PATHWAY_TRIGGERS.map(([c, l]) => [c, l])) as Record<string, string>;

export default function PathwaysWorkspace({
  workspace, canAssign, canDesign, initialTab, initialSearch, initialOpen,
}: {
  workspace: WorkspaceView;
  canAssign: boolean;
  canDesign: boolean;
  initialTab: "patients" | "templates";
  initialSearch: string;
  initialOpen: string | null;
}) {
  const [tab, setTab] = useState(initialTab);
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialOpen);
  const [assigning, setAssigning] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);

  const rows = useMemo(() => {
    let list = workspace.pathways;
    if (activeOnly) list = list.filter(p => p.status === "active");
    if (cardFilter) {
      // ⚠ FILTERED BY THE CARD'S OWN IDS. Re-deriving the predicate here is how a card and the list it
      // opens start disagreeing; the engine already named the rows it counted, so those are the rows.
      const ids = new Set(workspace.cards.find(c => c.key === cardFilter)?.ids ?? []);
      list = cardFilter === "patients"
        ? list.filter(p => ids.has(p.patient_id))
        : list.filter(p => ids.has(p.id));
    }
    return list;
  }, [workspace.pathways, workspace.cards, cardFilter, activeOnly]);

  const open: PatientPathwayView | null = selected
    ? workspace.pathways.find(p => p.id === selected) ?? null
    : null;
  const openPatientPathways = open
    ? { items: workspace.pathways.filter(p => p.patient_id === open.patient_id), unavailable: false, detail: null }
    : null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Care pathways</h1>
          <p className="mt-0.5 max-w-2xl text-[13px] text-gray-500">
            Design, assign and track continuity pathways. A pathway is a <strong>plan</strong>, not a
            protocol &mdash; every stage can be skipped, repeated, delayed or cancelled, and the record
            of that is the point.
          </p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          <label className="flex flex-col gap-0.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Search</span>
            <input name="q" defaultValue={initialSearch} placeholder="Patient or pathway"
              className="w-56 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10" />
          </label>
          <button type="submit" className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.quiet}`}>Apply</button>
        </form>
      </header>

      {workspace.unavailable && (
        <p className="rounded-xl bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12.5px] text-[var(--cmp-text-warning)]">
          <span className="font-semibold">The pathways could not be read.</span>{" "}
          This is not an empty practice &mdash; the read did not return.
          {workspace.detail && <span className="mt-0.5 block font-mono text-[11px] opacity-80">{workspace.detail}</span>}
        </p>
      )}

      {/* ── THE FIVE CARDS ───────────────────────────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {workspace.cards.map(c => {
          const s = PATHWAY_CARD_SWATCH[c.key] ?? CARD_SWATCH_UNKEYED;
          const dead = c.count === null;
          const on = cardFilter === c.key;
          return (
            <button
              key={c.key} type="button" disabled={dead} title={c.blurb}
              onClick={() => { setCardFilter(on ? null : c.key); setTab("patients"); if (c.key === "completed") setActiveOnly(false); }}
              className={`relative overflow-hidden rounded-2xl border p-4 text-left transition ${
                dead ? `${CARE_CARD_UNSUPPLIED.box} cursor-default` : `${s.box} hover:-translate-y-px hover:shadow-md`} ${
                on ? "ring-2 ring-[var(--cp-primary)]/50 shadow-sm" : ""}`}
            >
              <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${dead ? CARE_CARD_UNSUPPLIED.accent : s.accent}`} />
              <span className="flex items-start gap-3 pl-1">
                <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[17px] ${dead ? CARE_CARD_UNSUPPLIED.badge : s.badge}`}>
                  {s.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-gray-700">{c.label}</span>
                  <span className={`block text-[30px] font-bold leading-none ${dead ? CARE_CARD_UNSUPPLIED.figure : s.figure}`}>
                    {dead ? <>&mdash;</> : c.count}
                  </span>
                </span>
              </span>
              <span className={`mt-2 block text-[11px] font-medium ${dead ? CARE_CARD_UNSUPPLIED.caption : s.caption}`}>
                {dead ? "Could not be read" : on ? "Filtering the table" : c.key === "patients" ? "distinct people" : "pathways"}
              </span>
            </button>
          );
        })}
      </section>

      {/* ⚠ THE REFUSAL IS ON THE PAGE, NOT ONLY IN A COMMENT. */}
      <details className="group -mt-2">
        <summary className="cursor-pointer list-none text-[11px] font-semibold text-gray-500 hover:text-gray-700">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">&rsaquo;</span>
          The design has an &ldquo;At risk&rdquo; card between On track and Overdue. Why it is not here.
        </summary>
        <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-gray-500">{AT_RISK_REFUSAL}</p>
      </details>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {/* min-w-0: a grid item defaults to min-width:auto, so without this the 820px table inside
            TABLE_SCROLL sets the column's floor, the overflow-x-auto never engages and the PAGE
            scrolls sideways instead of the table. Same shape as the EncounterConsole fix. */}
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-3 pt-2">
            {([["patients", "My patients"], ["templates", "Pathway templates"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-[12.5px] font-semibold transition ${
                  tab === k ? "border-[var(--cp-primary)] text-[var(--cp-primary-deep)]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
                {label}
                <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10.5px] font-bold ${tab === k ? "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" : "bg-gray-100 text-gray-500"}`}>
                  {k === "patients" ? rows.length : workspace.templatesUnavailable ? "—" : workspace.templates.length}
                </span>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 pb-1.5">
              {tab === "patients" && (
                <label className="flex items-center gap-1.5 text-[11.5px] text-gray-500">
                  <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
                  Show only active
                </label>
              )}
              {tab === "patients" && canAssign && (
                <button type="button" onClick={() => setAssigning(v => !v)}
                  className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${BUTTON.primary}`}>
                  {assigning ? "Close" : "+ Assign a pathway"}
                </button>
              )}
              {tab === "templates" && canDesign && (
                <button type="button" onClick={() => setDesigning(v => !v)}
                  className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${BUTTON.primary}`}>
                  {designing ? "Close" : "+ New template"}
                </button>
              )}
            </div>
          </div>

          {tab === "patients" && assigning && canAssign && (
            <div className="border-b border-gray-100 p-3">
              <AssignPathway templates={workspace.templates} onClose={() => setAssigning(false)} />
            </div>
          )}
          {tab === "templates" && designing && canDesign && (
            <div className="border-b border-gray-100 p-3">
              <TemplateDesigner onClose={() => setDesigning(false)} />
            </div>
          )}

          {tab === "patients" ? (
            rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--cp-primary)]/10 text-[22px] text-[var(--cp-primary-deep)]">⁂</span>
                <p className="text-[14px] font-semibold text-gray-800">
                  {workspace.unavailable ? "Nothing could be read" : "No patient is on a pathway here"}
                </p>
                <p className="max-w-lg text-[12.5px] leading-relaxed text-gray-500">
                  {workspace.unavailable
                    ? "The read did not return. This is not the same as there being nothing here."
                    : cardFilter
                      ? "No pathway matches the card you selected. Clear it to see the rest."
                      : "Pathways keep long-term care on track: a plan generates its own follow-ups as the patient moves through it. Assignment is always a decision somebody makes — nothing is put on a pathway automatically."}
                </p>
                {cardFilter && (
                  <button type="button" onClick={() => setCardFilter(null)}
                    className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.quiet}`}>
                    Clear the card filter
                  </button>
                )}
              </div>
            ) : (
              // s8: shared patient-table chrome -- the header holds while a long list scrolls.
              <div className={TABLE_SCROLL}>
                <table className="w-full min-w-[820px] text-left">
                  <thead className={THEAD}>
                    <tr className="border-b border-gray-100 text-[10.5px] uppercase tracking-wide text-gray-400">
                      <th className="px-4 py-2 font-semibold">Patient</th>
                      <th className="px-3 py-2 font-semibold">Pathway</th>
                      <th className="px-3 py-2 font-semibold">Progress</th>
                      <th className="px-3 py-2 font-semibold">Next review</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(p => (
                      <tr key={p.id} className={`border-b border-gray-50 align-top last:border-0 ${p.progress === "overdue" ? "bg-rose-50/40" : ""} ${selected === p.id ? "bg-[var(--cp-primary)]/[0.04]" : ""}`}>
                        <td className="px-4 py-2.5">
                          <Link href={`/practice/patients/${p.patient_id}`} className="text-[13px] font-semibold text-gray-900 hover:underline">
                            {p.patient_name ?? "Unknown patient"}
                          </Link>
                          <span className="mt-0.5 block text-[10.5px] text-gray-400">
                            started {p.started_on} &middot; {TRIGGER_LABEL[p.trigger] ?? p.trigger}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[12.5px] font-semibold text-[var(--cp-primary-deep)]">{p.template_name}</span>
                          {p.specialty && <span className="mt-0.5 block text-[10.5px] text-gray-400">{p.specialty}</span>}
                        </td>
                        <td className="px-3 py-2.5"><StageTrack pathway={p} compact /></td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span className={`block text-[12.5px] font-semibold ${p.progress === "overdue" ? "text-rose-700" : "text-gray-700"}`}>
                            {p.stageDueOn ?? "no date"}
                          </span>
                          <span className="block text-[10.5px] text-gray-400">{p.stageName ?? "—"}</span>
                        </td>
                        <td className="px-3 py-2.5"><ProgressChip progress={p.progress} /></td>
                        <td className="px-3 py-2.5 text-right">
                          <button type="button" onClick={() => setSelected(selected === p.id ? null : p.id)}
                            className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                            {selected === p.id ? "Close" : "View pathway"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="p-3">
              {workspace.templatesUnavailable ? (
                <p className="text-[12px] text-[var(--cmp-text-warning)]">
                  <span className="font-semibold">The template catalogue could not be read.</span>{" "}
                  This is not an empty catalogue.
                  {workspace.templatesDetail && <span className="mt-0.5 block font-mono text-[11px] opacity-80">{workspace.templatesDetail}</span>}
                </p>
              ) : workspace.templates.length === 0 ? (
                <p className="py-8 text-center text-[12.5px] text-gray-400">
                  No pathway templates yet. A template is a sequence of stages with timing &mdash; VP shunt
                  follow-up, epilepsy management, developmental surveillance.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {workspace.templates.map(t => (
                    <li key={t.id} className={`rounded-xl border p-3 ${t.is_active ? "border-gray-200 bg-white" : "border-dashed border-slate-300 bg-slate-50/60"}`}>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-[13px] font-bold text-gray-900">{t.name}</h3>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">v{t.version}</span>
                        {!t.is_active && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">retired</span>}
                        {t.specialty && <span className="text-[11px] text-gray-400">{t.specialty}</span>}
                        <span className="ml-auto text-[11.5px] font-semibold text-gray-600">
                          {/* ⚠ PEOPLE, NOT ENROLMENTS. A patient re-enrolled on the same plan years later
                              would make an enrolment count say one more than there are people. */}
                          {t.activePatientIds.length} {t.activePatientIds.length === 1 ? "patient" : "patients"}
                        </span>
                      </div>
                      {t.entry_criteria && (
                        <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                          <span className="font-semibold text-gray-600">Entry criteria (read, never evaluated):</span>{" "}
                          {t.entry_criteria}
                        </p>
                      )}
                      <ol className="mt-1.5 flex flex-wrap gap-1.5">
                        {t.stages.map(s => (
                          <li key={s.id} className="rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
                            <span className="font-semibold text-gray-700">{s.position}. {s.name}</span>
                            <span className="ml-1 text-gray-400">
                              +{s.offset_days}d{s.follow_up_kind ? ` · raises a ${s.follow_up_kind.replace(/_/g, " ")}` : " · raises nothing"}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-400">
                Publishing a change to a template makes a NEW version and retires the old one. Patients
                already walking the old version keep it &mdash; the plan somebody is halfway through is
                never rewritten underneath them.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
            <span>On track and Overdue are the current stage&rsquo;s due date against {workspace.today} in {workspace.timezone}.</span>
            <span>Nothing runs; nothing is stored.</span>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          {open && openPatientPathways ? (
            <PatientPathwayPanel
              pathways={openPatientPathways}
              canAssign={canAssign}
              patientName={open.patient_name}
            />
          ) : (
            <section className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 p-4">
              <h2 className="text-[13px] font-bold text-gray-900">Pathways keep long-term care on track</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
                Choose <span className="font-semibold">View pathway</span> on a row to see that patient&rsquo;s
                plan, every stage they actually reached, and the actions available on the live one.
              </p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
                A pathway generates the follow-ups; the Follow-ups workspace is where those obligations
                are worked. The two are the same care seen at two scales.
              </p>
              <Link href="/practice/follow-ups" className="mt-2 inline-block text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                Open Follow-ups &rarr;
              </Link>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
