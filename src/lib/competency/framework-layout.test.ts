/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { discardLayout, reorderLayout } from "./framework-layout";
import { contributorsOf, decidePublication, publicationKind } from "./framework-publication";
import { authorsOf } from "./clinical-review";

// FRAMEWORK-DESIGN-STUDIO-01 slice B (migrations 750 + 751, owner rulings 3 and 4): a never-published draft is
// reordered directly, a published framework only through a layout draft that an independent publisher applies as a
// revision. A reorderer contributed (cannot publish) but did not author (may clinically review).

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));

const FW = "00000000-0000-4000-8000-0000000000f1", D1 = "00000000-0000-4000-8000-0000000000d1", D2 = "00000000-0000-4000-8000-0000000000d2";
const C1 = "00000000-0000-4000-8000-0000000000c1", C2 = "00000000-0000-4000-8000-0000000000c2";
const AUTHOR = { userId: "00000000-0000-4000-8000-0000000000a1", name: "Author" };
const PUBLISHER = { userId: "00000000-0000-4000-8000-0000000000b1", name: "Publisher" };

let T: Record<string, any[]>;
let no750: boolean;
let no752: boolean;
let stale: string | null;
let refusePublish: string | null;
let selects: string[];
let appWrites: string[];
// Migration 752, emulated: the publication statement applies the stored draft (named first, the rest in order, dense
// 1..n) and clears it, after the guards (refusePublish) accepted it. The app itself writes no sort_order.
function trigger752(row: any) {
  const l = row.layout_draft;
  if (no752 || !l) return;
  const dense = (rows: any[], named: string[] | undefined) => {
    if (!named) return;
    const rest = rows.filter(x => !named.includes(x.id)).sort((a, b) => a.sort_order - b.sort_order);
    [...named.map(id => rows.find(x => x.id === id)), ...rest].forEach((x, i) => { x.sort_order = i + 1; });
  };
  dense(T.framework_domains.filter(d => d.framework_id === row.id), l.domains);
  for (const [d, ids] of Object.entries(l.competencies ?? {})) dense(T.framework_competencies.filter(c => c.domain_id === d), ids as string[]);
  Object.assign(row, { layout_draft: null, layout_draft_by: null, layout_draft_at: null });
}
function fake() {
  const nest = (table: string, r: any): any => table === "frameworks"
    ? { ...r, framework_domains: T.framework_domains.filter(d => d.framework_id === r.id).map(d => nest("framework_domains", d)) }
    : table === "framework_domains"
      ? { ...r, framework_competencies: T.framework_competencies.filter(c => c.domain_id === r.id).map(c => ({ ...c, competency_skills: T.competency_skills.filter(k => k.competency_id === c.id) })) }
      : { ...r };
  const from = (table: string) => {
    const f: ((r: any) => boolean)[] = [];
    const q: any = {};
    let write: { op: string; row: any } | null = null, cols = "";
    q.select = (c = "") => { cols = c; selects.push(`${table}:${c}`); return q; };
    for (const op of ["order", "limit", "not"]) q[op] = () => q;
    const plain = (k: string) => !k.includes(".");
    q.eq = (k: string, v: any) => { if (plain(k)) f.push(r => r[k] === v); return q; };
    q.is = (k: string, v: any) => { if (plain(k)) f.push(r => (r[k] ?? null) === v); return q; };
    q.in = (k: string, vs: any[]) => { f.push(r => vs.includes(r[k])); return q; };
    q.insert = (row: any) => { write = { op: "insert", row }; return q; };
    q.update = (row: any) => { write = { op: "update", row }; return q; };
    const hit = () => (T[table] ??= []).filter(r => f.every(p => p(r)));
    const err = () => no750 && /layout_draft|component_order|learning_outcome_ids/.test(cols) ? { code: "42703", message: "column does not exist" } : null;
    const done = () => {
      if (write?.op === "insert") { (T[table] ??= []).push({ ...write.row }); return { data: null, error: null }; }
      if (write?.op === "update") {
        if (table === "frameworks" && write.row.pub_status === "published" && refusePublish) return { data: null, error: { message: refusePublish } };
        if (table === "frameworks" && write.row.pub_status === "published" && stale && !no752) return { data: null, error: { message: `framework layout at publication: the pending layout is out of date, ${stale}. Nothing was published` } };
        appWrites.push(`${table}:${Object.keys(write.row).join(",")}`);
        if (table === "frameworks" && "layout_draft" in write.row) {
          // the 750 trigger: a draft names its author, null clears by and at
          if (write.row.layout_draft && !write.row.layout_draft_by) return { data: null, error: { message: "a layout draft records who saved it" } };
          write = { op: "update", row: { ...write.row, layout_draft_at: write.row.layout_draft ? new Date().toISOString() : null, ...(write.row.layout_draft ? {} : { layout_draft_by: null }) } };
        }
        for (const r of hit()) { Object.assign(r, write!.row); if (table === "frameworks" && write!.row.pub_status === "published") trigger752(r); }
        return { data: null, error: null };
      }
      const e = err();
      return e ? { data: null, error: e } : { data: hit().map(r => nest(table, r)), error: null };
    };
    q.maybeSingle = async () => { const r = done(); return r.error ? r : { data: r.data?.[0] ?? null, error: null }; };
    q.single = q.maybeSingle;
    q.then = (ok: any, ko: any) => Promise.resolve(done()).then(ok, ko);
    return q;
  };
  const rpc = async (name: string, a: any) => name === "framework_layout_check"
    ? (no752 ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.framework_layout_check" } } : { data: stale, error: null })
    : { data: (a?.p_ids ?? []).map((id: string) => ({ competency_id: id, content_hash: T.hashes.find(h => h.id === id)?.hash ?? "h0" })), error: null };
  return { from, rpc };
}

const fw = (over: Record<string, any> = {}) => ({ id: FW, name: "Framework", code: "FW", hospital_id: null, competency_layer: "foundational", pub_status: "draft", version_num: 0,
  version_major: 1, version_minor: 0, version_revision: 0, layout_draft: null, layout_draft_by: null, layout_draft_at: null, component_order: null, ...over });
const published = () => { T.frameworks = [fw({ pub_status: "published", version_num: 1 })]; T.framework_versions = [{ framework_id: FW, version_num: 1, snapshot: { clinical_approvals: { [C1]: { content_hash: "h1" }, [C2]: { content_hash: "h2" } } } }]; };

beforeEach(() => {
  no750 = false; no752 = false; stale = null; refusePublish = null; selects = []; appWrites = [];
  T = {
    frameworks: [fw()],
    framework_domains: [{ id: D1, framework_id: FW, name: "One", sort_order: 1 }, { id: D2, framework_id: FW, name: "Two", sort_order: 2 }],
    framework_competencies: [{ id: C1, domain_id: D1, name: "Alpha", sort_order: 1, learning_outcome_ids: [] }, { id: C2, domain_id: D1, name: "Beta", sort_order: 2, learning_outcome_ids: [] }],
    competency_skills: [], competency_assessment_component: [{ code: "clinical_skills", sort_order: 1 }, { code: "knowledge", sort_order: 2 }],
    content_approvals: [], audit_log: [], framework_versions: [], competency_catalogue_entry: [], clinical_content_version: [],
    hashes: [{ id: C1, hash: "h1" }, { id: C2, hash: "h2" }],
  };
});
const sorts = () => T.framework_competencies.map(c => [c.name, c.sort_order]);

describe("routing: draft vs published", () => {
  it("a never-published draft is reordered directly, audit first as reorder_layout", async () => {
    const r = await reorderLayout(fake(), AUTHOR, { frameworkId: FW, level: "competencies", parentId: D1, order: [C2, C1] });
    expect(r).toMatchObject({ ok: true, mode: "direct" });
    expect(sorts()).toEqual([["Alpha", 2], ["Beta", 1]]);
    expect(T.frameworks[0].layout_draft).toBeNull();
    expect(T.audit_log.map(a => a.action)).toEqual(["reorder_layout"]);
  });
  it("a published framework saves a layout draft only: the live order is untouched", async () => {
    published();
    const r = await reorderLayout(fake(), AUTHOR, { frameworkId: FW, level: "competencies", parentId: D1, order: [C2, C1] });
    expect(r).toMatchObject({ ok: true, mode: "draft", layoutPending: true });
    expect(sorts()).toEqual([["Alpha", 1], ["Beta", 2]]);
    expect(T.frameworks[0].layout_draft).toEqual({ v: 1, competencies: { [D1]: [C2, C1] } });
    expect(T.frameworks[0].layout_draft_by).toBe(AUTHOR.userId);
    // and discarding it leaves the live order as it was
    expect(await discardLayout(fake(), AUTHOR, { frameworkId: FW })).toEqual({ ok: true, discarded: true });
    expect(T.frameworks[0].layout_draft).toBeNull();
  });
  it("cross-parent and outcome reorders are refused, and write nothing", async () => {
    const r = await reorderLayout(fake(), AUTHOR, { frameworkId: FW, level: "competencies", parentId: D2, order: [C1] });
    expect(r).toMatchObject({ ok: false, status: 422 }); // 760 (D3): a competency to another domain is a move (move_competency_domain), not a reorder
    expect(await reorderLayout(fake(), AUTHOR, { frameworkId: FW, level: "outcomes", parentId: C1, order: ["x"] })).toMatchObject({ ok: false, status: 409 });
    expect(T.audit_log).toEqual([]);
  });
  it("fails closed without 750/751: nothing is written", async () => {
    no750 = true;
    expect(await reorderLayout(fake(), AUTHOR, { frameworkId: FW, level: "domains", order: [D2, D1] })).toMatchObject({ ok: false, status: 409 });
    expect(T.audit_log).toEqual([]);
    expect(T.framework_domains.map(d => d.sort_order)).toEqual([1, 2]);
  });
});

describe("applied at publication, as a revision", () => {
  beforeEach(async () => {
    published();
    await reorderLayout(fake(), AUTHOR, { frameworkId: FW, level: "competencies", parentId: D1, order: [C2, C1] });
    T.content_approvals = [{ id: "req1", framework_id: FW, status: "pending", submitted_by: AUTHOR.userId, submitted_at: new Date(Date.now() + 60_000).toISOString() }];
  });
  it("a layout-only publication is forced to a revision, applied by the publication statement (752), the snapshot after it", async () => {
    appWrites = [];
    const r = await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish", changeKind: "major" });
    expect(r).toMatchObject({ ok: true, version: "1.0.1", layoutApplied: true, changeKindForced: true });
    expect(sorts()).toEqual([["Alpha", 2], ["Beta", 1]]);
    expect(T.frameworks[0].layout_draft).toBeNull();
    // no app-level apply, undo or clear: only the publication statement and its bookkeeping
    expect(appWrites.filter(w => /^(framework_domains|framework_competencies|competency_skills):/.test(w) || /layout_draft|component_order/.test(w))).toEqual([]);
    // the version snapshot records the applied order
    const snap = T.framework_versions.at(-1).snapshot;
    expect(snap.framework_domains[0].framework_competencies.map((c: any) => [c.name, c.sort_order])).toEqual([["Alpha", 2], ["Beta", 1]]);
    // the snapshot asks for the ids that rebuild the order
    expect(selects.some(s => s.startsWith("frameworks:") && /competency_skills\(id, name, sort_order, component_code\)/.test(s) && /learning_outcome_ids/.test(s) && /component_order/.test(s))).toBe(true);
  });
  it("with a content change too, the publisher's chosen kind applies", async () => {
    T.hashes = [{ id: C1, hash: "h1-changed" }, { id: C2, hash: "h2" }];
    const r = await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish", changeKind: "minor" });
    expect(r).toMatchObject({ ok: true, version: "1.1.0", layoutApplied: true, changeKindForced: false });
  });
  it("SoD: the person who reordered may not publish it, and nothing is applied", async () => {
    T.content_approvals[0].submitted_by = "someone-else";
    const r = await decidePublication(fake(), AUTHOR, { frameworkId: FW, decision: "publish", changeKind: "revision" });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(sorts()).toEqual([["Alpha", 1], ["Beta", 2]]);
  });
  it("without 752 a pending layout is refused, nothing is written (no non-atomic fallback)", async () => {
    no752 = true;
    const r = await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish", changeKind: "revision" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as any).error).toMatch(/752/);
    expect(sorts()).toEqual([["Alpha", 1], ["Beta", 2]]);
    expect(T.frameworks[0]).toMatchObject({ pub_status: "published", version_revision: 0 });
    expect(T.frameworks[0].layout_draft).not.toBeNull();
  });
  it("a stale layout is refused with its reason: by the pre-check, and by the publication statement itself", async () => {
    stale = "a competency it names is no longer in that domain";
    const r = await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish", changeKind: "revision" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as any).error).toMatch(/out of date \(a competency it names is no longer in that domain\)/);
    // the trigger's own refusal (a draft that went stale between the check and the statement) reads the same
    const { transitionFramework } = await import("./framework-lifecycle");
    const t = await transitionFramework(fake(), FW, "publish", { id: PUBLISHER.userId, name: "P" }, { holdings: true, nextVersion: { major: 1, minor: 0, revision: 1 } });
    expect(t).toMatchObject({ ok: false, code: 409 });
    expect(t.error).toMatch(/out of date \(a competency it names is no longer in that domain\)/);
    expect(sorts()).toEqual([["Alpha", 1], ["Beta", 2]]);
    expect(T.frameworks[0].layout_draft).not.toBeNull();
  });
  it("a refused publication (466/640) leaves the live order and keeps the draft", async () => {
    refusePublish = "cfca publication: 1 of 2 competencies";
    const r = await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish", changeKind: "revision" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(sorts()).toEqual([["Alpha", 1], ["Beta", 2]]);
    expect(T.frameworks[0].layout_draft).not.toBeNull();
  });
  it("a layout changed after it was put forward must be put forward again", async () => {
    T.content_approvals[0].submitted_at = new Date(Date.now() - 60_000).toISOString();
    expect(await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish", changeKind: "revision" })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("F4: reorder_layout is contribution, not authorship", () => {
  const trail = [{ actor_id: "reorderer", action: "reorder_layout" }, { actor_id: "author", action: "cfca_competency_updated" }];
  it("publication SoD counts the reorderer", () => expect(contributorsOf(trail)).toEqual(["reorderer", "author"]));
  it("clinical review does not count them as an author", () => expect(authorsOf("submitter", trail)).toEqual(["submitter", "author"]));
  it("publicationKind: layout only is a revision, otherwise the choice is required", () => {
    expect(publicationKind(false, "major", { pending: true, only: true })).toEqual({ ok: true, kind: "revision", forced: true });
    expect(publicationKind(false, null, { pending: true, only: false })).toMatchObject({ ok: false });
    expect(publicationKind(false, "minor", { pending: false, only: false })).toEqual({ ok: true, kind: "minor", forced: false });
    expect(publicationKind(true, null, { pending: true, only: true })).toEqual({ ok: true, kind: null, forced: false });
  });
});
