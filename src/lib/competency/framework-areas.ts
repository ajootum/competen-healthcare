/* eslint-disable @typescript-eslint/no-explicit-any */
import { authored, editableFramework, isId, NOT_RECORDED, type Actor } from "./authoring";
import { layoutReady, loadLayoutTree, reordersDirectly, type LoadedLayout } from "./framework-layout";
import { applyLayout, areaName, classifyMove, mergeLayout, pruneLayout, sortTree, type LayoutPatch, type LayoutTree } from "./layout-order";

// ── FRAMEWORK-DESIGN-STUDIO-02 S3: AREAS AND ORGANISATIONAL MOVES ── migration 760, owner rulings D1 and D3 (31 Oct 2026) ──
//
// An Area is a configurable, organisational level above domains, named per framework (no profession is named in code).
// Putting a domain in an Area, ordering or renaming Areas, and moving a competency to another domain of the SAME
// framework change no clinical meaning: none of it is in the content hash, so it needs no repeat clinical review.
//
//   never-published draft   written live (as reorder_layout does). Nobody consumes it yet.
//   published (any version) written into frameworks.layout_draft only (areas, domainAreas, areaNames, a competency
//                           listed under its new domain). Learners keep the published organisation until an
//                           independent publisher releases it, applied atomically by the 760 publication trigger.
//                           Creating an Area on a published framework inserts an EMPTY Area row (it needs an id the
//                           draft can name). An Area with no live domain is inert: learners never read Areas and the
//                           published views show only Areas that hold a domain.
//
// ⚠ AUDIT FIRST, AS AN ORGANISATIONAL ACTION (ORGANISATIONAL_ACTIONS, F4): contribution for publication (640: the person
// cannot publish their own change), not authorship for clinical review (clinical-review.ts and the 760 DB guard).
//
// ⚠ STILL SUBSTANTIVE, NEVER HERE: a criterion to another section or competency, outcomes, any hashed field. The 750 and
// 760 guards refuse them in a layout draft. They go through revision drafts (S5).
//
// ⚠ FAILS CLOSED. Without 760 (or 750/751) every action answers 409 and writes nothing, and every read is unchanged.

type Fail = { ok: false; status: number; error: string };
const NOT_READY: Fail = { ok: false, status: 409, error: "Areas and moves between domains are not set up on this environment yet (migration 760). Nothing has changed." };
const UNREADABLE: Fail = { ok: false, status: 503, error: "The framework could not be read just now. Nothing has changed." };
const missing = (e: any) => ["42703", "42P01", "PGRST204", "PGRST200", "PGRST205"].includes(String(e?.code ?? "")) || /does not exist|could not find/i.test(String(e?.message ?? ""));

export type OrganiseResult = { ok: true; mode: "direct" | "draft"; unchanged: boolean; layoutPending: boolean; id?: string } | Fail;
export type AreaRow = { id: string; name: string; description: string | null; sortOrder: number };

/** Whether 760 is on this environment. Zero-row reads only. */
export async function areasReady(admin: any): Promise<boolean> {
  try {
    const [a, d] = await Promise.all([
      admin.from("framework_areas").select("id, framework_id, name, description, sort_order").limit(0),
      admin.from("framework_domains").select("id, area_id").limit(0),
    ]);
    return !a.error && !d.error;
  } catch { return false; }
}

/** A framework's Areas (live, in order) and each domain's live Area. null = 760 absent, Fail = unreadable. */
export async function loadAreas(admin: any, frameworkId: string): Promise<{ areas: AreaRow[]; domainArea: Map<string, string | null> } | null | Fail> {
  const [a, d] = await Promise.all([
    admin.from("framework_areas").select("id, name, description, sort_order").eq("framework_id", frameworkId),
    admin.from("framework_domains").select("id, area_id").eq("framework_id", frameworkId),
  ]);
  if (a.error || d.error) return missing(a.error ?? d.error) ? null : UNREADABLE;
  const areas = ((a.data ?? []) as any[]).map(r => ({ id: r.id, name: r.name, description: r.description ?? null, sortOrder: r.sort_order ?? 0 }))
    .sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name) || (x.id < y.id ? -1 : 1));
  return { areas, domainArea: new Map(((d.data ?? []) as any[]).map(r => [r.id, r.area_id ?? null])) };
}

type Ctx = { L: LoadedLayout; direct: boolean; areas: AreaRow[] };

