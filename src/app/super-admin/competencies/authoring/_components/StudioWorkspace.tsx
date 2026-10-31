"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { arrange } from "@/lib/competency/layout-order";
import { criterionLabel, criterionPrefixes } from "@/lib/competency/criterion-labels";
import { announceMove, moveInArray, shortName, stepTarget } from "@/lib/competency/reorder-ui";
import { CompetencyEditor, SubmitReview } from "./AuthoringControls";
import { ReviewButton } from "./ReviewDialog";

// CFCA-STUDIO-UX-02, the Competencies tab of one framework: a compact searchable explorer (domains, competencies,
// selection) beside ONE active competency. Its fields are edited with the existing CompetencyEditor (the same governed
// update, authorship recorded first). Its criteria are shown one component at a time, in their source words and order.
// Statuses are worked out on the server (the existing 395 rule) and passed in, never inferred here.
//
// FRAMEWORK-DESIGN-STUDIO-01 slice C: the order of domains, of a domain's competencies, of a competency's criteria
// (within one section) and of the sections can be changed by drag and drop or by Move up / Move down on every row.
// Only a move inside the same parent is offered: a move to another parent is a clinical change and is not here. Each
// move posts reorder_layout with the full new order of that parent; the server decides (and may answer 409).

export type StudioStatus = "eligible" | "in_review" | "approved" | "changes_requested" | "framework_locked" | "unreadable";
export type StudioCompetency = {
  id: string; code: string | null; name: string; description: string | null; learningOutcomes: string[]; expectedLevelId: string | null;
  riskCategory: string; sortOrder: number; cpuId: string | null; status: StudioStatus; statusText: string;
  criteria: { id?: string; component: string | null; text: string; sourceRef: string | null }[];
};
export type StudioDomain = { id: string; name: string; competencies: StudioCompetency[]; cpus: { id: string; label: string }[] };

const DOT: Record<StudioStatus, string> = {
  eligible: "bg-teal-600", in_review: "bg-blue-600", approved: "bg-violet-600", changes_requested: "bg-amber-500", framework_locked: "bg-gray-400", unreadable: "bg-red-500",
};
const CHIP: Record<StudioStatus, [string, string]> = {
  eligible: ["Ready for review", "bg-teal-50 text-teal-900"], in_review: ["In review", "bg-blue-50 text-blue-900"], approved: ["Reviewed", "bg-violet-50 text-violet-900"],
  changes_requested: ["Needs attention", "bg-amber-50 text-amber-900"], framework_locked: ["Locked", "bg-gray-100 text-gray-800"], unreadable: ["State unreadable", "bg-red-50 text-red-900"],
};
const link = "text-[13px] font-semibold text-teal-800 hover:underline disabled:opacity-50";
const AUTHORING = "/api/hq/competency/authoring";
const mvBtn = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-[12px] leading-none text-gray-800 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:opacity-40 pointer-coarse:h-[var(--cmp-touch-min)] pointer-coarse:w-[var(--cmp-touch-min)]";
const overCls = "outline outline-2 outline-teal-600";

type View = { domains: StudioDomain[]; sections: string[] };
/** One list that can be reordered: what the server needs to name it, and how the local view takes the new order. */
type Group = {
  key: string; level: "domains" | "competencies" | "criteria" | "sections"; parentId?: string; component?: string | null;
  ids: string[]; names: string[]; apply: (v: View, ids: string[]) => View;
};
/** What a row needs to be reorderable: native drag props and the Move up / Move down pair. */
export type Reorder = {
  on: boolean;
  row: (g: Group, i: number) => React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  buttons: (g: Group, i: number) => React.ReactNode;
  criteriaGroup: (c: StudioCompetency, component: string | null) => Group;
};

const sameKeyFor = (group: Group, i: number) => `${group.key}|${group.ids[i]}`;

