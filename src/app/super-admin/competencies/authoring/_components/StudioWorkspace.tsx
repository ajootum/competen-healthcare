"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { arrange } from "@/lib/competency/layout-order";
import { announceMove, dropOf, movePointerDrag, moveInArray, readDropTarget, shortName, startPointerDrag, stepTarget, type PointerDrag } from "@/lib/competency/reorder-ui";
import { SubmitReview } from "./AuthoringControls";
import PropertiesPanel from "./PropertiesPanel";
import { ReviewButton } from "./ReviewDialog";
import { announceAreaMove, announceCompetencyMove, dropAction, expandOrder, groupDomains, moveCompetency, setDomainArea, type DragSource, type DropTarget, type OrgAction, type StudioArea } from "@/lib/competency/studio-areas";
import { AddAreaForm, AreaHeading, MoveSelect } from "./OrganiseControls";
import { FrameworkMap } from "./FrameworkMap";
import { SubmitRevisionReview } from "./RevisionBanner";
import { ResizableColumns, ResizeHandle, useResizable } from "@/components/ui/resizable";
import { announceBulkDone, announceBulkStopped, bulkProgress, clearSelection, keepVisible, selectAllIn, toggleId, toMove } from "@/lib/competency/domain-selection";
import { movedPosition, revisionTags, type CritMark, type PublishedFields, type RevMark } from "@/lib/competency/revision-ui";

// CFCA-STUDIO-UX-02, the Competencies tab of one framework: a compact searchable explorer (domains, competencies,
// selection) beside ONE active competency. Its fields are edited with the existing CompetencyEditor (the same governed
// update, authorship recorded first). Its criteria are shown one component at a time, in their source words and order.
// Statuses are worked out on the server (the existing 395 rule) and passed in, never inferred here.
//
// FRAMEWORK-DESIGN-STUDIO-01 slice C: the order of domains, of a domain's competencies, of a competency's criteria
// (within one section) and of the sections can be changed by drag and drop or by Move up / Move down on every row.
// Only reorders inside the same parent and the organisational moves below cross parents; a criterion to another section
// or competency is "Move to..." in the properties panel. Each reorder posts reorder_layout with the full new order of
// that parent; the server decides (and may answer 409).
//
// FRAMEWORK-DESIGN-STUDIO-02 S2: dragging is by pointer events on a row's grip (touch and mouse, no library); the arrow
// buttons and the live region stay. The selected competency's fields and criteria are edited in PropertiesPanel.
//
// FRAMEWORK-DESIGN-STUDIO-02 S4: the tree is framework > Area > domain > competency (a domain with no Area sits under
// "Unassigned"; a framework with no Area is the flat tree it always was). Organisational moves, which change no meaning
// and need no clinical re-review, are the only moves across parents: a domain to another Area, a competency to another
// domain, by dragging (the same S2 pointer drag: released over an Area / domain block outside its own list) or by
// "Move to..." and Move. Areas are created, renamed, deleted (empty) and reordered here. A Map view shows the same data
// as Areas > domains > competency chips. Pieces live in studio-areas.ts, OrganiseControls.tsx and FrameworkMap.tsx; the
// server decides every move (published frameworks: layout draft).
//
// FRAMEWORK-DESIGN-STUDIO-02 S6 (D2): on a published framework the competencies the OPEN REVISION holds arrive here with the
// proposed values already laid over them (revision-ui.ts overlayDomains), a `rev` mark (Changed / New / n retired) and the
// published values in `published`. The explorer tags them, the properties panel edits the proposed values (the server saves
// every edit into the revision), and "Show published version" renders the published values read only. A NEW competency is
// not reordered or moved between domains here (it has no live row: the server answers 404), and a criteria reorder inside a
// competency the revision holds is a move_criterion (saved in the revision), not a reorder_layout.

export type StudioStatus = "eligible" | "in_review" | "approved" | "changes_requested" | "framework_locked" | "unreadable";
export type StudioCompetency = {
  id: string; code: string | null; name: string; description: string | null; learningOutcomes: string[]; expectedLevelId: string | null;
  riskCategory: string; sortOrder: number; cpuId: string | null; status: StudioStatus; statusText: string;
  criteria: { id?: string; component: string | null; text: string; sourceRef: string | null; active?: boolean; /** S6: what the open revision does to this criterion. */ mark?: CritMark }[];
  /** S6: what the open revision does to this competency (absent: the revision does not hold it). */
  rev?: RevMark;
  /** S6: the published values of a competency the revision holds (null: it is new). */
  published?: PublishedFields | null;
};
export type StudioDomain = { id: string; name: string; competencies: StudioCompetency[]; cpus: { id: string; label: string }[]; /** 760: the domain's Area (null: none). */ areaId?: string | null };

