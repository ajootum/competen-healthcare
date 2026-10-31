/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArea, deleteArea, moveCompetencyDomain, renameArea, reorderAreas, setDomainArea } from "./framework-areas";
import { applyLayout, classifyMove, classifyReorder, groupByArea, mergeLayout, ORGANISATIONAL_ACTIONS, pruneLayout, type LayoutTree } from "./layout-order";
import { authorsOf } from "./clinical-review";
import { contributorsOf } from "./framework-publication";

// FRAMEWORK-DESIGN-STUDIO-02 S3 (migration 760, rulings D1 and D3): Areas and a competency to another domain are
// ORGANISATIONAL. A never-published draft is written live; a published framework only through the layout draft that the
// 760 publication trigger applies atomically. A criterion crossing a section or competency stays substantive.

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));

// ── pure ──
const tree = (): LayoutTree => ({
  registry: ["knowledge"], componentOrder: null,
  areas: [{ id: "a1", name: "Clinical Practice", sortOrder: 1 }, { id: "a2", name: "Professional Practice", sortOrder: 2 }],
  domains: [
    { id: "d1", name: "One", sortOrder: 1, areaId: "a1", competencies: [
      { id: "c1", name: "Alpha", sortOrder: 1, criteria: [{ id: "k1", name: "x", sortOrder: 1, component: "knowledge" }] },
      { id: "c2", name: "Beta", sortOrder: 2, criteria: [] },
    ] },
    { id: "d2", name: "Two", sortOrder: 2, areaId: null, competencies: [{ id: "c3", name: "Gamma", sortOrder: 1, criteria: [] }] },
  ],
});
const ids = (t: LayoutTree) => t.domains.map(d => `${d.id}@${d.areaId ?? "-"}:${d.competencies.map(c => c.id).join(",")}`);

describe("move classification (pure)", () => {
  it("a competency to another domain of the framework is a move, at the position asked", () => {
    const m = classifyMove(tree(), null, { competencyId: "c1", domainId: "d2", position: 0 });
    expect(m).toEqual({ ok: true, unchanged: false, patch: { key: "move", competencyId: "c1", domainId: "d2", ids: ["c1", "c3"] } });
    expect(classifyMove(tree(), null, { competencyId: "c1", domainId: "d2" })).toMatchObject({ patch: { ids: ["c3", "c1"] } });
    expect(classifyMove(tree(), null, { competencyId: "c1", domainId: "d1", position: 0 })).toMatchObject({ ok: true, unchanged: true });
  });
  it("a domain or competency outside the framework is refused", () => {
    expect(classifyMove(tree(), null, { competencyId: "c1", domainId: "elsewhere" })).toMatchObject({ ok: false, clinical: false });
    expect(classifyMove(tree(), null, { competencyId: "nope", domainId: "d2" })).toMatchObject({ ok: false });
  });
  it("reorder_layout no longer calls a cross-domain competency clinical: it points to the move", () => {
    expect(classifyReorder(tree(), null, { level: "competencies", parentId: "d2", order: ["c3", "c1"] })).toMatchObject({ ok: false, clinical: false });
    // a criterion to another competency stays substantive
    expect(classifyReorder(tree(), null, { level: "criteria", parentId: "c2", component: "knowledge", order: ["k1"] })).toMatchObject({ ok: false, clinical: true });
  });
});

