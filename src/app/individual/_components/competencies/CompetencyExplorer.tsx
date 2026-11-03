"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Chip, focusRing, mutedText } from "@/components/assessment/ui";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { experienceHref } from "@/lib/individual/experiences";
import { withStudy } from "@/lib/individual/scholar/study-carry";
import {
  EXPLORER_HEADING, EXPLORER_INTRO, FILTERS, FILTER_LABEL, HOW_PROGRESS_WORKS, INDICATOR_LABEL, SORTS, SORT_LABEL, applyQuery, countRows, indicatorLine, parseExplorerState, storageKey,
  type ExplorerArea, type ExplorerFilter, type ExplorerFramework, type ExplorerModel, type ExplorerRow, type ExplorerSort, type ExplorerState,
} from "@/lib/individual/scholar/competency-explorer";
import { EVIDENCE_CLASS_LABEL, NO_MAPPED_EVIDENCE, NO_SELF_RATING, SELF_CLASS_LABEL, STAGE_BLOCK_TITLE, STAGE_STALE_NOTE } from "@/lib/assessment/adapters/scholar/vocab";
import type { ExplorerDetail } from "@/app/individual/(app)/[experience]/(scholar)/my-competencies/explorer-data";
import StartButton from "./StartButton";

// MY COMPETENCIES EXPLORER -- SCHOLAR-COMPETENCY-EXPLORER-HFE-01 (owner instruction 3 Nov 2026).
//
// The learner's programme exactly as Holdings organised it: Framework -> Area (two prominent tabs) -> Domain (expandable
// groups) -> Competency (compact banded rows), in the SAVED order. Search, filters and sorting work on the client over
// the one payload the server built (no request on expanding a domain), and keep every Area -> Domain -> Competency
// relationship. Selecting a row opens a drawer without leaving the page, so Area, domain, search, filters and scroll are
// where they were when it closes. Navigation state is remembered per framework in the browser.
//
// Tablet and desktop first: 44px targets on touch (pointer-coarse), one md breakpoint, nothing wider than the screen.
// Every action in the drawer is an existing Scholar function; an action that would not work is not drawn.

