/* eslint-disable @typescript-eslint/no-explicit-any */
import { authored, editableFramework, NOT_RECORDED, type Actor } from "./authoring";
import { asLayout, classifyReorder, densePlan, mergeLayout, pruneLayout, type LayoutTree, type LayoutV1, type ReorderLevel, type SortWrite } from "./layout-order";

// ── FRAMEWORK-DESIGN-STUDIO-01 slice B: REORDERING, GOVERNED ── migrations 750 + 751, owner rulings 1-4 (31 Oct 2026) ──
//
//   never-published draft   the order is written directly (dense 1..n). Nobody consumes it yet.
//   published (any version) the order is saved as frameworks.layout_draft. Learners, Scholar and verification keep the
//                           live order until an independent publisher applies it as a REVISION (framework-publication.ts).
//
// ⚠ AUDIT FIRST, AS reorder_layout. Every presentation-only write (a direct reorder, saving or discarding a layout
// draft) is preceded by its audit row, action reorder_layout, on the framework. That action counts as CONTRIBUTION for
// publication (640: the person who reordered cannot publish it) but NOT as authorship for clinical review (751, F4).
//
// ⚠ FAILS CLOSED. Without 750 (the layout columns) or 751 (stable outcome ids and the F4 guard) nothing here writes, and
// the Studio keeps working exactly as before.

type Fail = { ok: false; status: number; error: string };
const NOT_READY: Fail = { ok: false, status: 409, error: "Reordering is not set up on this environment yet (migrations 750 and 751). Nothing has changed." };
const UNREADABLE: Fail = { ok: false, status: 503, error: "The framework could not be read just now. Nothing has changed." };
const missingColumn = (e: any) => ["42703", "PGRST204"].includes(String(e?.code ?? "")) || /column .* does not exist|could not find .* column/i.test(String(e?.message ?? ""));

export type LayoutState = { layout: LayoutV1 | null; by: string | null; at: string | null; componentOrder: string[] | null };
export type LoadedLayout = { tree: LayoutTree; state: LayoutState; fw: { id: string; name: string; pub_status: string; version_num: number } };

/** Whether 750 and 751 are both on this environment. Zero-row reads only. */
export async function layoutReady(admin: any): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([
      admin.from("frameworks").select("id, layout_draft, layout_draft_by, layout_draft_at, component_order").limit(0),
      admin.from("framework_competencies").select("id, learning_outcome_ids").limit(0),
    ]);
    return !a.error && !b.error;
  } catch { return false; }
}

/** A framework's structure and its pending layout. null = 750/751 absent, Fail = unreadable. */
export async function loadLayoutTree(admin: any, frameworkId: string): Promise<LoadedLayout | null | Fail> {
  const { data: f, error } = await admin.from("frameworks")
    .select("id, name, pub_status, version_num, layout_draft, layout_draft_by, layout_draft_at, component_order, framework_domains(id, name, sort_order, framework_competencies(id, name, sort_order, learning_outcome_ids))")
    .eq("id", frameworkId).maybeSingle();
  if (error) return missingColumn(error) ? null : UNREADABLE;
  if (!f) return { ok: false, status: 404, error: "That framework does not exist." };
  const comps = (f.framework_domains ?? []).flatMap((d: any) => d.framework_competencies ?? []);
  const ids = comps.map((c: any) => c.id);
  const [sk, reg] = await Promise.all([
    ids.length ? admin.from("competency_skills").select("id, competency_id, name, sort_order, component_code").in("competency_id", ids).limit(20000) : Promise.resolve({ data: [], error: null }),
    admin.from("competency_assessment_component").select("code, sort_order").order("sort_order"),
  ]);
  if (sk.error || reg.error) return sk.error && missingColumn(sk.error) ? null : UNREADABLE;
  const skills = new Map<string, any[]>();
  for (const k of sk.data ?? []) skills.set(k.competency_id, [...(skills.get(k.competency_id) ?? []), k]);
  const tree: LayoutTree = {
    componentOrder: Array.isArray(f.component_order) ? f.component_order : null,
    registry: (reg.data ?? []).map((r: any) => r.code),
    domains: (f.framework_domains ?? []).map((d: any) => ({
      id: d.id, name: d.name ?? "", sortOrder: d.sort_order ?? null,
      competencies: (d.framework_competencies ?? []).map((c: any) => ({
        id: c.id, name: c.name ?? "", sortOrder: c.sort_order ?? null,
        criteria: (skills.get(c.id) ?? []).map((k: any) => ({ id: k.id, name: k.name ?? "", sortOrder: k.sort_order ?? null, component: k.component_code ?? null })),
      })),
    })),
  };
  return {
    tree, fw: { id: f.id, name: f.name, pub_status: f.pub_status ?? "draft", version_num: f.version_num ?? 0 },
    state: { layout: asLayout(f.layout_draft), by: f.layout_draft_by ?? null, at: f.layout_draft_at ?? null, componentOrder: tree.componentOrder },
  };
}

