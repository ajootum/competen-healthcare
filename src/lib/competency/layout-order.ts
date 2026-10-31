/* eslint-disable @typescript-eslint/no-explicit-any */
// ── FRAMEWORK-DESIGN-STUDIO-01: PRESENTATION ORDER, PURE ── migration 750, owner rulings 1-3 (31 Oct 2026) ──────
//
// The order a framework is SHOWN in: its domains, the competencies of each domain, the criteria of each competency
// (within their section, component_code) and the order of its sections. None of it is in the 395/670 content hash,
// so none of it is clinical content. Everything here is pure and client-safe (no server import), so the Studio can
// render a pending layout with exactly the rules the server applies.
//
//   within the same parent      presentation only: a reorder (this module)
//   to another parent           a CLINICAL change (ruling 2): a competency to another domain, a criterion to another
//                               section or competency. Refused here, never expressible in a layout draft (750 guard)
//   learning outcomes           a CLINICAL change (ruling 1): their order is in the hash. Refused here, changed only
//                               by editing the competency (update_competency), which sends it back to clinical review
//
// A layout draft (frameworks.layout_draft, v1) names ids in order. A list may be partial: what it does not name keeps
// its current order after what it names, and an id that no longer exists is skipped.

export type LayoutV1 = {
  v: 1;
  domains?: string[];
  competencies?: Record<string, string[]>;
  criteria?: Record<string, string[]>;
  componentOrder?: string[] | null;
};

export type TreeCriterion = { id: string; name: string; sortOrder: number | null; component: string | null };
export type TreeCompetency = { id: string; name: string; sortOrder: number | null; criteria: TreeCriterion[] };
export type TreeDomain = { id: string; name: string; sortOrder: number | null; competencies: TreeCompetency[] };
/** A framework's structure. componentOrder is the framework's live section order (null: the registry's). */
export type LayoutTree = { domains: TreeDomain[]; componentOrder: string[] | null; registry: string[] };

export type ReorderLevel = "domains" | "competencies" | "criteria" | "sections" | "outcomes";
export type ReorderRequest = { level: ReorderLevel; parentId?: string | null; component?: string | null; order: string[] };
export type LayoutPatch =
  | { key: "domains"; ids: string[] }
  | { key: "competencies"; parentId: string; ids: string[] }
  | { key: "criteria"; parentId: string; ids: string[] }
  | { key: "componentOrder"; codes: string[] };
export type Classified = { ok: true; patch: LayoutPatch; unchanged: boolean } | { ok: false; clinical: boolean; error: string };

export const CLINICAL_EDIT_PATH = "Make it as a content edit of the competency, which sends it back through clinical review.";