/** The framework, editable, with its tree, Areas and pending draft. Gate first: 750/751 and 760. */
async function open(admin: any, frameworkId: unknown): Promise<Ctx | Fail> {
  const g = await editableFramework(admin, frameworkId as string);
  if (!g.ok) return g;
  if (!(await layoutReady(admin)) || !(await areasReady(admin))) return NOT_READY;
  const L = await loadLayoutTree(admin, g.fw.id);
  if (L === null) return NOT_READY;
  if ("ok" in L) return L;
  const A = await loadAreas(admin, g.fw.id);
  if (A === null) return NOT_READY;
  if ("ok" in A) return A;
  const tree: LayoutTree = { ...L.tree, areas: A.areas.map(a => ({ id: a.id, name: a.name, sortOrder: a.sortOrder })),
    domains: L.tree.domains.map(d => ({ ...d, areaId: A.domainArea.get(d.id) ?? null })) };
  return { L: { ...L, tree }, direct: reordersDirectly(L.fw), areas: A.areas };
}

/** Save the pending draft with this patch (pruned to what differs from live). Published frameworks only. */
async function saveDraft(admin: any, actor: Actor, c: Ctx, patch: LayoutPatch): Promise<OrganiseResult> {
  const next = pruneLayout(c.L.tree, mergeLayout(c.L.state.layout, patch));
  const { error } = await admin.from("frameworks").update(next ? { layout_draft: next, layout_draft_by: actor.userId } : { layout_draft: null })
    .eq("id", c.L.fw.id).is("hospital_id", null);
  if (error) return { ok: false, status: 422, error: "The draft layout could not be saved. Nothing has changed." };
  return { ok: true, mode: "draft", unchanged: false, layoutPending: !!next };
}

type RowWrite = { table: "framework_areas" | "framework_domains" | "framework_competencies"; id: string; to: Record<string, unknown>; from: Record<string, unknown> };
/** Live writes for a never-published draft, a few at a time. A failure undoes what landed. */
async function writeRows(admin: any, writes: RowWrite[]): Promise<boolean> {
  const done: RowWrite[] = [];
  for (let i = 0; i < writes.length; i += 20) {
    const chunk = writes.slice(i, i + 20);
    const rs = await Promise.all(chunk.map(w => admin.from(w.table).update(w.to).eq("id", w.id).then((r: any) => r, (e: any) => ({ error: e }))));
    rs.forEach((r: any, j: number) => { if (!r?.error) done.push(chunk[j]); });
    if (rs.some((r: any) => r?.error)) {
      await Promise.all(done.map(w => admin.from(w.table).update(w.from).eq("id", w.id).then((r: any) => r, () => null)));
      return false;
    }
  }
  return true;
}
const NOT_SAVED: Fail = { ok: false, status: 503, error: "The change could not be saved just now. Nothing has changed." };

const shown = (c: Ctx) => applyLayout(c.L.tree, c.direct ? null : c.L.state.layout);
const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
const audit = (admin: any, actor: Actor, c: Ctx, action: string, detail: Record<string, unknown>) =>
  authored(admin, actor, action, "framework", c.L.fw.id, c.L.fw.name, { ...detail, mode: c.direct ? "direct" : "draft" });

/** POST authoring { action: "create_area", frameworkId, name, description? } -> { ok, mode, id }. */
export async function createArea(admin: any, actor: Actor, b: any): Promise<OrganiseResult> {
  const name = areaName(b?.name);
  if (!name) return { ok: false, status: 422, error: "An Area name is 2 to 120 characters." };
  const description = typeof b?.description === "string" && b.description.trim() ? b.description.trim() : null;
  if (description && description.length > 2000) return { ok: false, status: 422, error: "An Area description is at most 2,000 characters." };
  const c = await open(admin, b?.frameworkId);
  if ("ok" in c) return c;
  if ([...c.areas.map(a => a.name), ...(shown(c).areas ?? []).map(a => a.name)].some(n => sameName(n, name)))
    return { ok: false, status: 409, error: "This framework already has an Area with that name." };
  const id = crypto.randomUUID();
  const sortOrder = c.areas.reduce((m, a) => Math.max(m, a.sortOrder), 0) + 1;
  if (!(await audit(admin, actor, c, "create_area", { area_id: id, name }))) return NOT_RECORDED;
  const { error } = await admin.from("framework_areas").insert({ id, framework_id: c.L.fw.id, name, description, sort_order: sortOrder, created_by: actor.userId });
  if (error) return String(error.code) === "23505" ? { ok: false, status: 409, error: "This framework already has an Area with that name." } : { ok: false, status: 422, error: "The Area could not be created." };
  return { ok: true, mode: c.direct ? "direct" : "draft", unchanged: false, layoutPending: !!c.L.state.layout, id };
}