describe("layout validation with Areas and cross-domain moves (pure)", () => {
  it("applies a move, domain Areas, Area order and names; criteria travel with their competency", () => {
    const l = mergeLayout(mergeLayout(mergeLayout(mergeLayout(null, { key: "move", competencyId: "c1", domainId: "d2", ids: ["c1", "c3"] }),
      { key: "domainArea", domainId: "d2", areaId: "a2" }), { key: "areas", ids: ["a2", "a1"] }), { key: "areaName", areaId: "a1", name: "Clinical" });
    const a = applyLayout(tree(), l);
    expect(ids(a)).toEqual(["d1@a1:c2", "d2@a2:c1,c3"]);
    expect(a.domains[1].competencies[0].criteria.map(k => k.id)).toEqual(["k1"]);
    expect(a.areas!.map(x => `${x.id}=${x.name}`)).toEqual(["a2=Professional Practice", "a1=Clinical"]);
    expect(groupByArea(a).map(g => `${g.area?.id ?? "-"}:${g.domains.map(d => d.id).join(",")}`)).toEqual(["a2:d2", "a1:d1"]);
  });
  it("a move lists the competency once: it leaves every other domain list", () => {
    const l = mergeLayout({ v: 1, competencies: { d1: ["c2", "c1"] } }, { key: "move", competencyId: "c1", domainId: "d2", ids: ["c3", "c1"] });
    expect(l.competencies).toEqual({ d1: ["c2"], d2: ["c3", "c1"] });
  });
  it("pruning keeps what differs from live and drops a move back home", () => {
    const moved = mergeLayout(null, { key: "move", competencyId: "c1", domainId: "d2", ids: ["c3", "c1"] });
    expect(pruneLayout(tree(), moved)).toEqual({ v: 1, competencies: { d2: ["c3", "c1"] } });
    const back = mergeLayout(moved, { key: "move", competencyId: "c1", domainId: "d1", ids: ["c1", "c2"] });
    expect(pruneLayout(tree(), back)).toBeNull();
    expect(pruneLayout(tree(), { v: 1, domainAreas: { d1: "a1" }, areaNames: { a2: "Professional Practice" }, areas: ["a1", "a2"] })).toBeNull();
  });
  it("a tree read without Areas keeps the Area keys untouched (no silent loss on reorder_layout)", () => {
    const { areas: _a, ...noAreas } = tree();
    void _a;
    const l = { v: 1 as const, domainAreas: { d1: null }, areas: ["a2"], areaNames: { a1: "X y" } };
    expect(pruneLayout({ ...noAreas, domains: noAreas.domains.map(d => ({ ...d, areaId: undefined })) }, l)).toEqual(l);
  });
  it("no Areas: one group with every domain", () => {
    expect(groupByArea({ domains: tree().domains }).map(g => g.area)).toEqual([null]);
  });
});

describe("F4: organisational actions are contribution, not authorship", () => {
  it("authorsOf leaves them out, contributorsOf counts them", () => {
    const audit = ORGANISATIONAL_ACTIONS.map(action => ({ actor_id: "mover", action }));
    expect(authorsOf("submitter", audit)).toEqual(["submitter"]);
    expect(contributorsOf(audit)).toEqual(["mover"]);
  });
});