/** Pure: a framework is reordered directly only while it is a draft that was never published. */
export const reordersDirectly = (fw: { pub_status: string; version_num: number }) => fw.pub_status === "draft" && (fw.version_num ?? 0) === 0;

const LEVELS: ReorderLevel[] = ["domains", "competencies", "criteria", "sections", "outcomes"];

/** Apply sort_order writes, a few at a time. Returns the writes that landed (to undo), and whether all did. */
export async function writeSortOrders(admin: any, writes: SortWrite[], dir: "to" | "from" = "to"): Promise<{ ok: boolean; done: SortWrite[] }> {
  const done: SortWrite[] = [];
  for (let i = 0; i < writes.length; i += 20) {
    const chunk = writes.slice(i, i + 20);
    const rs = await Promise.all(chunk.map(w => admin.from(w.table).update({ sort_order: dir === "to" ? w.to : w.from }).eq("id", w.id).then((r: any) => r, (e: any) => ({ error: e }))));
    rs.forEach((r: any, j: number) => { if (!r?.error) done.push(chunk[j]); });
    if (rs.some((r: any) => r?.error)) return { ok: false, done };
  }
  return { ok: true, done };
}

export type ReorderResult = { ok: true; mode: "direct" | "draft"; unchanged: boolean; layoutPending: boolean } | Fail;

/**
 * POST authoring { action: "reorder_layout", frameworkId, level, parentId?, component?, order }.
 * The system classifies it: within its parent it is presentation, anything else is refused as a clinical change.
 */
export async function reorderLayout(admin: any, actor: Actor, b: any): Promise<ReorderResult> {
  const g = await editableFramework(admin, b?.frameworkId);
  if (!g.ok) return g;
  if (!LEVELS.includes(b?.level)) return { ok: false, status: 400, error: "Choose what to reorder: domains, competencies, criteria or sections." };
  if (!(await layoutReady(admin))) return NOT_READY;
  const L = await loadLayoutTree(admin, g.fw.id);
  if (L === null) return NOT_READY;
  if ("ok" in L) return L;
  const direct = reordersDirectly(L.fw);
  const c = classifyReorder(L.tree, direct ? null : L.state.layout, { level: b.level, parentId: b.parentId ?? null, component: b.component ?? null, order: b.order });
  if (!c.ok) return { ok: false, status: c.clinical ? 409 : 422, error: c.error };
  if (c.unchanged) return { ok: true, mode: direct ? "direct" : "draft", unchanged: true, layoutPending: !!L.state.layout };
  const detail = { level: b.level, parent_id: b.parentId ?? null, component: b.component ?? null, order: c.patch.key === "componentOrder" ? c.patch.codes : c.patch.ids, mode: direct ? "direct" : "draft" };
  if (!(await authored(admin, actor, "reorder_layout", "framework", g.fw.id, g.fw.name, detail))) return NOT_RECORDED;
  if (direct) {
    const plan = densePlan(L.tree, mergeLayout(null, c.patch));
    const w = await writeSortOrders(admin, plan.writes);
    if (!w.ok) { await writeSortOrders(admin, w.done, "from"); return { ok: false, status: 503, error: "The new order could not be saved just now. Nothing has changed." }; }
    if (plan.componentOrder !== undefined) {
      const { error } = await admin.from("frameworks").update({ component_order: plan.componentOrder }).eq("id", g.fw.id).is("hospital_id", null);
      if (error) return { ok: false, status: 422, error: "The section order could not be saved." };
    }
    return { ok: true, mode: "direct", unchanged: false, layoutPending: false };
  }
  const next = pruneLayout(L.tree, mergeLayout(L.state.layout, c.patch));
  const { error } = await admin.from("frameworks").update(next ? { layout_draft: next, layout_draft_by: actor.userId } : { layout_draft: null }).eq("id", g.fw.id).is("hospital_id", null);
  if (error) return { ok: false, status: 422, error: "The layout draft could not be saved." };
  return { ok: true, mode: "draft", unchanged: false, layoutPending: !!next };
}