const DOT: Record<StudioStatus, string> = {
  eligible: "bg-teal-600", in_review: "bg-blue-600", approved: "bg-violet-600", changes_requested: "bg-amber-500", framework_locked: "bg-gray-400", unreadable: "bg-red-500",
};
const CHIP: Record<StudioStatus, [string, string]> = {
  eligible: ["Ready for review", "bg-teal-50 text-teal-900"], in_review: ["In review", "bg-blue-50 text-blue-900"], approved: ["Reviewed", "bg-violet-50 text-violet-900"],
  changes_requested: ["Needs attention", "bg-amber-50 text-amber-900"], framework_locked: ["Locked", "bg-gray-100 text-gray-800"], unreadable: ["State unreadable", "bg-red-50 text-red-900"],
};
const MAP_STATUS: Record<string, { label: string; dot: string }> = Object.fromEntries((Object.keys(CHIP) as StudioStatus[]).map(k => [k, { label: CHIP[k][0], dot: DOT[k] }]));
const link = "text-[13px] font-semibold text-teal-800 hover:underline disabled:opacity-50";
const AUTHORING = "/api/hq/competency/authoring";
const mvBtn = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-[12px] leading-none text-gray-800 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:opacity-40 pointer-coarse:h-[var(--cmp-touch-min)] pointer-coarse:w-[var(--cmp-touch-min)]";
const overCls = "outline outline-2 outline-teal-600";

type View = { domains: StudioDomain[]; sections: string[]; areas: StudioArea[] };
/** One list that can be reordered: what the server needs to name it, and how the local view takes the new order. */
type Group = {
  key: string; level: "domains" | "competencies" | "criteria" | "sections" | "areas"; parentId?: string; component?: string | null;
  ids: string[]; names: string[]; apply: (v: View, ids: string[]) => View;
  /** The order to send when the list shown is only part of the parent (retired criteria keep their slots, a domain list inside one Area). */
  expand?: (ids: string[]) => string[];
  /** S4: a request other than reorder_layout (reorder_areas). */
  post?: (ids: string[]) => Record<string, unknown>;
};
/** What a row needs to be reorderable: its drop-target attributes, a grip to drag by, and the Move up / Move down pair. */
export type Reorder = {
  on: boolean;
  row: (g: Group, i: number) => { "data-drop-key": string; "data-drop-index": number; className?: string };
  grip: (g: Group, i: number, className?: string) => React.ReactNode;
  buttons: (g: Group, i: number) => React.ReactNode;
  criteriaGroup: (c: StudioCompetency, component: string | null) => Group;
};

const sameKeyFor = (group: Group, i: number) => `${group.key}|${group.ids[i]}`;