export default function StudioWorkspace({ frameworkId, domains: domainsIn, levels, components, editable, initialId, canReorder = false, sectionCodes, draftMode = false }: {
  frameworkId: string; domains: StudioDomain[]; levels: { id: string; score: number; label: string }[];
  components: Record<string, string>; editable: boolean; initialId: string | null;
  /** The order can be changed: the framework is editable and 750/751 are on this environment (the server decides again). */
  canReorder?: boolean; sectionCodes?: string[];
  /** A framework that has been published: a move is saved as a draft layout and learners keep the published order. */
  draftMode?: boolean;
}) {
  const router = useRouter();
  const sections0 = sectionCodes ?? Object.keys(components);
  const [view, setView] = useState<View>({ domains: domainsIn, sections: sections0 });
  const [seen, setSeen] = useState({ d: domainsIn, s: sectionCodes });
  // New props (after router.refresh) replace the local view; until then the optimistic view stands.
  if (seen.d !== domainsIn || seen.s !== sectionCodes) { setSeen({ d: domainsIn, s: sectionCodes }); setView({ domains: domainsIn, sections: sections0 }); }
  const domains = view.domains;
  const all = useMemo(() => domains.flatMap(d => d.competencies.map(c => ({ c, d }))), [domains]);
  const [active, setActive] = useState<string | null>(initialId && all.some(x => x.c.id === initialId) ? initialId : all[0]?.c.id ?? null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(all.find(x => x.c.id === (initialId ?? all[0]?.c.id))?.d.id ? [all.find(x => x.c.id === (initialId ?? all[0]?.c.id))!.d.id] : []));
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const query = q.trim().toLowerCase();
  const match = (c: StudioCompetency) => !query || c.name.toLowerCase().includes(query) || (c.code ?? "").toLowerCase().includes(query);
  const cur = all.find(x => x.c.id === active) ?? null;

  function choose(id: string) {
    setActive(id);
    const u = new URL(window.location.href); u.searchParams.set("c", id); window.history.replaceState(null, "", u.toString());
  }
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  // ── reordering ──
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = saving || refreshing;
  const [say, setSay] = useState("");
  const [fail, setFail] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drag = useRef<{ key: string; index: number } | null>(null);
  const focusNext = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const reorderable = canReorder && editable;
  const reorderLists = reorderable && !query; // a filtered list has no whole order to move within

  // After a move the same item keeps the keyboard focus (on its button, or the other one if it reached an end).
  // The buttons are disabled while a move saves, so the focus waits until they are enabled again.
  useEffect(() => {
    const want = focusNext.current; if (!want || busy) return;
    focusNext.current = null;
    const [k, id, dir] = want.split("\u0001");
    const btns = [...(root.current?.querySelectorAll<HTMLButtonElement>("[data-mv]") ?? [])].filter(b => b.dataset.mv?.startsWith(`${k}\u0001${id}\u0001`));
    (btns.find(b => b.dataset.mv === want && !b.disabled) ?? btns.find(b => !b.disabled && !b.dataset.mv?.endsWith(dir)))?.focus();
  }, [view, busy]);

  async function move(g: Group, from: number, to: number, focusDir?: "up" | "down") {
    if (busy || from === to || from < 0 || to < 0 || from >= g.ids.length || to >= g.ids.length) return;
    const ids = moveInArray(g.ids, from, to), before = view;
    setFail(null);
    if (focusDir) focusNext.current = `${g.key}\u0001${g.ids[from]}\u0001${focusDir}`;
    setView(g.apply(before, ids));                       // optimistic
    setSay(announceMove(g.names[from], to, g.ids.length));
    setSaving(true);
    try {
      const res = await fetch(AUTHORING, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder_layout", frameworkId, level: g.level, ...(g.parentId ? { parentId: g.parentId } : {}), ...(g.level === "criteria" ? { component: g.component ?? null } : {}), order: ids }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setView(before); setFail(j?.error ?? "That order could not be saved. Nothing has changed."); setSay(""); return; }
      startRefresh(() => router.refresh());
    } catch { setView(before); setFail("That order could not be saved. Check your connection. Nothing has changed."); setSay(""); } finally { setSaving(false); }
  }

  const rx: Reorder = {
    on: reorderable,
    row: (g, i) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", g.ids[i]); } catch { /* some browsers */ } drag.current = { key: g.key, index: i }; },
      // A drop is allowed only inside the list the drag started in: never across parents.
      onDragOver: (e: React.DragEvent) => { if (drag.current?.key !== g.key) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (over !== sameKeyFor(g, i)) setOver(sameKeyFor(g, i)); },
      onDragLeave: () => setOver(o => (o === sameKeyFor(g, i) ? null : o)),
      onDrop: (e: React.DragEvent) => { const from = drag.current; drag.current = null; setOver(null); if (!from || from.key !== g.key) return; e.preventDefault(); e.stopPropagation(); void move(g, from.index, i); },
      onDragEnd: () => { drag.current = null; setOver(null); },
      className: over === sameKeyFor(g, i) ? overCls : undefined,
    }),
    buttons: (g, i) => {
      const up = stepTarget(i, -1, g.ids.length), down = stepTarget(i, 1, g.ids.length), name = shortName(g.names[i]);
      return (
        <span className="flex shrink-0 items-center gap-1">
          <button type="button" className={mvBtn} data-mv={`${g.key}\u0001${g.ids[i]}\u0001up`} aria-label={`Move up: ${name}`} title="Move up" disabled={busy || up === null} onClick={() => up !== null && void move(g, i, up, "up")}><span aria-hidden>↑</span></button>
          <button type="button" className={mvBtn} data-mv={`${g.key}\u0001${g.ids[i]}\u0001down`} aria-label={`Move down: ${name}`} title="Move down" disabled={busy || down === null} onClick={() => down !== null && void move(g, i, down, "down")}><span aria-hidden>↓</span></button>
        </span>
      );
    },
    criteriaGroup: (c, component) => {
      const list = c.criteria.filter(k => (k.component ?? null) === component && k.id);
      return {
        key: `criteria:${c.id}:${component ?? ""}`, level: "criteria", parentId: c.id, component,
        ids: list.map(k => k.id!), names: list.map(k => k.text),
        apply: (v, ids) => ({
          ...v, domains: v.domains.map(d => ({ ...d, competencies: d.competencies.map(x => {
            if (x.id !== c.id) return x;
            const byId = new Map(x.criteria.map(k => [k.id, k])), queue = [...ids];
            // The section's criteria take the section's own slots; other sections do not move.
            return { ...x, criteria: x.criteria.map(k => ((k.component ?? null) === component && k.id ? byId.get(queue.shift())! : k)) };
          }) })),
        }),
      };
    },
  };
  const domainGroup: Group = {
    key: "domains", level: "domains", ids: domains.map(d => d.id), names: domains.map(d => d.name),
    apply: (v, ids) => ({ ...v, domains: arrange(v.domains, ids, d => d.id) }),
  };
  const compGroup = (d: StudioDomain): Group => ({
    key: `competencies:${d.id}`, level: "competencies", parentId: d.id, ids: d.competencies.map(c => c.id), names: d.competencies.map(c => c.name),
    apply: (v, ids) => ({ ...v, domains: v.domains.map(x => (x.id === d.id ? { ...x, competencies: arrange(x.competencies, ids, c => c.id) } : x)) }),
  });
  const sectionGroup: Group = {
    key: "sections", level: "sections", ids: view.sections, names: view.sections.map(c => components[c] ?? c),
    apply: (v, ids) => ({ ...v, sections: ids }),
  };

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]" ref={root}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{say}</p>
      <aside aria-label="Competency explorer" className="flex max-h-[calc(100vh-12rem)] flex-col rounded-2xl border border-gray-200 bg-white md:sticky md:top-4">
        <div className="border-b border-gray-100 p-4">
          <div className="flex items-baseline justify-between"><h2 className="text-[15px] font-bold text-gray-900">Competency explorer</h2><span className="text-[12px] text-gray-500">{domains.length} domains</span></div>
          <label className="sr-only" htmlFor="cx-q">Find a competency or code</label>
          <input id="cx-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a competency or code…" className="mt-3 block w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)]" />
          {reorderable && <p className="mt-2 text-[11.5px] text-gray-600">{query ? "Clear the search to reorder domains and competencies." : "Drag a row, or use the arrow buttons, to change the order."}{draftMode ? " Learners keep the published order until a draft layout is published." : ""}</p>}
          {fail && <p role="alert" className="mt-2 text-[12.5px] font-medium text-red-700">{fail}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {domains.map((d, di) => {
            const comps = d.competencies.filter(match);
            if (query && !comps.length) return null;
            const isOpen = query ? true : open.has(d.id);
            const cg = compGroup(d);
            return (
              <div key={d.id}>
                <div {...(reorderLists ? rx.row(domainGroup, di) : {})} className={`flex items-center gap-1 pr-2 hover:bg-gray-50 ${reorderLists && over === sameKeyFor(domainGroup, di) ? overCls : ""}`}>
                  {reorderLists && <span aria-hidden title="Drag to reorder" className="cursor-grab select-none pl-2 text-gray-400">⠿</span>}
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(s => toggle(s, d.id))}
                    className="flex min-w-0 flex-1 items-center justify-between px-2 py-2.5 text-left text-[13.5px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                    <span className="min-w-0"><span aria-hidden className="mr-1.5 inline-block w-3 text-gray-500">{isOpen ? "▾" : "▸"}</span>{d.name}</span>
                    <span className="ml-2 text-[12px] font-normal text-gray-500">{d.competencies.length}</span>
                  </button>
                  {reorderLists && rx.buttons(domainGroup, di)}
                </div>
                {isOpen && comps.map(c => {
                  const ci = d.competencies.findIndex(x => x.id === c.id);
                  return (
                    <div key={c.id} {...(reorderLists ? rx.row(cg, ci) : {})}
                      className={`mx-2 mb-1 flex items-start gap-2 rounded-lg px-2 py-2 ${c.id === active ? "border-l-4 border-teal-700 bg-teal-50/70" : "hover:bg-gray-50"} ${reorderLists && over === sameKeyFor(cg, ci) ? overCls : ""}`}>
                      {reorderLists && <span aria-hidden title="Drag to reorder" className="mt-1 cursor-grab select-none text-gray-400">⠿</span>}
                      <input type="checkbox" aria-label={`Select ${c.name}`} className="mt-1" checked={picked.has(c.id)} onChange={() => setPicked(s => toggle(s, c.id))} />
                      <button type="button" onClick={() => choose(c.id)} aria-current={c.id === active ? "true" : undefined} className="min-w-0 flex-1 text-left">
                        <span className="block text-[13.5px] text-gray-900">{c.name}</span>
                        <span className="block font-mono text-[11.5px] text-gray-500">{c.code ?? "no code"} · {c.criteria.length} criteria</span>
                      </button>
                      <span title={CHIP[c.status][0]} aria-label={CHIP[c.status][0]} className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[c.status]}`} />
                      {reorderLists && rx.buttons(cg, ci)}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {reorderable && view.sections.length > 1 && (
            <details className="mx-2 mt-2 rounded-lg border border-gray-200 px-2 py-1">
              <summary className="cursor-pointer py-1 text-[13px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)]">Section order</summary>
              <p className="text-[11.5px] text-gray-600">The order of the assessment sections in this framework.</p>
              <ol className="mt-1 space-y-1 pb-1">
                {view.sections.map((code, i) => (
                  <li key={code} {...rx.row(sectionGroup, i)} className={`flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-gray-50 ${over === sameKeyFor(sectionGroup, i) ? overCls : ""}`}>
                    <span aria-hidden title="Drag to reorder" className="cursor-grab select-none text-gray-400">⠿</span>
                    <span className="min-w-0 flex-1 text-[13px] text-gray-900">{components[code] ?? code}</span>
                    {rx.buttons(sectionGroup, i)}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
        <div className="border-t border-gray-100 p-4">
          <p className="flex flex-wrap gap-3 text-[11.5px] text-gray-600">
            {(["eligible", "in_review", "approved", "changes_requested"] as StudioStatus[]).map(s => <span key={s} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${DOT[s]}`} />{CHIP[s][0]}</span>)}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12.5px] text-gray-700">{picked.size} selected</span>
            <ReviewButton frameworkId={frameworkId} scope={{ kind: "competencies", ids: [...picked] }} label="Review selected →" className={link} disabled={!picked.size || !editable} />
          </div>
        </div>
      </aside>

      <section aria-label="Competency" className="min-w-0 rounded-2xl border border-gray-200 bg-white">
        {!cur ? <p className="p-6 text-[13.5px] text-gray-600">This framework has no competency yet. Add one from Overview &amp; governance.</p> : (
          <>
            <div className="border-b border-gray-100 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">{cur.d.name} / <span className="font-mono">{cur.c.code ?? "no code"}</span></p>
                <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${CHIP[cur.c.status][1]}`}>{CHIP[cur.c.status][0]}</span>
              </div>
              <h2 className="mt-1 text-[20px] font-bold text-gray-900">{cur.c.name}</h2>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-gray-600">{cur.c.statusText} · {cur.c.criteria.length} source criteria</p>
                <ReviewButton frameworkId={frameworkId} scope={{ kind: "domain", domainId: cur.d.id }} label="Review this domain →" className={link} disabled={!editable} />
              </div>
            </div>
            <div className="space-y-5 p-5">
              <Criteria key={cur.c.id} comp={cur.c} components={components} sections={view.sections} rx={rx} />
              {editable ? (
                <details className="rounded-xl border border-gray-200 p-4" open={false}>
                  <summary className="cursor-pointer text-[14px] font-semibold text-gray-900">Edit name, description, outcomes, level and risk</summary>
                  <p className="mt-1 text-[12.5px] text-gray-600">Saving changes the content version. A reviewed or pending version then needs review again.</p>
                  <div className="mt-3"><CompetencyEditor key={cur.c.id} c={cur.c} levels={levels} approved={cur.c.status === "approved"} cpus={cur.d.cpus} /></div>
                </details>
              ) : <p className="text-[13px] text-gray-600">The framework is under governance review or archived, so its content and its order are not edited here.</p>}
              {editable && (cur.c.status === "eligible" || cur.c.status === "changes_requested") && <SubmitReview competencyId={cur.c.id} />}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Criteria({ comp, components, sections, rx }: { comp: StudioCompetency; components: Record<string, string>; sections: string[]; rx: Reorder }) {
  const criteria = comp.criteria;
  // Section tabs follow the framework's section order (sections), then "Not classified".
  const codes = [...sections.filter(k => k in components && criteria.some(c => c.component === k)), ...(criteria.some(c => !c.component) ? [""] : [])];
  const [tab, setTab] = useState(codes[0] ?? "");
  if (!criteria.length) return <p className="text-[13px] text-gray-600">No assessment criteria are recorded for this competency.</p>;
  const shown = criteria.filter(c => (c.component ?? "") === tab);
  const g = rx.on && shown.length > 1 && shown.every(c => c.id) ? rx.criteriaGroup(comp, tab || null) : null;
  const prefixes = criterionPrefixes(components);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[15px] font-bold text-gray-900">Assessment criteria</h3><span className="text-[12px] text-gray-500">One section at a time · source wording{g ? " · reorder within this section" : ""}</span></div>
      <div role="tablist" aria-label="Assessment components" className="mt-2 flex flex-wrap gap-2">
        {codes.map(code => {
          const n = criteria.filter(c => (c.component ?? "") === code).length;
          return <button key={code || "none"} role="tab" type="button" aria-selected={tab === code} onClick={() => setTab(code)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${tab === code ? "border-teal-900 bg-teal-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`}>
            {code ? components[code] ?? code : "Not classified"} {n}</button>;
        })}
      </div>
      <ol role="tabpanel" className="mt-3 space-y-2">
        {shown.map((c, i) => (
          <li key={c.id ?? i} title={c.sourceRef ?? undefined} {...(g ? rx.row(g, i) : {})} className={`flex items-start gap-2 rounded-lg ${g ? rx.row(g, i).className ?? "" : ""}`}>
            {g && <span aria-hidden title="Drag to reorder" className="mt-1.5 cursor-grab select-none text-gray-400">⠿</span>}
            <span className="mt-0.5 inline-flex h-7 min-w-9 items-center justify-center rounded-md bg-teal-50 px-1.5 font-mono text-[11.5px] font-semibold text-teal-900">{criterionLabel(prefixes, tab, i)}</span>
            <span className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[13.5px] text-gray-900">{c.text}</span>
            {g && <span className="mt-0.5">{rx.buttons(g, i)}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