// ── server, against a fake database ──
const FW = "00000000-0000-4000-8000-0000000000f1", D1 = "00000000-0000-4000-8000-0000000000d1", D2 = "00000000-0000-4000-8000-0000000000d2";
const C1 = "00000000-0000-4000-8000-0000000000c1", C2 = "00000000-0000-4000-8000-0000000000c2", C3 = "00000000-0000-4000-8000-0000000000c3";
const A1 = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR = { userId: "00000000-0000-4000-8000-0000000000e1", name: "Author" };
let T: Record<string, any[]>;
let no760: boolean;
function fake() {
  const nest = (table: string, r: any): any => table === "frameworks"
    ? { ...r, framework_domains: T.framework_domains.filter(d => d.framework_id === r.id).map(d => nest("framework_domains", d)) }
    : table === "framework_domains" ? { ...r, framework_competencies: T.framework_competencies.filter(c => c.domain_id === r.id) } : { ...r };
  const from = (table: string) => {
    const f: ((r: any) => boolean)[] = [];
    const q: any = {};
    let write: { op: string; row?: any } | null = null, cols = "";
    q.select = (c = "") => { cols = c; return q; };
    for (const op of ["order", "limit", "not"]) q[op] = () => q;
    q.eq = (k: string, v: any) => { f.push(r => r[k] === v); return q; };
    q.is = (k: string, v: any) => { f.push(r => (r[k] ?? null) === v); return q; };
    q.in = (k: string, vs: any[]) => { f.push(r => vs.includes(r[k])); return q; };
    q.insert = (row: any) => { write = { op: "insert", row }; return q; };
    q.update = (row: any) => { write = { op: "update", row }; return q; };
    q.delete = () => { write = { op: "delete" }; return q; };
    const hit = () => (T[table] ??= []).filter(r => f.every(p => p(r)));
    const done = () => {
      if (no760 && (table === "framework_areas" || /area_id/.test(cols) || (write?.row && "area_id" in write.row))) return { data: null, error: { code: "42P01", message: "relation does not exist" } };
      if (write?.op === "insert") { (T[table] ??= []).push({ ...write.row }); return { data: null, error: null }; }
      if (write?.op === "delete") { T[table] = T[table].filter(r => !f.every(p => p(r))); return { data: null, error: null }; }
      if (write?.op === "update") {
        const row = table === "frameworks" && "layout_draft" in write.row
          ? { ...write.row, layout_draft_at: write.row.layout_draft ? "2026-10-31T12:00:00Z" : null, ...(write.row.layout_draft ? {} : { layout_draft_by: null }) } : write.row;
        for (const r of hit()) Object.assign(r, row);
        return { data: null, error: null };
      }
      return { data: hit().map(r => nest(table, r)), error: null };
    };
    q.maybeSingle = async () => { const r = done(); return r.error ? r : { data: (r.data as any)?.[0] ?? null, error: null }; };
    q.single = q.maybeSingle;
    q.then = (ok: any, ko: any) => Promise.resolve(done()).then(ok, ko);
    return q;
  };
  return { from, rpc: async () => ({ data: null, error: null }) };
}
const fwRow = (over: Record<string, any> = {}) => ({ id: FW, name: "Framework", hospital_id: null, pub_status: "draft", version_num: 0,
  layout_draft: null, layout_draft_by: null, layout_draft_at: null, component_order: null, ...over });
const live = () => [...T.framework_competencies].sort((a, b) => a.id.localeCompare(b.id)).map(c => `${c.name}@${c.domain_id === D1 ? "D1" : "D2"}=${c.sort_order}`);
const published = () => { T.frameworks = [fwRow({ pub_status: "published", version_num: 1 })]; };

beforeEach(() => {
  no760 = false;
  T = {
    frameworks: [fwRow()],
    framework_domains: [{ id: D1, framework_id: FW, name: "One", sort_order: 1, area_id: null }, { id: D2, framework_id: FW, name: "Two", sort_order: 2, area_id: null }],
    framework_competencies: [{ id: C1, domain_id: D1, name: "Alpha", sort_order: 1, learning_outcome_ids: [] }, { id: C2, domain_id: D1, name: "Beta", sort_order: 2, learning_outcome_ids: [] },
      { id: C3, domain_id: D2, name: "Gamma", sort_order: 1, learning_outcome_ids: [] }],
    framework_areas: [], competency_skills: [], competency_assessment_component: [{ code: "knowledge", sort_order: 1 }], audit_log: [],
  };
});