export default function StudioWorkspace({ frameworkId, domains: domainsIn, levels, components, editable, initialId, canReorder = false, sectionCodes, draftMode = false, pubStatus = "draft", areas: areasIn, areasReady = false, revision, revisionKey = "" }: {
  frameworkId: string; domains: StudioDomain[]; levels: { id: string; score: number; label: string }[];
  components: Record<string, string>; editable: boolean; initialId: string | null;
  /** The order can be changed: the framework is editable and 750/751 are on this environment (the server decides again). */
  canReorder?: boolean; sectionCodes?: string[];
  /** A framework that has been published: a move is saved as a draft layout and learners keep the published order. */
  draftMode?: boolean;
  /** Criteria are added, edited, retired and moved in a DRAFT framework only (S1); anything else goes through a revision draft. */
  pubStatus?: string;
  /** S4 (760): the framework's Areas as the editor sees them (draft applied); areasReady = 760 is on this environment. */
  areas?: StudioArea[]; areasReady?: boolean;
  /** S6: a published, centrally governed framework. `ready` = 770 is on this environment, `open` = a revision draft exists. */
  revision?: { ready: boolean; open: boolean };
  /** S6: changes when the revision is saved, so the panel's forms start from the saved values. */
  revisionKey?: string;
}) {
  const router = useRouter();
  const sections0 = sectionCodes ?? Object.keys(components);
  const [view, setView] = useState<View>({ domains: domainsIn, sections: sections0, areas: areasIn ?? [] });
  const [seen, setSeen] = useState({ d: domainsIn, s: sectionCodes, a: areasIn });
  // New props (after router.refresh) replace the local view; until then the optimistic view stands.
  if (seen.d !== domainsIn || seen.s !== sectionCodes || seen.a !== areasIn) { setSeen({ d: domainsIn, s: sectionCodes, a: areasIn }); setView({ domains: domainsIn, sections: sections0, areas: areasIn ?? [] }); }
  const domains = view.domains;
  const all = useMemo(() => domains.flatMap(d => d.competencies.map(c => ({ c, d }))), [domains]);
  const [active, setActive] = useState<string | null>(initialId && all.some(x => x.c.id === initialId) ? initialId : all[0]?.c.id ?? null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(all.find(x => x.c.id === (initialId ?? all[0]?.c.id))?.d.id ? [all.find(x => x.c.id === (initialId ?? all[0]?.c.id))!.d.id] : []));
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"tree" | "map">("tree");
  const [showPublished, setShowPublished] = useState(false);
  const revOpen = !!revision?.open;
  const query = q.trim().toLowerCase();
  const match = (c: StudioCompetency) => !query || c.name.toLowerCase().includes(query) || (c.code ?? "").toLowerCase().includes(query);
  const cur = all.find(x => x.c.id === active) ?? null;
  const targets = useMemo(() => all.map(x => ({ id: x.c.id, label: `${x.d.name}: ${x.c.code ? `${x.c.code} ` : ""}${x.c.name}` })), [all]);

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
  const drag = useRef<PointerDrag | null>(null);
  const focusNext = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // The list's height is the user's (drag handle under the list, remembered per browser); until then it fills what the panel allows.
  const { size: listH, bindTarget: bindList, handleProps: listHandle } = useResizable<HTMLDivElement>({ storageKey: "studio.explorer.h", axis: "y", minPx: 160, maxPx: vh => Math.max(160, vh - 64) });
  const [pickedDomains, setPickedDomains] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkRun, setBulkRun] = useState<{ done: number; total: number } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
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
        body: JSON.stringify(g.post ? g.post(ids) : { action: "reorder_layout", frameworkId, level: g.level, ...(g.parentId ? { parentId: g.parentId } : {}), ...(g.level === "criteria" ? { component: g.component ?? null } : {}), order: g.expand ? g.expand(ids) : ids }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setView(before); setFail(j?.error ?? "That order could not be saved. Nothing has changed."); setSay(""); return; }
      startRefresh(() => router.refresh());
    } catch { setView(before); setFail("That order could not be saved. Check your connection. Nothing has changed."); setSay(""); } finally { setSaving(false); }
  }

  const rx: Reorder = {
    on: reorderable,
    // A reorder drop is only inside the list the drag started in; across parents only the S4 organisational moves (crossTarget).
    row: (g, i) => ({ "data-drop-key": g.key, "data-drop-index": i, className: over === sameKeyFor(g, i) ? overCls : undefined }),
    grip: (g, i, className = "") => (
      <span aria-hidden title="Drag to reorder" data-grip className={`inline-flex shrink-0 cursor-grab touch-none select-none items-center justify-center text-gray-400 active:cursor-grabbing pointer-coarse:h-[var(--cmp-touch-min)] pointer-coarse:w-[var(--cmp-touch-min)] ${className}`}
        onPointerDown={e => {
          if (busy || (e.pointerType === "mouse" && e.button !== 0)) return;
          e.stopPropagation();
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
          drag.current = startPointerDrag(g.key, i, e.clientX, e.clientY);
        }}
        onPointerMove={e => {
          const st = drag.current; if (!st) return;
          const hit = document.elementFromPoint(e.clientX, e.clientY), el = hit?.closest<HTMLElement>("[data-drop-key]");
          const next = movePointerDrag(st, e.clientX, e.clientY, readDropTarget(el?.dataset.dropKey, el?.dataset.dropIndex));
          drag.current = next;
          const id = next.active && next.over !== null ? g.ids[next.over] : undefined;
          // Not over a row of its own list: an Area / domain block it may be moved into (S4), if any.
          setOver(id ? `${g.key}|${id}` : crossTarget(next, hit)?.tag ?? null);
        }}
        onPointerUp={e => {
          const st = drag.current; drag.current = null; setOver(null);
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
          const d = st ? dropOf(st) : null;
          if (d) void move(g, d.from, d.to);
          else if (st) { const x = crossTarget(st, document.elementFromPoint(e.clientX, e.clientY)); if (x) void organiseMove(x.action); }
        }}
        onPointerCancel={() => { drag.current = null; setOver(null); }}>⠿</span>
    ),
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
      const sec = c.criteria.filter(k => (k.component ?? null) === component && k.id);
      const list = sec.filter(k => k.active !== false);
      return {
        key: `criteria:${c.id}:${component ?? ""}`, level: "criteria", parentId: c.id, component,
        ids: list.map(k => k.id!), names: list.map(k => k.text),
        // The server wants the whole section: retired criteria stay where they are.
        expand: ids => { const q = [...ids]; return sec.map(k => (k.active === false ? k.id! : q.shift()!)); },
        // S6: inside a competency the open revision holds, a reorder is saved in the revision (move_criterion), one criterion to a place.
        ...(c.rev ? { post: (ids: string[]) => {
          const q = [...ids], full = sec.map(k => (k.active === false ? k.id! : q.shift()!)), mv = movedPosition(list.map(k => k.id!), ids, full);
          return mv ? { action: "move_criterion", criterionId: mv.id, position: mv.position } : { action: "reorder_layout", frameworkId, level: "criteria", parentId: c.id, component, order: full };
        } } : {}),
        apply: (v, ids) => ({
          ...v, domains: v.domains.map(d => ({ ...d, competencies: d.competencies.map(x => {
            if (x.id !== c.id) return x;
            const byId = new Map(x.criteria.map(k => [k.id, k])), queue = [...ids];
            // The section's criteria take the section's own slots; other sections do not move.
            return { ...x, criteria: x.criteria.map(k => ((k.component ?? null) === component && k.id && k.active !== false ? byId.get(queue.shift())! : k)) };
          }) })),
        }),
      };
    },
  };
  // ── S4: Areas and organisational moves (no clinical re-review: the server keeps them outside the clinical fingerprint) ──
  const organise = areasReady && reorderable;           // 760 is on this environment and the framework is editable
  const organiseLists = organise && !query;
  const hasAreas = areasReady && view.areas.length > 0;
  const groups = useMemo(() => groupDomains(domains, hasAreas ? view.areas : undefined), [domains, view.areas, hasAreas]);
  /** A domain list is one Area's domains (or all domains when there are no Areas); the order sent is the whole framework's. */
  const domainGroupOf = (grp: { area: StudioArea | null; domains: StudioDomain[] }): Group => {
    const ids = grp.domains.map(d => d.id);
    return {
      key: hasAreas ? `domains:${grp.area?.id ?? "none"}` : "domains", level: "domains", ids, names: grp.domains.map(d => d.name),
      expand: next => expandOrder(domains.map(d => d.id), ids, next),
      apply: (v, next) => ({ ...v, domains: arrange(v.domains, expandOrder(v.domains.map(d => d.id), ids, next), d => d.id) }),
    };
  };
  const areaGroup: Group = {
    key: "areas", level: "areas", ids: view.areas.map(a => a.id), names: view.areas.map(a => a.name),
    apply: (v, ids) => ({ ...v, areas: arrange(v.areas, ids, a => a.id) }),
    post: ids => ({ action: "reorder_areas", frameworkId, order: ids }),
  };
  /** One organisational request: optimistic when `apply` is given, put back if the server refuses. */
  async function act(body: Record<string, unknown>, said: string, apply?: (v: View) => View): Promise<boolean> {
    if (busy) return false;
    const before = view;
    setFail(null);
    if (apply) setView(apply(before));
    setSaving(true);
    try {
      const res = await fetch(AUTHORING, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, frameworkId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setView(before); setFail(j?.error ?? "That could not be saved. Nothing has changed."); setSay(""); return false; }
      setSay(`${said}${draftMode ? " Saved to the draft layout. Learners keep the published structure." : ""}`);
      startRefresh(() => router.refresh());
      return true;
    } catch { setView(before); setFail("That could not be saved. Check your connection. Nothing has changed."); setSay(""); return false; } finally { setSaving(false); }
  }
  function organiseMove(a: OrgAction) {
    if (a.action === "set_domain_area") {
      const name = domains.find(d => d.id === a.domainId)?.name ?? "The domain";
      return act(a, announceAreaMove(name, view.areas.find(x => x.id === a.areaId)?.name ?? null), v => ({ ...v, domains: setDomainArea(v.domains, a.domainId, a.areaId) }));
    }
    const name = all.find(x => x.c.id === a.competencyId)?.c.name ?? "The competency";
    setOpen(s => new Set(s).add(a.domainId));
    return act(a, announceCompetencyMove(name, domains.find(d => d.id === a.domainId)?.name ?? "the domain"), v => ({ ...v, domains: moveCompetency(v.domains, a.competencyId, a.domainId) }));
  }
  // Bulk: several domains to one Area (or Unassigned) with the existing set_domain_area request, one domain at a time.
  const bulk = organiseLists && hasAreas;
  const pickedNow = useMemo(() => keepVisible(pickedDomains, bulk ? domains.map(d => d.id) : []), [pickedDomains, bulk, domains]);
  async function bulkMove() {
    if (busy || !bulk || !bulkTarget) return;
    const areaId = bulkTarget === "__none" ? null : bulkTarget;
    const ids = toMove(pickedNow, domains, areaId);
    const areaName = view.areas.find(a => a.id === areaId)?.name ?? null;
    if (!ids.length) { setSay("Nothing to move: the selected domains are already there."); return; }
    setFail(null); setSay(""); setSaving(true);
    let done = 0, stopped: string | null = null;
    try {
      for (const id of ids) {
        setBulkRun({ done, total: ids.length });
        const name = domains.find(d => d.id === id)?.name ?? "a domain";
        let why: string | null = null;
        try {
          const res = await fetch(AUTHORING, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_domain_area", domainId: id, areaId, frameworkId }) });
          if (!res.ok) why = (await res.json().catch(() => ({})))?.error ?? "it could not be saved.";
        } catch { why = "check your connection."; }
        if (why) { stopped = announceBulkStopped(done, ids.length, name, why); break; }
        done++;
        setView(v => ({ ...v, domains: setDomainArea(v.domains, id, areaId) }));
        setPickedDomains(sel => { const n = new Set(sel); n.delete(id); return n; });
      }
    } finally { setBulkRun(null); setSaving(false); }
    if (stopped) { setFail(stopped); setSay(stopped); } else { setSay(`${announceBulkDone(done, areaName)}${draftMode ? " Saved to the draft layout. Learners keep the published structure." : ""}`); setBulkTarget(""); }
    if (done > 0) startRefresh(() => router.refresh());
    if (!stopped) titleRef.current?.focus();
  }
  /** What the pointer drag `d` carries, read from the list it started in. */
  function dragSource(d: PointerDrag | null): DragSource | null {
    if (!d) return null;
    if (d.key.startsWith("competencies:")) {
      const domainId = d.key.slice("competencies:".length), c = view.domains.find(x => x.id === domainId)?.competencies[d.index];
      return c ? { kind: "competency", id: c.id, domainId } : null;
    }
    if (d.key.startsWith("domains")) {
      const grp = groups.find(g => domainGroupOf(g).key === d.key), dom = grp?.domains[d.index];
      return dom ? { kind: "domain", id: dom.id, areaId: grp?.area?.id ?? null } : null;
    }
    return null;
  }
  /** The organisational move for an active drag released at `hit` outside its own list: a competency onto a domain block
   *  (data-drop-domain), a domain onto an Area block (data-drop-area, "none" = Unassigned). Null when there is none. */
  function crossTarget(d: PointerDrag, hit: Element | null): { action: OrgAction; tag: string } | null {
    if (!organiseLists || !d.active) return null;
    const src = dragSource(d); if (!src) return null;
    let t: DropTarget | null = null, tag = "";
    if (src.kind === "competency") {
      const id = hit?.closest<HTMLElement>("[data-drop-domain]")?.dataset.dropDomain;
      if (id) { t = { kind: "domain", domainId: id }; tag = `dom|${id}`; }
    } else {
      const id = hit?.closest<HTMLElement>("[data-drop-area]")?.dataset.dropArea;
      if (id) { t = { kind: "area", areaId: id === "none" ? null : id }; tag = `area|${id}`; }
    }
    const action = t ? dropAction(src, t) : null;
    return action ? { action, tag } : null;
  }
  const areaOptions = (current: string | null) => [...view.areas.filter(a => a.id !== current).map(a => ({ value: a.id, label: a.name })), ...(current ? [{ value: "__none", label: "No Area (Unassigned)" }] : [])];
  const compGroup = (d: StudioDomain): Group => ({
    key: `competencies:${d.id}`, level: "competencies", parentId: d.id, ids: d.competencies.filter(c => c.rev?.state !== "new").map(c => c.id), names: d.competencies.filter(c => c.rev?.state !== "new").map(c => c.name),
    apply: (v, ids) => ({ ...v, domains: v.domains.map(x => (x.id === d.id ? { ...x, competencies: arrange(x.competencies, ids, c => c.id) } : x)) }),
  });
  const sectionGroup: Group = {
    key: "sections", level: "sections", ids: view.sections, names: view.sections.map(c => components[c] ?? c),
    apply: (v, ids) => ({ ...v, sections: ids }),
  };

  return (
    <div className="grid gap-5" ref={root}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{say}</p>
      <div role="group" aria-label="Framework view" className="flex gap-2">
        {(["tree", "map"] as const).map(m => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)] ${mode === m ? "border-teal-900 bg-teal-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`}>{m === "tree" ? "Tree" : "Map"}</button>
        ))}
      </div>
      {mode === "map" ? (
        <div className="min-w-0">
          <FrameworkMap domains={domains} areas={hasAreas ? view.areas : undefined} activeId={active} status={MAP_STATUS}
            onSelect={id => { choose(id); const d = domains.find(x => x.competencies.some(c => c.id === id)); if (d) setOpen(s => new Set(s).add(d.id)); setMode("tree"); setSay(`Opened ${all.find(x => x.c.id === id)?.c.name ?? "the competency"} in the editor.`); }} />
        </div>
      ) : (
      <ResizableColumns storageKey="studio.explorer.w" defaultLeft={320} minLeft={240} minRight={420} label="Resize the explorer"
        left={
      <aside aria-label="Competency explorer" className="flex max-h-[calc(100vh-12rem)] min-w-0 flex-col rounded-2xl border border-gray-200 bg-white md:sticky md:top-4 md:max-h-[calc(100vh-2rem)]">
        <div className="border-b border-gray-100 px-4 pb-3 pt-4">
          <div className="flex items-baseline justify-between"><h2 ref={titleRef} tabIndex={-1} className="text-[15px] font-bold text-gray-900 focus:outline-none">Competency explorer</h2><span className="text-[12px] text-gray-500">{domains.length} domains</span></div>
          <label className="sr-only" htmlFor="cx-q">Find a competency or code</label>
          <input id="cx-q" value={q} onChange={e => { setQ(e.target.value); if (e.target.value.trim()) setPickedDomains(clearSelection()); }} placeholder="Find a competency or code…" className="mt-2 block w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)]" />
          {(reorderable || organiseLists) && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] font-semibold text-teal-800 pointer-coarse:flex pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:items-center">How to organise</summary>
              {reorderable && <p className="mt-1 text-[11.5px] text-gray-600">{query ? "Clear the search to reorder domains and competencies." : "Drag a row, or use the arrow buttons, to change the order."}{draftMode ? " Learners keep the published order until a draft layout is published." : ""}</p>}
              {organiseLists && <p className="mt-1 text-[11.5px] text-gray-600">Drag a domain onto an Area, or a competency onto a domain, or use Move to… and Move. These are organisational moves: no clinical re-review.{hasAreas ? " To move several domains at once, tick them and use Move to… below the list." : ""}</p>}
            </details>
          )}
          {fail && <p role="alert" className="mt-2 text-[12.5px] font-medium text-red-700">{fail}</p>}
        </div>
        <div ref={bindList} style={listH != null ? ({ "--cx-h": `${listH}px` } as React.CSSProperties) : undefined}
          className={`min-h-0 flex-1 overflow-y-auto py-1 md:min-h-[160px] ${listH != null ? "md:[flex:0_1_auto] md:[height:var(--cx-h)]" : ""}`}>
          {organiseLists && (
            <details className="mx-2 mb-1 rounded-lg border border-gray-200 px-2 py-1">
              <summary className="cursor-pointer py-1 text-[13px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)]">{hasAreas ? "Add an Area" : "Group domains into Areas"}</summary>
              <p className="mb-1 text-[11.5px] text-gray-600">An Area groups domains, for example Clinical Practice. It is organisational: no competency, criterion or outcome changes.</p>
              <div className="pb-1"><AddAreaForm busy={busy} onCreate={name => act({ action: "create_area", name }, `Added the Area ${name}.`)} /></div>
            </details>
          )}
          {groups.map((grp, gi) => {
            const dg = domainGroupOf(grp);
            const areaId = grp.area?.id ?? null, aTag = `area|${areaId ?? "none"}`;
            const rendered = grp.domains.map((d, di) => {
            const comps = d.competencies.filter(match);
            if (query && !comps.length) return null;
            const isOpen = query ? true : open.has(d.id);
            const cg = compGroup(d);
            return (
              <div key={d.id} {...(organiseLists ? { "data-drop-domain": d.id } : {})} className={over === `dom|${d.id}` ? overCls : undefined}>
                <div {...(reorderLists ? rx.row(dg, di) : {})} className={`flex items-center gap-1 pr-2 hover:bg-gray-50 ${reorderLists && over === sameKeyFor(dg, di) ? overCls : ""}`}>
                  {bulk && <input type="checkbox" aria-label={`Select ${d.name}`} checked={pickedNow.has(d.id)} disabled={busy} onChange={() => setPickedDomains(toggleId(pickedNow, d.id))} className="ml-2 shrink-0 pointer-coarse:h-5 pointer-coarse:w-5" />}
                  {reorderLists && rx.grip(dg, di, bulk ? "" : "pl-2")}
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(s => toggle(s, d.id))}
                    className="flex min-w-0 flex-1 items-center justify-between px-2 py-2.5 text-left text-[13.5px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                    <span className="min-w-0"><span aria-hidden className="mr-1.5 inline-block w-3 text-gray-500">{isOpen ? "▾" : "▸"}</span>{d.name}</span>
                    <span className="ml-2 text-[12px] font-normal text-gray-500">{d.competencies.length}</span>
                  </button>
                  {reorderLists && rx.buttons(dg, di)}
                </div>
                {isOpen && organiseLists && hasAreas && (
                  <MoveSelect className="mx-3 mb-1" label={`Move ${d.name} to Area…`} busy={busy} options={areaOptions(areaId)}
                    onMove={v => void organiseMove({ action: "set_domain_area", domainId: d.id, areaId: v === "__none" ? null : v })} />
                )}
                {isOpen && comps.map(c => {
                  const isNew = c.rev?.state === "new";             // S6: a new revision competency has no live row to reorder or move
                  const ci = isNew ? -1 : d.competencies.findIndex(x => x.id === c.id);
                  const tags = revisionTags(c.rev);
                  return (
                    <Fragment key={c.id}>
                    <div {...(reorderLists && !isNew ? rx.row(cg, ci) : {})}
                      className={`mx-2 mb-1 flex items-start gap-2 rounded-lg px-2 py-2 ${c.id === active ? "border-l-4 border-teal-700 bg-teal-50/70" : "hover:bg-gray-50"} ${reorderLists && !isNew && over === sameKeyFor(cg, ci) ? overCls : ""}`}>
                      {reorderLists && !isNew && rx.grip(cg, ci, "mt-1")}
                      <input type="checkbox" aria-label={revOpen && !c.rev ? `${c.name} is not in the revision draft` : `Select ${c.name}`} className="mt-1" checked={picked.has(c.id)} disabled={revOpen && !c.rev} onChange={() => setPicked(s => toggle(s, c.id))} />
                      <button type="button" onClick={() => choose(c.id)} aria-current={c.id === active ? "true" : undefined} className="min-w-0 flex-1 text-left">
                        <span className="block text-[13.5px] text-gray-900">{c.name}</span>
                        <span className="block font-mono text-[11.5px] text-gray-500">{c.code ?? "no code"} · {c.criteria.filter(k => k.active !== false).length} criteria</span>
                        {tags.length > 0 && <span className="mt-0.5 flex flex-wrap gap-1">{tags.map(t => <span key={t} className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">{t}</span>)}</span>}
                      </button>
                      <span title={CHIP[c.status][0]} aria-label={CHIP[c.status][0]} className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[c.status]}`} />
                      {reorderLists && !isNew && rx.buttons(cg, ci)}
                    </div>
                    {organiseLists && c.id === active && !isNew && domains.length > 1 && (
                      <MoveSelect className="mx-3 mb-1" label={`Move ${c.name} to domain…`} busy={busy} options={domains.filter(x => x.id !== d.id).map(x => ({ value: x.id, label: x.name }))}
                        onMove={v => void organiseMove({ action: "move_competency_domain", competencyId: c.id, domainId: v })} />
                    )}
                    </Fragment>
                  );
                })}
              </div>
            );
            });
            if (!hasAreas) return <Fragment key="all">{rendered}</Fragment>;
            if (query && rendered.every(x => x === null)) return null;
            const hid = `area-h-${areaId ?? "none"}`;
            return (
              <section key={areaId ?? "none"} aria-labelledby={hid} {...(organiseLists ? { "data-drop-area": areaId ?? "none" } : {})} className={`mb-1 ${over === aTag ? overCls : ""}`}>
                <AreaHeading headingId={hid} name={grp.area?.name ?? "Unassigned"} count={grp.domains.length} busy={busy}
                  organise={organiseLists && !!grp.area} rowProps={organiseLists && grp.area ? rx.row(areaGroup, gi) : undefined} grip={organiseLists && grp.area ? rx.grip(areaGroup, gi) : undefined} buttons={organiseLists && grp.area ? rx.buttons(areaGroup, gi) : undefined}
                  onRename={name => act({ action: "rename_area", areaId, name }, `Renamed the Area to ${name}.`, v => ({ ...v, areas: v.areas.map(a => (a.id === areaId ? { ...a, name } : a)) }))}
                  onDelete={() => { if (areaId && window.confirm(`Delete the empty Area ${grp.area!.name}?`)) void act({ action: "delete_area", areaId }, `Deleted the Area ${grp.area!.name}.`, v => ({ ...v, areas: v.areas.filter(a => a.id !== areaId) })); }} />
                {bulk && grp.domains.length > 0 && (
                  <div className="px-3 pb-1">
                    <button type="button" className={`${link} pointer-coarse:min-h-[var(--cmp-touch-min)]`} disabled={busy} onClick={() => setPickedDomains(selectAllIn(pickedNow, grp.domains.map(d => d.id)))}
                      aria-label={grp.area ? `Select all domains in ${grp.area.name}` : "Select all unassigned domains"}>{grp.area ? "Select all" : "Select all unassigned"}</button>
                  </div>
                )}
                {rendered}
                {!grp.domains.length && <p className="px-3 py-2 text-[12px] text-gray-600">No domain in this Area. {organiseLists ? "Drag a domain here, or use Move to Area on a domain." : ""}</p>}
              </section>
            );
          })}
          {reorderable && view.sections.length > 1 && (
            <details className="mx-2 mt-2 rounded-lg border border-gray-200 px-2 py-1">
              <summary className="cursor-pointer py-1 text-[13px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)]">Section order</summary>
              <p className="text-[11.5px] text-gray-600">The order of the assessment sections in this framework.</p>
              <ol className="mt-1 space-y-1 pb-1">
                {view.sections.map((code, i) => (
                  <li key={code} {...rx.row(sectionGroup, i)} className={`flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-gray-50 ${over === sameKeyFor(sectionGroup, i) ? overCls : ""}`}>
                    {rx.grip(sectionGroup, i)}
                    <span className="min-w-0 flex-1 text-[13px] text-gray-900">{components[code] ?? code}</span>
                    {rx.buttons(sectionGroup, i)}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
        <ResizeHandle {...listHandle} label="Resize the competency list" className="hidden shrink-0 md:block" />
        {bulk && pickedNow.size > 0 && (
          <div role="group" aria-label="Move the selected domains" className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-teal-50/60 px-3 py-2">
            <span className="text-[12.5px] font-semibold text-gray-900">{pickedNow.size} selected</span>
            <label className="sr-only" htmlFor="cx-bulk-area">Move the selected domains to</label>
            <select id="cx-bulk-area" value={bulkTarget} disabled={busy} onChange={e => setBulkTarget(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-[13px] pointer-coarse:min-h-[var(--cmp-touch-min)]">
              <option value="">Move to…</option>
              {view.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value="__none">Unassigned</option>
            </select>
            <button type="button" className={link} disabled={busy || !bulkTarget} onClick={() => void bulkMove()}>Move</button>
            <button type="button" className={link} disabled={busy} onClick={() => setPickedDomains(clearSelection())}>Clear</button>
            {bulkRun && <span role="status" className="basis-full text-[12px] text-gray-700">{bulkProgress(bulkRun.done, bulkRun.total)}</span>}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-gray-100 px-4 py-2">
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
            {(["eligible", "in_review", "approved", "changes_requested"] as StudioStatus[]).map(s => <span key={s} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${DOT[s]}`} />{CHIP[s][0]}</span>)}
          </p>
          <span className="flex items-center gap-3">
            <span className="text-[12.5px] text-gray-700">{picked.size} selected</span>
            <ReviewButton frameworkId={frameworkId} scope={{ kind: "competencies", ids: [...picked] }} revision={revOpen} label="Review selected →" className={link} disabled={!picked.size || !editable} />
          </span>
        </div>
      </aside>
        }
        right={

      <section aria-label="Competency" className="min-w-0 rounded-2xl border border-gray-200 bg-white">
        {!cur ? <p className="p-6 text-[13.5px] text-gray-600">This framework has no competency yet. Add one from Overview &amp; governance.</p> : (() => {
          // S6: "Show published version" renders the published values of a competency the revision holds, read only.
          const pub = showPublished && !!cur.c.rev && !!cur.c.published;
          const shown: StudioCompetency = pub ? { ...cur.c, ...cur.c.published!, rev: undefined } : cur.c;
          const revisable = !!revision && revision.ready;
          const criteriaOk = editable && !pub && (pubStatus === "draft" || revisable);
          const lock = pub ? "You are looking at the published version, read only. Switch back to the revision to edit."
            : criteriaOk ? null
            : revision && !revision.ready ? "Revision drafts are not available on this environment right now (see the note at the top of the page), so a published framework is not changed here."
            : !editable ? "This framework is under governance review or archived, so nothing here is edited."
            : "Criteria are changed in a draft framework or, once published, in a revision draft. This published framework cannot be revised here.";
          return (
          <>
            <div className="border-b border-gray-100 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">{cur.d.name} / <span className="font-mono">{shown.code ?? "no code"}</span></p>
                <span className="flex flex-wrap items-center gap-1.5">
                  {!pub && revisionTags(cur.c.rev).map(t => <span key={t} className="rounded-md bg-amber-50 px-2 py-0.5 text-[12px] font-semibold text-amber-900">{t}</span>)}
                  <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${CHIP[cur.c.status][1]}`}>{CHIP[cur.c.status][0]}</span>
                </span>
              </div>
              <h2 className="mt-1 text-[20px] font-bold text-gray-900">{shown.name}</h2>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-gray-600">{cur.c.statusText} · {shown.criteria.filter(k => k.active !== false).length} source criteria</p>
                <ReviewButton frameworkId={frameworkId} scope={{ kind: "domain", domainId: cur.d.id }} revision={revOpen} label={revOpen ? "Review this domain's revision →" : "Review this domain →"} className={link} disabled={!editable} />
              </div>
              {revOpen && cur.c.rev && (
                <div role="group" aria-label="Which version to show" className="mt-3 flex flex-wrap gap-2">
                  {([[false, "Revision (proposed)"], [true, "Show published version"]] as const).map(([v, l]) => (
                    <button key={String(v)} type="button" aria-pressed={showPublished === v} disabled={v && !cur.c.published} onClick={() => setShowPublished(v)}
                      className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${showPublished === v ? "border-amber-700 bg-amber-100 text-amber-950" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`}>{l}</button>
                  ))}
                  {!cur.c.published && <span className="self-center text-[12px] text-gray-600">New competency: nothing is published yet.</span>}
                </div>
              )}
            </div>
            <div className="space-y-5 p-5">
              <PropertiesPanel key={`${cur.c.id}:${pub ? "pub" : "rev"}:${revisionKey}`} comp={shown} domain={cur.d} levels={levels} components={components} sections={view.sections} targets={targets} rx={rx}
                editable={editable && !pub} criteriaEditable={criteriaOk} lock={lock} revised={!!revision} />
              {editable && !pub && (cur.c.status === "eligible" || cur.c.status === "changes_requested") && (
                revOpen ? (cur.c.rev ? <SubmitRevisionReview competencyId={cur.c.id} frameworkId={frameworkId} /> : null)
                  : <SubmitReview competencyId={cur.c.id} />
              )}
            </div>
          </>
          );
        })()}
      </section>
        } />
      )}
    </div>
  );
}