type Props = {
  model: ExplorerModel; details: Record<string, ExplorerDetail>;
  scaleMax: number; study: string | null; assessmentsBase: string;
  structureUnreadable: boolean; practiceUnreadable: boolean;
  /** Said once beside the summary when no competency of the programme has an expected level configured. */
  expectedConfigured: boolean;
};

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const control = `rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 text-[13.5px] text-[var(--cmp-app-text)] min-h-10 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const linkBtn = `inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 text-[13px] font-semibold text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const primaryLink = `inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--cmp-theme-accent)] px-3 text-[13px] font-semibold text-[var(--cmp-theme-on-accent)] hover:opacity-90 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

function readState(frameworkId: string): Partial<ExplorerState> | null {
  try { const raw = window.localStorage.getItem(storageKey(frameworkId)); return raw ? parseExplorerState(JSON.parse(raw)) : null; } catch { return null; }
}
function writeState(frameworkId: string, s: ExplorerState) {
  try { window.localStorage.setItem(storageKey(frameworkId), JSON.stringify(s)); } catch { /* a browser that refuses storage still works */ }
}

/** The one concise self-assessment status for a row. */
function selfStatus(r: ExplorerRow, scaleMax: number): { text: string; tone: "info" | "neutral" } {
  if (r.facts.selfLatestRating !== null) return { text: `Self: ${r.facts.selfLatestRating} of ${scaleMax}`, tone: "info" };
  if (r.ind.self_assessed) return { text: "Self-assessed, no rating", tone: "info" };
  if (r.facts.selfOpen) return { text: "Self-assessment open", tone: "info" };
  return { text: "Not self-assessed", tone: "neutral" };
}
/** The one concise learning / practice indicator for a row: the strongest that holds. */
function evidenceStatus(r: ExplorerRow): { text: string; tone: "success" | "accent" | "neutral" } | null {
  if (r.ind.evidence_available) return { text: INDICATOR_LABEL.evidence_available, tone: "success" };
  if (r.ind.practised) return { text: INDICATOR_LABEL.practised, tone: "accent" };
  if (r.ind.learning_started) return { text: INDICATOR_LABEL.learning_started, tone: "accent" };
  if (r.ind.material_linked) return { text: INDICATOR_LABEL.material_linked, tone: "neutral" };
  return null;
}
/** The contextual action on a row: the next sensible step through an existing function. */
function rowAction(r: ExplorerRow, d: ExplorerDetail | undefined, study: string | null, assessmentsBase: string): { label: string; href: string } {
  if (d?.selfOpenInstanceId) return { label: "Continue self-assessment", href: `${assessmentsBase}/${d.selfOpenInstanceId}` };
  if (r.ind.evidence_available || r.ind.self_assessed) return { label: "View evidence", href: experienceHref("scholar", "my-competencies/evidence") };
  if (r.ind.material_linked || r.ind.learning_started) return { label: "Practise", href: withStudy(experienceHref("scholar", "study/revise"), study) };
  return { label: "Learn", href: withStudy(experienceHref("scholar", `study/learn?competency=${encodeURIComponent(r.id)}`), study) };
}

export default function CompetencyExplorer({ model, details, scaleMax, study, assessmentsBase, structureUnreadable, practiceUnreadable, expectedConfigured }: Props) {
  const uid = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const s = model.summary;
  return (
    <section aria-labelledby={`${uid}-h`} className="mt-6">
      <h2 id={`${uid}-h`} className="text-[20px] font-bold tracking-tight text-gray-900">{EXPLORER_HEADING}</h2>
      <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-gray-600">{EXPLORER_INTRO}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Progress summary">
        {[[s.total, "Competencies"], [s.selfAssessed, "Self-assessed"], [s.learningActivity, "With learning activity"], [s.evidence, "With demonstrated evidence"]].map(([n, l]) => (
          <div key={String(l)} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
            <dt className="text-[12px] font-semibold text-gray-600">{l}</dt>
            <dd className="text-[20px] font-bold tabular-nums text-gray-900">{n}</dd>
          </div>
        ))}
      </dl>
      <p className={`mt-2 text-[12.5px] ${mutedText}`}>
        {s.verified > 0 ? `${s.verified} verified. ` : "No competency is independently verified yet. "}
        {s.notStarted === s.total ? "Nothing is recorded yet, which only means you have not started." : s.notStarted > 0 ? `${s.notStarted} not started yet.` : ""}
        {!expectedConfigured ? " Expected proficiency is not configured for your programme yet." : ""}
        {practiceUnreadable ? " OSCE runs and clinical cases could not be read just now, so those indicators rest on your notes and self-assessments." : ""}
      </p>
      <details className="mt-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px]">
        <summary className={`cursor-pointer font-semibold text-gray-800 ${focusRing}`}>How progress works</summary>
        <dl className="mt-2 space-y-1.5 text-gray-700">
          {HOW_PROGRESS_WORKS.map(h => <div key={h.title}><dt className="inline font-semibold text-gray-900">{h.title}: </dt><dd className="inline">{h.text}</dd></div>)}
        </dl>
      </details>
      {structureUnreadable && <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">The organisation of your framework (Areas and domains) could not be read just now, so competencies are shown in catalogue order. This is not the framework&apos;s structure.</p>}
      {model.frameworks.map(f => <FrameworkExplorer key={f.id} framework={f} details={details} scaleMax={scaleMax} study={study} assessmentsBase={assessmentsBase} onOpen={setOpenId} />)}
      {openId && details[openId] && (
        <Drawer row={model.frameworks.flatMap(f => f.areas.flatMap(a => a.domains.flatMap(d => d.rows.map(r => ({ r, d, a, f }))))).find(x => x.r.id === openId)!}
          detail={details[openId]} scaleMax={scaleMax} study={study} assessmentsBase={assessmentsBase} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
}

function FrameworkExplorer({ framework: f, details, scaleMax, study, assessmentsBase, onOpen }: {
  framework: ExplorerFramework; details: Record<string, ExplorerDetail>; scaleMax: number; study: string | null; assessmentsBase: string; onOpen: (id: string) => void;
}) {
  const uid = useId();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ExplorerFilter>("all");
  const [sort, setSort] = useState<ExplorerSort>("framework");
  const [areaId, setAreaId] = useState<string | null>(f.areas[0]?.id ?? null);
  // Domains start collapsed except the first of the chosen Area, so a large framework stays short.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(f.areas[0]?.domains[0] ? [f.areas[0].domains[0].id] : []));
  const [restored, setRestored] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Remembered navigation state, per framework, in this browser only (the same pattern as ScholarSidebar).
  useEffect(() => {
    const st = readState(f.id);
    if (st) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only in the browser, so it is read after hydration, not in the first render
      if (st.q !== undefined) setQ(st.q);
      if (st.filter) setFilter(st.filter);
      if (st.sort) setSort(st.sort);
      if (st.areaId !== undefined && f.areas.some(a => a.id === st.areaId)) setAreaId(st.areaId);
      if (st.expanded) setExpanded(new Set(st.expanded));
    }
    setRestored(true);
  }, [f.id, f.areas]);
  useEffect(() => { if (restored) writeState(f.id, { areaId, expanded: [...expanded], q, filter, sort }); }, [restored, f.id, areaId, expanded, q, filter, sort]);

  const shown = useMemo(() => applyQuery(f, { q, filter, sort }), [f, q, filter, sort]);
  const searching = q.trim().length > 0;
  const current = shown.areas.find(a => a.id === areaId) ?? shown.areas[0] ?? null;
  const others = shown.areas.filter(a => a !== current);
  const othersMatching = others.reduce((n, a) => n + countRows(a), 0);
  const allDomainIds = f.areas.flatMap(a => a.domains.map(d => d.id));
  const tabs = f.areasRead && f.areas.length > 1;
  const toggle = (id: string) => setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <div className="mt-5" data-framework={f.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-bold text-gray-900">{f.name}{f.code ? <span className={`ml-2 text-[12.5px] font-semibold ${mutedText}`}>{f.code}{f.version ? ` · version ${f.version}` : ""}</span> : null}</h3>
        <p className={`text-[12.5px] ${mutedText}`}>{f.total} competenc{f.total === 1 ? "y" : "ies"} · {f.areasRead ? `${f.areas.filter(a => !a.unassigned).length} Area${f.areas.filter(a => !a.unassigned).length === 1 ? "" : "s"} · ` : ""}{allDomainIds.length} domain{allDomainIds.length === 1 ? "" : "s"}</p>
      </div>
      {f.structureGaps.length > 0 && (
        <p role="status" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          Framework structure to complete (for framework administrators): {f.structureGaps.join(" ")}
        </p>
      )}

      {/* Toolbar: search, filter, sort, expand/collapse. Sticky so it stays with a long list. */}
      <div className="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-2" role="search" aria-label={`Search and filter ${f.name}`}>
        <label className="flex min-w-[12rem] flex-1 items-center gap-2">
          <span className="sr-only">Search competencies by title, code, Area or domain</span>
          <input ref={searchRef} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search title, code, Area or domain" className={`${control} w-full`} />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-700">
          <span>Show</span>
          <select value={filter} onChange={e => setFilter(e.target.value as ExplorerFilter)} className={control} aria-label="Filter competencies">
            {FILTERS.map(k => <option key={k} value={k}>{FILTER_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-700">
          <span>Sort</span>
          <select value={sort} onChange={e => setSort(e.target.value as ExplorerSort)} className={control} aria-label="Sort competencies">
            {SORTS.map(k => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </select>
        </label>
        <span className="flex gap-1">
          <button type="button" onClick={() => setExpanded(new Set(allDomainIds))} className={linkBtn}>Expand all</button>
          <button type="button" onClick={() => setExpanded(new Set())} className={linkBtn}>Collapse all</button>
        </span>
      </div>

      {/* Area tabs: the two (or more) Areas of the framework, as Holdings named them. */}
      {tabs && !searching && (
        <div role="tablist" aria-label={`Areas of ${f.name}`} className="mt-3 flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-1">
          {shown.areas.map(a => {
            const on = a === current;
            const n = countRows(a);
            return (
              <button key={a.id ?? "none"} type="button" role="tab" id={`${uid}-tab-${a.id ?? "none"}`} aria-selected={on} aria-controls={`${uid}-panel`} onClick={() => setAreaId(a.id)}
                className={`min-h-11 flex-1 whitespace-nowrap rounded-lg px-3 text-[14px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${on ? "bg-[var(--cmp-theme-accent)] text-[var(--cmp-theme-on-accent)]" : "text-gray-800 hover:bg-white"} ${focusRing}`}>
                {a.name} <span className={on ? "opacity-80" : mutedText}>{n}</span>
              </button>
            );
          })}
        </div>
      )}

      <div id={`${uid}-panel`} role={tabs && !searching ? "tabpanel" : undefined} aria-labelledby={tabs && !searching && current ? `${uid}-tab-${current.id ?? "none"}` : undefined} className="mt-3 space-y-3">
        {searching ? (
          // A search shows every match with its Area context, so a match in the other Area is never hidden.
          shown.areas.every(a => countRows(a) === 0)
            ? <p className={`rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[13.5px] ${mutedText}`}>No competency in {f.name} matches &ldquo;{q.trim()}&rdquo;{filter !== "all" ? ` with the filter ${FILTER_LABEL[filter]}` : ""}.</p>
            : shown.areas.filter(a => countRows(a) > 0).map(a => (
              <AreaGroup key={a.id ?? "none"} area={a} heading={tabs} expanded={expanded} toggle={toggle} details={details} scaleMax={scaleMax} study={study} assessmentsBase={assessmentsBase} onOpen={onOpen} forceOpen />
            ))
        ) : current ? (
          <>
            {countRows(current) === 0
              ? <p className={`rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[13.5px] ${mutedText}`}>No competency in {current.name} {filter === "all" ? "yet" : `is ${FILTER_LABEL[filter].toLowerCase()}`}.</p>
              : <AreaGroup area={current} heading={false} expanded={expanded} toggle={toggle} details={details} scaleMax={scaleMax} study={study} assessmentsBase={assessmentsBase} onOpen={onOpen} forceOpen={filter !== "all"} />}
            {tabs && filter !== "all" && othersMatching > 0 && (
              <p className={`text-[13px] ${mutedText}`}>
                Also {FILTER_LABEL[filter].toLowerCase()}: {others.filter(a => countRows(a) > 0).map((a, i) => (
                  <span key={a.id ?? "none"}>{i > 0 ? ", " : ""}<button type="button" onClick={() => setAreaId(a.id)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>{countRows(a)} in {a.name}</button></span>
                ))}.
              </p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function AreaGroup({ area, heading, expanded, toggle, forceOpen = false, details, scaleMax, study, assessmentsBase, onOpen }: {
  area: ExplorerArea; heading: boolean; expanded: Set<string>; toggle: (id: string) => void; forceOpen?: boolean;
  details: Record<string, ExplorerDetail>; scaleMax: number; study: string | null; assessmentsBase: string; onOpen: (id: string) => void;
}) {
  return (
    <div>
      {heading && <h4 className={`mb-1.5 text-[12px] font-bold uppercase tracking-[0.14em] ${area.unassigned ? "text-amber-800" : "text-gray-500"}`}>{area.name}</h4>}
      {area.unassigned && !heading && <p className="mb-1.5 text-[12.5px] text-amber-800">These domains have not been assigned to an Area by the framework&apos;s administrators.</p>}
      <div className="space-y-2">
        {area.domains.map(d => {
          const open = forceOpen || expanded.has(d.id);
          const attention = d.rows.filter(r => r.attention).length;
          const started = d.rows.filter(r => !r.ind.not_started).length;
          return (
            <section key={d.id} aria-label={d.name} className="rounded-xl border border-gray-200 bg-white">
              <h5>
                <button type="button" aria-expanded={open} onClick={() => toggle(d.id)}
                  className={`flex w-full min-h-11 items-center justify-between gap-3 px-3 py-2 text-left pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-bold text-gray-900">{d.code ? <span className={`mr-1.5 font-mono text-[12px] font-semibold ${mutedText}`}>{d.code}</span> : null}{d.name}</span>
                    <span className={`block text-[12px] ${mutedText}`}>{d.rows.length} competenc{d.rows.length === 1 ? "y" : "ies"}{started ? ` · ${started} started` : ""}{attention ? ` · ${attention} need${attention === 1 ? "s" : ""} attention` : ""}</span>
                  </span>
                  <span aria-hidden className={`shrink-0 text-[12px] font-semibold ${mutedText}`}>{open ? "Hide" : "Show"}</span>
                </button>
              </h5>
              {open && (
                <ul className="border-t border-gray-100">
                  {d.rows.map(r => <Row key={r.id} row={r} detail={details[r.id]} scaleMax={scaleMax} study={study} assessmentsBase={assessmentsBase} onOpen={onOpen} />)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Row({ row: r, detail, scaleMax, study, assessmentsBase, onOpen }: { row: ExplorerRow; detail: ExplorerDetail | undefined; scaleMax: number; study: string | null; assessmentsBase: string; onOpen: (id: string) => void }) {
  const self = selfStatus(r, scaleMax);
  const ev = evidenceStatus(r);
  const action = rowAction(r, detail, study, assessmentsBase);
  return (
    <li className="odd:bg-white even:bg-gray-50/70 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button type="button" onClick={() => onOpen(r.id)} aria-haspopup="dialog" aria-label={`${r.title}: open details`}
          className={`flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg text-left pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
          <span className="min-w-0 flex-1 basis-[14rem]">
            <span className="block truncate text-[14px] font-semibold text-gray-900">{r.title}</span>
            <span className={`block text-[12px] ${mutedText}`}>{r.code ? <span className="font-mono">{r.code}</span> : null}{r.code && r.expected ? " · " : ""}{r.expected ? `Expected: ${r.expected.label} (${r.expected.score})` : ""}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {r.ind.verified && <Chip tone="success">{INDICATOR_LABEL.verified}</Chip>}
            <Chip tone={self.tone}>{self.text}</Chip>
            {ev ? <Chip tone={ev.tone}>{ev.text}</Chip> : <Chip>{INDICATOR_LABEL.not_started}</Chip>}
            {r.attention && <Chip tone="warning">Needs attention</Chip>}
          </span>
        </button>
        <Link href={action.href} className={`hidden shrink-0 text-[13px] font-semibold underline underline-offset-2 md:inline-flex md:min-h-11 md:items-center ${focusRing}`} style={{ color: "var(--cmp-theme-ink)" }}>{action.label}</Link>
      </div>
    </li>
  );
}

// ── THE DRAWER ── everything about one competency, without leaving the Explorer ──

function Drawer({ row: x, detail: d, scaleMax, study, assessmentsBase, onClose }: {
  row: { r: ExplorerRow; d: { name: string; code: string | null }; a: ExplorerArea; f: ExplorerFramework }; detail: ExplorerDetail; scaleMax: number; study: string | null; assessmentsBase: string; onClose: () => void;
}) {
  const { r } = x;
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const uid = useId();
  useModalFocus(true, panel, () => ref.current?.close());
  useEffect(() => { const el = ref.current; if (el && !el.open) el.showModal(); }, []);
  const learnHref = withStudy(experienceHref("scholar", `study/learn?competency=${encodeURIComponent(r.id)}`), study);
  const practiseHref = withStudy(experienceHref("scholar", "study/revise"), study);
  const progressHref = withStudy(experienceHref("scholar", "study/progress"), study);
  const evidenceHref = experienceHref("scholar", "my-competencies/evidence");
  const hasEvidence = r.ind.evidence_available || r.ind.self_assessed || r.ind.verified;
  const sectionCls = "rounded-xl border border-gray-200 bg-white p-3";
  return (
    <dialog ref={ref} aria-modal="true" aria-labelledby={`${uid}-h`} onClose={onClose} onCancel={onClose} onClick={e => { if (e.target === ref.current) ref.current?.close(); }}
      className="cmp-dialog fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90vh] w-full max-w-none rounded-t-2xl border border-gray-200 bg-gray-50 p-0 text-left text-gray-900 shadow-xl backdrop:bg-black/40 md:inset-y-0 md:left-auto md:right-0 md:top-0 md:h-full md:max-h-none md:w-[34rem] md:rounded-none md:rounded-l-2xl">
      <div ref={panel} tabIndex={-1} className="flex max-h-[90vh] flex-col outline-none md:h-full md:max-h-none">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 bg-white p-4">
          <div className="min-w-0">
            <p className={`text-[12px] font-semibold ${mutedText}`}>{[x.a.id === null ? null : x.a.name, x.d.code ? `${x.d.code} ${x.d.name}` : x.d.name, x.f.code ?? x.f.name].filter(Boolean).join(" · ")}</p>
            <h2 id={`${uid}-h`} className="mt-0.5 text-[17px] font-bold leading-snug text-gray-900">{r.title}</h2>
            <p className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] ${mutedText}`}>
              {r.code && <span className="font-mono">{r.code}</span>}
              <span>{r.expected ? `Expected proficiency: ${r.expected.label} (${r.expected.score})` : "Expected proficiency: not set for your programme"}</span>
              {r.contentStatus !== "approved" && <Chip tone="warning">{r.contentStatus === "draft" ? "Draft content" : "Not clinically reviewed"}</Chip>}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-[15px] font-semibold hover:bg-gray-50 pointer-coarse:h-[var(--cmp-touch-min)] pointer-coarse:w-[var(--cmp-touch-min)] ${focusRing}`}>{"✕"}</button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-[13px] text-gray-800"><span className="font-semibold">Progress: </span>{indicatorLine(r.ind)}</p>
          {(d.description || d.outcomes.length > 0) && (
            <section className={sectionCls} aria-label="About this competency">
              {d.description && <p className="text-[13.5px] leading-relaxed text-gray-800">{d.description}</p>}
              {d.outcomes.length > 0 && <><p className={`mt-2 text-[12.5px] font-semibold ${mutedText}`}>What you should be able to do</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-gray-800">{d.outcomes.map((o, i) => <li key={i}>{o}</li>)}</ul></>}
            </section>
          )}

          <section className={sectionCls} aria-label={`${r.title}: how I rate myself`}>
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-[13px] font-bold text-gray-900">How I rate myself</h3><Chip tone="info">{SELF_CLASS_LABEL}</Chip></div>
            {d.self ? (
              <div className="mt-2 space-y-1 text-[13px] text-gray-800">
                <p><span className="text-2xl font-bold tabular-nums">{d.self.rating === null ? "No rating" : d.self.rating}</span>{d.self.rating !== null && <span className={`ml-1 text-[12.5px] ${mutedText}`}>of {scaleMax}</span>}<span className={`ml-2 text-[12.5px] ${mutedText}`}>on {date(d.self.at)}</span></p>
                {d.self.descriptor && <p className="line-clamp-3">{d.self.descriptor}</p>}
                <p className={`text-[12.5px] ${mutedText}`}>{d.self.range ? `Across your criteria: ${d.self.range}. ` : ""}{d.self.trend}.</p>
                {d.self.previous.length > 0 && <details className="text-[12.5px]"><summary className={`cursor-pointer font-semibold ${focusRing}`}>Previous ratings ({d.self.previous.length})</summary><ul className={`mt-1 space-y-0.5 ${mutedText}`}>{d.self.previous.map(p => <li key={p.at}>{date(p.at)}: {p.rating === null ? "no rating" : p.rating} ({p.instrument})</li>)}</ul></details>}
              </div>
            ) : <p className={`mt-2 text-[13px] ${mutedText}`}>{NO_SELF_RATING}.{d.selfOpenInstanceId ? " One is open and not yet submitted." : ""}</p>}
          </section>

          <section className={sectionCls} aria-label={`${r.title}: what my learning evidence shows`}>
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-[13px] font-bold text-gray-900">{EVIDENCE_CLASS_LABEL}</h3><Chip>Formative practice, not verified</Chip></div>
            <div className="mt-2 space-y-1 text-[13px] text-gray-800">
              {d.evidence.outcome ? <p>{d.evidence.outcome}.</p> : <p className={mutedText}>{NO_MAPPED_EVIDENCE}.</p>}
              {d.evidence.osceFinished > 0 && <p>{d.evidence.osceFinished} finished OSCE run{d.evidence.osceFinished === 1 ? "" : "s"} on a station for this competency.</p>}
              {d.evidence.casesCompleted > 0 && <p>{d.evidence.casesCompleted} completed clinical case{d.evidence.casesCompleted === 1 ? "" : "s"} mapped to this competency.</p>}
              {d.evidence.learningSessions > 0 && <p>{d.evidence.learningSessions} Learn session{d.evidence.learningSessions === 1 ? "" : "s"} on this competency.</p>}
              {d.evidence.lastAt && <p className={`text-[12.5px] ${mutedText}`}>Last learning activity {date(d.evidence.lastAt)}{d.evidence.lastVerdict ? `, last check: ${d.evidence.lastVerdict.replace(/_/g, " ")}` : ""}.</p>}
            </div>
            <p className={`mt-2 text-[12.5px] font-semibold ${mutedText}`}>Linked materials</p>
            {d.evidence.materials === null ? <p className={`text-[12.5px] ${mutedText}`}>Your materials could not be read just now.</p>
              : d.evidence.materials.length === 0 ? <p className={`text-[12.5px] ${mutedText}`}>No section of your notes is linked to this competency yet{d.evidence.sectionsProposed > 0 ? ` (${d.evidence.sectionsProposed} suggested link${d.evidence.sectionsProposed === 1 ? "" : "s"} waiting for your decision)` : ""}.</p>
                : <ul className="mt-0.5 space-y-0.5 text-[13px] text-gray-800">{d.evidence.materials.map(m => <li key={m.id}>{m.title} <span className={`text-[12px] ${mutedText}`}>· {m.sections} section{m.sections === 1 ? "" : "s"}</span></li>)}</ul>}
          </section>

          <section className={sectionCls} aria-label={`${r.title}: development gaps`}>
            <h3 className="text-[13px] font-bold text-gray-900">Development gaps</h3>
            {d.gaps.length === 0 && !d.compare.differs
              ? <p className={`mt-1 text-[13px] ${mutedText}`}>{r.ind.self_assessed ? "Your latest self-assessment identified no gaps." : "None recorded. Gaps come from your own self-assessment and from comparing it with your practice."}</p>
              : (
                <div className="mt-1 space-y-1.5 text-[13px] text-gray-800">
                  {d.gaps.length > 0 && <ul className="list-disc space-y-0.5 pl-5">{d.gaps.map((g, i) => <li key={i}>{g.code ? `${g.code} ` : ""}{g.prompt} <span className="font-semibold">({g.label})</span></li>)}</ul>}
                  <p>{d.compare.text} <span className={`text-[12px] ${mutedText}`}>Self: {d.compare.selfBand ?? "not rated"} · Practice: {d.compare.evidenceBand ?? "not enough yet"}. This never changes your self-rating.</span></p>
                </div>
              )}
          </section>

          {d.stages.length > 0 && (
            <section className={sectionCls} aria-label={STAGE_BLOCK_TITLE}>
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-[13px] font-bold text-gray-900">{STAGE_BLOCK_TITLE}</h3><Chip tone="info">{d.stages[0].note}</Chip></div>
              <ul className="mt-2 space-y-1.5 text-[13px] text-gray-800">{d.stages.map((s, i) => <li key={i}><p>{s.summary}</p><p className={`text-[12px] ${mutedText}`}>Worked out {date(s.computedAt)}.{s.stale ? ` ${STAGE_STALE_NOTE}` : ""}</p></li>)}</ul>
            </section>
          )}

          <p className="flex flex-wrap items-center gap-2 text-[13px]"><Chip tone={d.verification.state === "verified" ? "success" : "neutral"}>{d.verification.line}</Chip>{d.verification.detail && <span className={`text-[12px] ${mutedText}`}>{d.verification.detail}</span>}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white p-3" role="group" aria-label={`Actions for ${r.title}`}>
          <Link href={learnHref} className={primaryLink}>Learn</Link>
          {d.selfOpenInstanceId ? <Link href={`${assessmentsBase}/${d.selfOpenInstanceId}`} className={linkBtn}>Continue self-assessment</Link>
            : d.selfStartable ? <StartButton code={d.selfStartable.code} label={d.self ? "Repeat self-assessment" : "Self-Assess"} primary={false} /> : null}
          {d.self?.latestInstanceId && <Link href={`${assessmentsBase}/${d.self.latestInstanceId}/report`} className={linkBtn}>Review report</Link>}
          <Link href={practiseHref} className={linkBtn}>Practise</Link>
          {hasEvidence && <Link href={evidenceHref} className={linkBtn}>View Evidence</Link>}
          {r.ind.practised && <Link href={progressHref} className={linkBtn}>See my practice</Link>}
        </div>
      </div>
    </dialog>
  );
}