/** POST authoring { action: "rename_area", frameworkId, areaId, name }. Published: the new name waits in the draft. */
export async function renameArea(admin: any, actor: Actor, b: any): Promise<OrganiseResult> {
  const name = areaName(b?.name);
  if (!name) return { ok: false, status: 422, error: "An Area name is 2 to 120 characters." };
  const c = await open(admin, b?.frameworkId);
  if ("ok" in c) return c;
  const cur = shown(c).areas ?? [];
  const area = cur.find(a => a.id === b?.areaId);
  if (!area) return { ok: false, status: 422, error: "Choose an Area of this framework." };
  if (area.name === name) return { ok: true, mode: c.direct ? "direct" : "draft", unchanged: true, layoutPending: !!c.L.state.layout };
  if (cur.some(a => a.id !== area.id && sameName(a.name, name))) return { ok: false, status: 409, error: "This framework already has an Area with that name." };
  if (!(await audit(admin, actor, c, "rename_area", { area_id: area.id, from: area.name, to: name }))) return NOT_RECORDED;
  if (!c.direct) return saveDraft(admin, actor, c, { key: "areaName", areaId: area.id, name });
  const { error } = await admin.from("framework_areas").update({ name }).eq("id", area.id).eq("framework_id", c.L.fw.id);
  if (error) return String(error.code) === "23505" ? { ok: false, status: 409, error: "This framework already has an Area with that name." } : { ok: false, status: 422, error: "The Area could not be renamed." };
  return { ok: true, mode: "direct", unchanged: false, layoutPending: false };
}

/** POST authoring { action: "delete_area", frameworkId, areaId }. Only an EMPTY Area: no domain in it, live or in the draft. */
export async function deleteArea(admin: any, actor: Actor, b: any): Promise<OrganiseResult> {
  const c = await open(admin, b?.frameworkId);
  if ("ok" in c) return c;
  const id = b?.areaId;
  if (!isId(id) || !c.areas.some(a => a.id === id)) return { ok: false, status: 422, error: "Choose an Area of this framework." };
  if (shown(c).domains.some(d => d.areaId === id)) return { ok: false, status: 409, error: "This Area still holds domains. Move them to another Area, or to none, first." };
  if (c.L.tree.domains.some(d => d.areaId === id))
    return { ok: false, status: 409, error: "This Area still holds domains in the published framework. Once the draft layout that moves them out is published, it can be deleted." };
  if (!(await audit(admin, actor, c, "delete_area", { area_id: id, name: c.areas.find(a => a.id === id)!.name }))) return NOT_RECORDED;
  let layoutPending = !!c.L.state.layout;
  const l = c.L.state.layout;
  if (!c.direct && l && (l.areas?.includes(id) || (l.areaNames && id in l.areaNames))) {
    // The draft stops naming it first, so the 760 guard never sees a draft that names a deleted Area.
    const rest = { ...l, ...(l.areas ? { areas: l.areas.filter(x => x !== id) } : {}), ...(l.areaNames ? { areaNames: Object.fromEntries(Object.entries(l.areaNames).filter(([k]) => k !== id)) } : {}) };
    const tree = { ...c.L.tree, areas: (c.L.tree.areas ?? []).filter(a => a.id !== id) };
    const next = pruneLayout(tree, rest);
    const { error } = await admin.from("frameworks").update(next ? { layout_draft: next, layout_draft_by: actor.userId } : { layout_draft: null }).eq("id", c.L.fw.id).is("hospital_id", null);
    if (error) return { ok: false, status: 422, error: "The draft layout could not be updated, so the Area was not deleted." };
    layoutPending = !!next;
  }
  const { error } = await admin.from("framework_areas").delete().eq("id", id).eq("framework_id", c.L.fw.id);
  if (error) return { ok: false, status: 422, error: "The Area could not be deleted." };
  return { ok: true, mode: c.direct ? "direct" : "draft", unchanged: false, layoutPending };
}

/** POST authoring { action: "reorder_areas", frameworkId, order: every Area id of the framework, in the new order }. */
export async function reorderAreas(admin: any, actor: Actor, b: any): Promise<OrganiseResult> {
  const c = await open(admin, b?.frameworkId);
  if ("ok" in c) return c;
  const cur = (shown(c).areas ?? []).map(a => a.id);
  const order: string[] = Array.isArray(b?.order) ? b.order.filter((x: unknown) => typeof x === "string") : [];
  if (order.length !== cur.length || new Set(order).size !== order.length || order.some(x => !cur.includes(x)))
    return { ok: false, status: 422, error: "List every Area of this framework, each once, in the new order." };
  const unchanged = order.every((x, i) => x === cur[i]);
  if (unchanged) return { ok: true, mode: c.direct ? "direct" : "draft", unchanged: true, layoutPending: !!c.L.state.layout };
  if (!(await audit(admin, actor, c, "reorder_areas", { order }))) return NOT_RECORDED;
  if (!c.direct) return saveDraft(admin, actor, c, { key: "areas", ids: order });
  const live = new Map(c.areas.map(a => [a.id, a.sortOrder]));
  const writes: RowWrite[] = order.flatMap((id, i) => (live.get(id) === i + 1 ? [] : [{ table: "framework_areas" as const, id, to: { sort_order: i + 1 }, from: { sort_order: live.get(id) } }]));
  return (await writeRows(admin, writes)) ? { ok: true, mode: "direct", unchanged: false, layoutPending: false } : NOT_SAVED;
}