/** Pure: the one stable order every read uses. sort_order (none last), then name, then id. */
export function byOrder(a: { sortOrder?: number | null; name?: string | null; id: string }, b: { sortOrder?: number | null; name?: string | null; id: string }): number {
  const x = a.sortOrder ?? Number.POSITIVE_INFINITY, y = b.sortOrder ?? Number.POSITIVE_INFINITY;
  if (x !== y) return x < y ? -1 : 1;
  const n = (a.name ?? "").localeCompare(b.name ?? "");
  if (n) return n;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
/** The same comparator for raw rows (sort_order, name, id). */
export const byRowOrder = (a: any, b: any) => byOrder({ sortOrder: a?.sort_order, name: a?.name, id: String(a?.id ?? "") }, { sortOrder: b?.sort_order, name: b?.name, id: String(b?.id ?? "") });
/** Pure: the live tree in its stable order. */
export function sortTree(t: LayoutTree): LayoutTree {
  return { ...t, domains: [...t.domains].sort(byOrder).map(d => ({ ...d, competencies: [...d.competencies].sort(byOrder).map(c => ({ ...c, criteria: [...c.criteria].sort(byOrder) })) })) };
}

/** Pure: `named` first (only ids that exist, each once), then everything else in its current order. */
export function arrange<T>(items: readonly T[], named: readonly string[] | undefined | null, idOf: (x: T) => string): T[] {
  if (!named?.length) return [...items];
  const by = new Map(items.map(x => [idOf(x), x]));
  const seen = new Set<string>(), out: T[] = [];
  for (const id of named) { const x = by.get(id); if (x && !seen.has(id)) { seen.add(id); out.push(x); } }
  for (const x of items) if (!seen.has(idOf(x))) out.push(x);
  return out;
}

/** Pure: the section order -- the layout's, else the framework's, else the registry's, then the rest of the registry. */
export function sectionOrder(t: Pick<LayoutTree, "componentOrder" | "registry">, layout?: LayoutV1 | null): string[] {
  const first = layout?.componentOrder ?? t.componentOrder ?? [];
  return arrange(t.registry, first, x => x);
}

/** Pure: the tree as the layout orders it (the live tree when there is no layout). */
export function applyLayout(t: LayoutTree, layout?: LayoutV1 | null): LayoutTree {
  const s = sortTree(t);
  if (!layout) return s;
  return {
    ...s,
    componentOrder: layout.componentOrder !== undefined ? layout.componentOrder : s.componentOrder,
    domains: arrange(s.domains, layout.domains, d => d.id).map(d => ({
      ...d,
      competencies: arrange(d.competencies, layout.competencies?.[d.id], c => c.id).map(c => ({ ...c, criteria: arrange(c.criteria, layout.criteria?.[c.id], k => k.id) })),
    })),
  };
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const isPermutation = (order: readonly string[], of: readonly string[]) => order.length === of.length && new Set(order).size === order.length && order.every(x => of.includes(x));

/**
 * Pure: what a reorder request is, decided by the system and never by the editor. A within-parent reorder becomes a
 * layout patch; anything that crosses a parent, or touches learning outcomes, is a clinical change and is refused.
 * `layout` is the pending draft (null for none), so a patch builds on what the editor already sees.
 */
export function classifyReorder(t: LayoutTree, layout: LayoutV1 | null, r: ReorderRequest): Classified {
  const order = Array.isArray(r?.order) ? r.order.filter(x => typeof x === "string") : [];
  if (r?.level === "outcomes")
    return { ok: false, clinical: true, error: "The order of learning outcomes is clinical content (it is part of what reviewers approve), so it is not a reorder. Change it in Edit competency: the competency then goes back through clinical review." };
  if (!order.length || order.length > 1000) return { ok: false, clinical: false, error: "Send the new order as a list." };
  const cur = applyLayout(t, layout);
  if (r.level === "domains") {
    const ids = cur.domains.map(d => d.id);
    if (!isPermutation(order, ids)) return { ok: false, clinical: false, error: "List every domain of this framework, each once, in the new order." };
    return { ok: true, patch: { key: "domains", ids: order }, unchanged: same(order, ids) };
  }
  if (r.level === "competencies") {
    const d = cur.domains.find(x => x.id === r.parentId);
    if (!d) return { ok: false, clinical: false, error: "Choose a domain of this framework." };
    const ids = d.competencies.map(c => c.id);
    const elsewhere = cur.domains.some(o => o.id !== d.id && o.competencies.some(c => order.includes(c.id)));
    if (elsewhere) return { ok: false, clinical: true, error: `Moving a competency to another domain is a clinical change, not a reorder. ${CLINICAL_EDIT_PATH}` };
    if (!isPermutation(order, ids)) return { ok: false, clinical: false, error: "List every competency of this domain, each once, in the new order." };
    return { ok: true, patch: { key: "competencies", parentId: d.id, ids: order }, unchanged: same(order, ids) };
  }
  if (r.level === "criteria") {
    const comps = cur.domains.flatMap(d => d.competencies);
    const c = comps.find(x => x.id === r.parentId);
    if (!c) return { ok: false, clinical: false, error: "Choose a competency of this framework." };
    const section = r.component ?? null;
    const group = c.criteria.filter(k => (k.component ?? null) === section).map(k => k.id);
    if (order.some(id => c.criteria.some(k => k.id === id && (k.component ?? null) !== section)))
      return { ok: false, clinical: true, error: `Moving a criterion to another section is a clinical change, not a reorder. ${CLINICAL_EDIT_PATH}` };
    if (order.some(id => comps.some(o => o.id !== c.id && o.criteria.some(k => k.id === id))))
      return { ok: false, clinical: true, error: `Moving a criterion to another competency is a clinical change, not a reorder. ${CLINICAL_EDIT_PATH}` };
    if (!group.length || !isPermutation(order, group)) return { ok: false, clinical: false, error: "List every criterion of this section, each once, in the new order." };
    // The section's criteria take the section's slots in the competency's whole order: other sections do not move.
    const queue = [...order];
    const ids = c.criteria.map(k => ((k.component ?? null) === section ? queue.shift()! : k.id));
    return { ok: true, patch: { key: "criteria", parentId: c.id, ids }, unchanged: same(ids, c.criteria.map(k => k.id)) };
  }
  if (r.level === "sections") {
    if (new Set(order).size !== order.length || order.some(x => !t.registry.includes(x))) return { ok: false, clinical: false, error: "Name each section once, from the assessment components." };
    const now = sectionOrder(t, layout);
    const codes = arrange(now, order, x => x);
    return { ok: true, patch: { key: "componentOrder", codes }, unchanged: same(codes, now) };
  }
  return { ok: false, clinical: false, error: "Choose what to reorder: domains, competencies, criteria or sections." };
}

/** Pure: the draft with this patch in it. */
export function mergeLayout(layout: LayoutV1 | null, p: LayoutPatch): LayoutV1 {
  const l: LayoutV1 = { v: 1, ...(layout ?? {}) };
  if (p.key === "domains") return { ...l, domains: p.ids };
  if (p.key === "competencies") return { ...l, competencies: { ...(l.competencies ?? {}), [p.parentId]: p.ids } };
  if (p.key === "criteria") return { ...l, criteria: { ...(l.criteria ?? {}), [p.parentId]: p.ids } };
  return { ...l, componentOrder: p.codes };
}

/** Pure: the draft without anything that equals the live order. null = nothing is pending. */
export function pruneLayout(t: LayoutTree, layout: LayoutV1 | null): LayoutV1 | null {
  if (!layout) return null;
  const s = sortTree(t), a = applyLayout(t, layout);
  const out: LayoutV1 = { v: 1 };
  if (layout.domains && !same(a.domains.map(d => d.id), s.domains.map(d => d.id))) out.domains = a.domains.map(d => d.id);
  for (const d of a.domains) {
    const live = s.domains.find(x => x.id === d.id)!;
    if (layout.competencies?.[d.id] && !same(d.competencies.map(c => c.id), live.competencies.map(c => c.id))) out.competencies = { ...(out.competencies ?? {}), [d.id]: d.competencies.map(c => c.id) };
    for (const c of d.competencies) {
      const lc = live.competencies.find(x => x.id === c.id)!;
      if (layout.criteria?.[c.id] && !same(c.criteria.map(k => k.id), lc.criteria.map(k => k.id))) out.criteria = { ...(out.criteria ?? {}), [c.id]: c.criteria.map(k => k.id) };
    }
  }
  if (layout.componentOrder && !same(sectionOrder(t, layout), sectionOrder(t, null))) out.componentOrder = layout.componentOrder;
  return Object.keys(out).length > 1 ? out : null;
}

export type SortWrite = { table: "framework_domains" | "framework_competencies" | "competency_skills"; id: string; from: number | null; to: number };
/**
 * Pure: the writes that make the live order what the layout says. Only the parents the layout names are
 * renumbered, densely 1..n, and only rows whose sort_order changes are written. componentOrder: undefined = unchanged.
 */
export function densePlan(t: LayoutTree, layout: LayoutV1): { writes: SortWrite[]; componentOrder: string[] | null | undefined } {
  const a = applyLayout(t, layout), writes: SortWrite[] = [];
  const dense = (table: SortWrite["table"], rows: { id: string; sortOrder: number | null }[]) =>
    rows.forEach((r, i) => { if (r.sortOrder !== i + 1) writes.push({ table, id: r.id, from: r.sortOrder, to: i + 1 }); });
  if (layout.domains) dense("framework_domains", a.domains);
  for (const d of a.domains) {
    if (layout.competencies?.[d.id]) dense("framework_competencies", d.competencies);
    for (const c of d.competencies) if (layout.criteria?.[c.id]) dense("competency_skills", c.criteria);
  }
  const componentOrder = layout.componentOrder === undefined ? undefined : layout.componentOrder === null ? null : sectionOrder(t, layout);
  return { writes, componentOrder };
}

/** Pure: a stored value as a v1 layout, or null. The database guard (750) is the authority on its validity. */
export function asLayout(v: unknown): LayoutV1 | null {
  return v && typeof v === "object" && (v as { v?: unknown }).v === 1 ? (v as LayoutV1) : null;
}