describe("draft vs published routing", () => {
  it("a never-published draft is written live, audit first with the organisational action", async () => {
    const r = await createArea(fake(), AUTHOR, { frameworkId: FW, name: "  Clinical   Practice " });
    expect(r).toMatchObject({ ok: true, mode: "direct" });
    expect(T.framework_areas).toMatchObject([{ framework_id: FW, name: "Clinical Practice", sort_order: 1, created_by: AUTHOR.userId }]);
    const areaId = T.framework_areas[0].id;
    expect(await setDomainArea(fake(), AUTHOR, { frameworkId: FW, domainId: D2, areaId })).toMatchObject({ ok: true, mode: "direct" });
    expect(T.framework_domains.find(d => d.id === D2)!.area_id).toBe(areaId);
    expect(await moveCompetencyDomain(fake(), AUTHOR, { frameworkId: FW, competencyId: C1, domainId: D2, position: 0 })).toMatchObject({ ok: true, mode: "direct" });
    expect(live()).toEqual(["Alpha@D2=1", "Beta@D1=1", "Gamma@D2=2"]);
    expect(T.frameworks[0].layout_draft).toBeNull();
    expect(T.audit_log.map(a => a.action)).toEqual(["create_area", "set_domain_area", "move_competency_domain"]);
  });
  it("a published framework writes only the layout draft (the keys the 760 trigger applies), never live", async () => {
    published();
    T.framework_areas = [{ id: A1, framework_id: FW, name: "Clinical Practice", description: null, sort_order: 1 }];
    expect(await moveCompetencyDomain(fake(), AUTHOR, { frameworkId: FW, competencyId: C1, domainId: D2 })).toMatchObject({ ok: true, mode: "draft", layoutPending: true });
    expect(await setDomainArea(fake(), AUTHOR, { frameworkId: FW, domainId: D1, areaId: A1 })).toMatchObject({ ok: true, mode: "draft" });
    expect(await renameArea(fake(), AUTHOR, { frameworkId: FW, areaId: A1, name: "Clinical" })).toMatchObject({ ok: true, mode: "draft" });
    expect(T.frameworks[0].layout_draft).toEqual({ v: 1, competencies: { [D2]: [C3, C1] }, domainAreas: { [D1]: A1 }, areaNames: { [A1]: "Clinical" } });
    expect(T.frameworks[0].layout_draft_by).toBe(AUTHOR.userId);
    expect(live()).toEqual(["Alpha@D1=1", "Beta@D1=2", "Gamma@D2=1"]);
    expect(T.framework_domains.every(d => d.area_id === null)).toBe(true);
    expect(T.framework_areas[0].name).toBe("Clinical Practice");
  });
  it("delete only an empty Area; a published Area placed in the draft is not empty", async () => {
    published();
    T.framework_areas = [{ id: A1, framework_id: FW, name: "Clinical Practice", description: null, sort_order: 1 }];
    await setDomainArea(fake(), AUTHOR, { frameworkId: FW, domainId: D1, areaId: A1 });
    expect(await deleteArea(fake(), AUTHOR, { frameworkId: FW, areaId: A1 })).toMatchObject({ ok: false, status: 409 });
    await setDomainArea(fake(), AUTHOR, { frameworkId: FW, domainId: D1, areaId: null });
    expect(T.frameworks[0].layout_draft).toBeNull();
    expect(await deleteArea(fake(), AUTHOR, { frameworkId: FW, areaId: A1 })).toMatchObject({ ok: true });
    expect(T.framework_areas).toEqual([]);
  });
  it("refuses a duplicate name and an incomplete Area order", async () => {
    T.framework_areas = [{ id: A1, framework_id: FW, name: "Clinical Practice", description: null, sort_order: 1 }];
    expect(await createArea(fake(), AUTHOR, { frameworkId: FW, name: "clinical practice" })).toMatchObject({ ok: false, status: 409 });
    expect(await reorderAreas(fake(), AUTHOR, { frameworkId: FW, order: [] })).toMatchObject({ ok: false, status: 422 });
    expect(T.audit_log).toEqual([]);
  });
  it("fails closed without 760: nothing is audited or written", async () => {
    no760 = true;
    expect(await createArea(fake(), AUTHOR, { frameworkId: FW, name: "Clinical Practice" })).toMatchObject({ ok: false, status: 409 });
    expect(await moveCompetencyDomain(fake(), AUTHOR, { frameworkId: FW, competencyId: C1, domainId: D2 })).toMatchObject({ ok: false, status: 409 });
    expect(T.audit_log).toEqual([]);
    expect(live()).toEqual(["Alpha@D1=1", "Beta@D1=2", "Gamma@D2=1"]);
  });
});