/** POST authoring { action: "set_domain_area", frameworkId, domainId, areaId: an Area of the framework | null }. */
export async function setDomainArea(admin: any, actor: Actor, b: any): Promise<OrganiseResult> {
  const c = await open(admin, b?.frameworkId);
  if ("ok" in c) return c;
  const s = shown(c);
  const d = s.domains.find(x => x.id === b?.domainId);
  if (!d) return { ok: false, status: 422, error: "Choose a domain of this framework." };
  const areaId: string | null = b?.areaId ?? null;
  if (areaId !== null && !(s.areas ?? []).some(a => a.id === areaId)) return { ok: false, status: 422, error: "Choose an Area of this framework, or none. A domain moves only within its framework." };
  if ((d.areaId ?? null) === areaId) return { ok: true, mode: c.direct ? "direct" : "draft", unchanged: true, layoutPending: !!c.L.state.layout };
  if (!(await audit(admin, actor, c, "set_domain_area", { domain_id: d.id, from: d.areaId ?? null, to: areaId }))) return NOT_RECORDED;
  if (!c.direct) return saveDraft(admin, actor, c, { key: "domainArea", domainId: d.id, areaId });
  const { error } = await admin.from("framework_domains").update({ area_id: areaId }).eq("id", d.id).eq("framework_id", c.L.fw.id);
  return error ? { ok: false, status: 422, error: "The domain could not be put in that Area." } : { ok: true, mode: "direct", unchanged: false, layoutPending: false };
}

/**
 * POST authoring { action: "move_competency_domain", frameworkId, competencyId, domainId, position? }.
 * position: 0-based index in the target domain after the move (omitted: last). Same framework only.
 */
export async function moveCompetencyDomain(admin: any, actor: Actor, b: any): Promise<OrganiseResult> {
  const c = await open(admin, b?.frameworkId);
  if ("ok" in c) return c;
  const m = classifyMove(c.L.tree, c.direct ? null : c.L.state.layout, { competencyId: b?.competencyId, domainId: b?.domainId, position: b?.position ?? null });
  if (!m.ok) return { ok: false, status: 422, error: m.error };
  if (m.unchanged) return { ok: true, mode: c.direct ? "direct" : "draft", unchanged: true, layoutPending: !!c.L.state.layout };
  if (m.patch.key !== "move") return { ok: false, status: 422, error: "That move could not be read." };
  const p = m.patch;
  const s = shown(c);
  const from = s.domains.find(d => d.competencies.some(x => x.id === p.competencyId))!;
  if (!(await audit(admin, actor, c, "move_competency_domain", { competency_id: p.competencyId, from_domain_id: from.id, to_domain_id: p.domainId, position: p.ids.indexOf(p.competencyId) }))) return NOT_RECORDED;
  if (!c.direct) return saveDraft(admin, actor, c, p);
  // Live: the competency takes its new domain and place, both domains are renumbered densely 1..n.
  const live = sortTree(c.L.tree);
  const row = new Map(live.domains.flatMap(d => d.competencies.map(x => [x.id, { domainId: d.id, sortOrder: x.sortOrder }] as const)));
  const writes: RowWrite[] = [];
  p.ids.forEach((id, i) => {
    const r = row.get(id)!;
    if (r.domainId !== p.domainId || r.sortOrder !== i + 1)
      writes.push({ table: "framework_competencies", id, to: { domain_id: p.domainId, sort_order: i + 1 }, from: { domain_id: r.domainId, sort_order: r.sortOrder } });
  });
  if (from.id !== p.domainId)
    from.competencies.filter(x => x.id !== p.competencyId).forEach((x, i) => {
      if (x.sortOrder !== i + 1) writes.push({ table: "framework_competencies", id: x.id, to: { sort_order: i + 1 }, from: { sort_order: x.sortOrder } });
    });
  return (await writeRows(admin, writes)) ? { ok: true, mode: "direct", unchanged: false, layoutPending: false } : NOT_SAVED;
}