/** POST authoring { action: "discard_layout", frameworkId }: the pending layout is dropped, the live order is untouched. */
export async function discardLayout(admin: any, actor: Actor, b: any): Promise<{ ok: true; discarded: boolean } | Fail> {
  const g = await editableFramework(admin, b?.frameworkId);
  if (!g.ok) return g;
  if (!(await layoutReady(admin))) return NOT_READY;
  const { data, error } = await admin.from("frameworks").select("layout_draft").eq("id", g.fw.id).maybeSingle();
  if (error) return missingColumn(error) ? NOT_READY : UNREADABLE;
  if (!data?.layout_draft) return { ok: true, discarded: false };
  if (!(await authored(admin, actor, "reorder_layout", "framework", g.fw.id, g.fw.name, { discarded: true }))) return NOT_RECORDED;
  const { error: uErr } = await admin.from("frameworks").update({ layout_draft: null }).eq("id", g.fw.id).is("hospital_id", null);
  return uErr ? { ok: false, status: 422, error: "The layout draft could not be discarded." } : { ok: true, discarded: true };
}

// ── At publication (framework-publication.ts decidePublication) ──

/** The pending layout of a framework at publication time. null = none (or 750 absent), Fail = unreadable. */
export async function pendingLayout(admin: any, frameworkId: string): Promise<{ layout: LayoutV1; at: string | null } | null | Fail> {
  const { data, error } = await admin.from("frameworks").select("layout_draft, layout_draft_at").eq("id", frameworkId).maybeSingle();
  if (error) return missingColumn(error) ? null : UNREADABLE;
  const layout = asLayout(data?.layout_draft);
  return layout ? { layout, at: data?.layout_draft_at ?? null } : null;
}

export type AppliedLayout = { undo: () => Promise<void> };
/**
 * Write the pending layout into the live order, BEFORE the publication snapshot. Every write is captured, so a refused
 * publication (466, 640) or a failed write restores the previous order exactly and keeps the draft.
 */
export async function applyPendingLayout(admin: any, frameworkId: string, layout: LayoutV1): Promise<AppliedLayout | Fail> {
  const L = await loadLayoutTree(admin, frameworkId);
  if (L === null) return NOT_READY;
  if ("ok" in L) return L;
  const plan = densePlan(L.tree, layout);
  const w = await writeSortOrders(admin, plan.writes);
  const undoSorts = () => writeSortOrders(admin, w.done, "from").then(() => undefined);
  if (!w.ok) { await undoSorts(); return { ok: false, status: 503, error: "The new layout could not be applied just now, so nothing was published." }; }
  if (plan.componentOrder !== undefined) {
    const { error } = await admin.from("frameworks").update({ component_order: plan.componentOrder }).eq("id", frameworkId);
    if (error) { await undoSorts(); return { ok: false, status: 503, error: "The new section order could not be applied just now, so nothing was published." }; }
  }
  const before = L.state.componentOrder;
  return { undo: async () => {
    await undoSorts();
    if (plan.componentOrder !== undefined) await admin.from("frameworks").update({ component_order: before }).eq("id", frameworkId);
  } };
}

/**
 * Whether the competencies are exactly what the last published version approved (same ids, same 395 hashes) and the
 * framework names no catalogue entries. Only then is a publication "layout only". Unreadable = false (the publisher chooses).
 */
export async function contentUnchangedSinceLastVersion(admin: any, frameworkId: string): Promise<boolean> {
  try {
    const [v, d, e] = await Promise.all([
      admin.from("framework_versions").select("snapshot").eq("framework_id", frameworkId).order("version_num", { ascending: false }).limit(1),
      admin.from("framework_domains").select("framework_competencies(id)").eq("framework_id", frameworkId),
      admin.from("competency_catalogue_entry").select("competency_id").eq("catalogue_id", frameworkId).limit(1),
    ]);
    if (v.error || d.error) return false;
    if (!e.error && (e.data ?? []).length) return false;
    const approved = v.data?.[0]?.snapshot?.clinical_approvals;
    if (!approved || typeof approved !== "object") return false;
    const ids: string[] = (d.data ?? []).flatMap((x: any) => (x.framework_competencies ?? []).map((c: any) => c.id));
    if (ids.length !== Object.keys(approved).length || ids.some(id => !approved[id])) return false;
    if (!ids.length) return true;
    const { data: hashes, error } = await admin.rpc("competency_content_hashes", { p_ids: ids });
    if (error) return false;
    const now = new Map<string, string>((hashes ?? []).map((h: any) => [h.competency_id, h.content_hash]));
    return ids.every(id => now.get(id) === approved[id]?.content_hash);
  } catch { return false; }
}
