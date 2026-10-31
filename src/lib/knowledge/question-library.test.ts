/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { publishVersion, submitDraft } from "./educator";
import { filterCatalogue, versionStatuses, type CatalogueItem, type CatalogueVersion } from "./question-catalogue";

const q = (stem: string, options: string[], source?: unknown) => ({ stem, options, correct_index: 0, rationale: "because it is", ...(source ? { source } : {}) });
const MI = q("A 62-year-old man presents with crushing chest pain radiating to the left arm. What is the most likely diagnosis?", ["Acute myocardial infarction", "Pericarditis", "Aortic dissection", "Pulmonary embolism"]);
const MI2 = q("A 62 year old man presents with crushing chest pain radiating to his left arm. Which is the most likely diagnosis?", ["Acute myocardial infarction", "Pericarditis", "Aortic dissection", "Pneumothorax"]);

/** A tiny PostgREST stand-in: every chain is awaitable and maybeSingle() returns the first row. */
function fakeAdmin(t: Record<string, any>) {
  const log: string[] = [];
  const admin = {
    from(table: string) {
      const rows = () => (typeof t[table] === "function" ? t[table]() : t[table] ?? []);
      const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (res: (v: unknown) => void) => res({ data: rows(), error: null }) };
      return q;
    },
    rpc(fn: string) { log.push(fn); return Promise.resolve({ data: "rv-1", error: null }); },
  };
  return { admin, log };
}
const pool = [{ id: "v-other", resource_id: "r-other", version_no: 1, state: "published", content: MI2 }];
const base = (content: unknown) => ({
  ckri_knowledge_version: () => (/* both the one-version lookup and the pool list read this table */ [{ id: "v1", risk: "standard", content, resource_id: "r1", version_no: 1, state: "draft", ckri_knowledge_resource: { kind: "revision_question" } }, ...pool]),
  ckri_knowledge_resource: [{ id: "r-other", code: "chest-pain-2", title: "Chest pain 2" }],
});

describe("submitDraft: source rights and the duplicate confirmation", () => {
  it("a likely duplicate needs the confirmation; with it, the submission goes to the database function", async () => {
    const { admin, log } = fakeAdmin(base(MI));
    const refused = await submitDraft(admin, "u1", "v1");
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { error: string }).error).toMatch(/chest-pain-2/);
    expect(log).toEqual([]);
    const ok = await submitDraft(admin, "u1", "v1", { duplicatesChecked: true });
    expect(ok.ok).toBe(true);
    expect(log).toEqual(["ckri_knowledge_submit"]);
  });
  it("an unrelated question submits without any confirmation", async () => {
    const other = q("Which electrolyte disturbance is typically associated with peaked T waves on an ECG?", ["Hyperkalaemia", "Hypokalaemia", "Hypocalcaemia", "Hypernatraemia"]);
    const { admin, log } = fakeAdmin(base(other));
    expect((await submitDraft(admin, "u1", "v1")).ok).toBe(true);
    expect(log).toEqual(["ckri_knowledge_submit"]);
  });
  it("an incomplete or non-reusable source is refused at submit, even with the duplicate confirmation", async () => {
    const nc = q("Which electrolyte disturbance is typically associated with peaked T waves on an ECG?", ["a1", "b", "c", "d"], { kind: "open_licence", reference: "https://x", licence: "CC BY-NC 4.0" });
    const { admin, log } = fakeAdmin(base(nc));
    const r = await submitDraft(admin, "u1", "v1", { duplicatesChecked: true });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/does not allow/);
    expect(log).toEqual([]);
  });
});

describe("publishVersion enforces rights on the application layer", () => {
  it("refuses a revision question with an NC licence before the RPC; publishes a clean one", async () => {
    const bad = fakeAdmin({ ckri_knowledge_version: [{ content: q("s".repeat(12), ["a", "b", "c", "d"], { kind: "open_licence", reference: "r", licence: "CC BY-NC" }), ckri_knowledge_resource: { kind: "revision_question" } }] });
    expect(await publishVersion(bad.admin, "p1", "v1")).toMatchObject({ ok: false });
    expect(bad.log).toEqual([]);
    const good = fakeAdmin({ ckri_knowledge_version: [{ content: q("s".repeat(12), ["a", "b", "c", "d"], { kind: "open_licence", reference: "r", licence: "CC BY 4.0" }), ckri_knowledge_resource: { kind: "revision_question" } }] });
    expect(await publishVersion(good.admin, "p1", "v1")).toEqual({ ok: true });
    expect(good.log).toEqual(["ckri_knowledge_publish"]);
  });
  it("other kinds are not judged by it", async () => {
    const { admin, log } = fakeAdmin({ ckri_knowledge_version: [{ content: { body: "x", source: { kind: "nonsense" } }, ckri_knowledge_resource: { kind: "explanation" } }] });
    expect(await publishVersion(admin, "p1", "v1")).toEqual({ ok: true });
    expect(log).toEqual(["ckri_knowledge_publish"]);
  });
});

const ver = (id: string, status: CatalogueVersion["status"], over: Partial<CatalogueVersion> = {}): CatalogueVersion => ({
  id, versionNo: 1, state: "draft", status, origin: "educator", aiProvenance: null, content: {}, stem: `stem of ${id}`, options: [], correctIndex: 0, rationale: "", source: null,
  competencyIds: [], approvals: 0, required: null, educatorReviewed: false, createdAt: "", submittedAt: null, publishedAt: null, trail: [],
  format: "mcq", formatLabel: "Single best answer", keyText: "", marking: "", rubric: null, ...over,
});
const item = (code: string, latest: CatalogueVersion, extra: Partial<CatalogueItem> = {}): CatalogueItem => ({
  resourceId: `r-${code}`, code, title: `Title ${code}`, resourceStatus: "active", createdAt: "", versions: [latest], latest, served: null, competencyIds: [], topics: [`Title ${code}`], ...extra,
});

describe("catalogue filters", () => {
  const items = [
    item("a", ver("va", "draft")),
    item("b", ver("vb", "in_review", { educatorReviewed: true }), { competencyIds: ["c1"] }),
    item("c", ver("vc2", "draft", { versionNo: 2 }), { served: ver("vc", "published"), competencyIds: ["c1"] }),
    item("d", ver("vd", "retired", { origin: "ai_draft" })),
  ];
  const f = (o: Parameters<typeof filterCatalogue>[1], dup: string[] = []) => filterCatalogue(items, o, new Set(dup)).map(i => i.code);
  it("search matches code, title and stem", () => { expect(f({ q: "VD" })).toEqual(["d"]); expect(f({ q: "title c" })).toEqual(["c"]); expect(f({ q: "stem of vb" })).toEqual(["b"]); });
  it("status", () => {
    expect(f({ status: "draft" })).toEqual(["a", "c"]);
    expect(f({ status: "submitted" })).toEqual(["b"]);
    expect(f({ status: "reviewed" })).toEqual(["b"]);
    expect(f({ status: "published" })).toEqual(["c"]); // a newer draft does not hide the version learners are given
    expect(f({ status: "retired" })).toEqual(["d"]);
  });
  it("origin, competency, topic, duplicates", () => {
    expect(f({ origin: "ai_draft" })).toEqual(["d"]);
    expect(f({ competency: "c1" })).toEqual(["b", "c"]);
    expect(f({ topic: "title a" })).toEqual(["a"]);
    expect(f({ duplicates: true }, ["vb"])).toEqual(["b"]);
  });
  it("versionStatuses maps the seven filter statuses", () => {
    expect(versionStatuses({ status: "approved", educatorReviewed: true })).toEqual(["reviewed", "approved"]);
    expect(versionStatuses({ status: "superseded", educatorReviewed: false })).toEqual(["superseded"]);
  });
});

// SQIE-LIBRARY-EXPANSION-01 (801): "active" = learners are given a version now. A retired version is never served.
describe("the catalogue's active filter after a single version is retired", () => {
  it("an item is active only while it serves a published version of an active resource", () => {
    const pub = ver("v1", "published", { state: "published" }), ret = ver("v2", "retired", { state: "retired" });
    const serving = item("serving", pub, { served: pub });
    const retiredOnly = item("retired-only", ret, { versions: [ret], served: null });
    const retiredResource = item("gone", pub, { served: pub, resourceStatus: "retired" });
    const got = filterCatalogue([serving, retiredOnly, retiredResource], { status: "active" }, new Set()).map(i => i.code);
    expect(got).toEqual(["serving"]);
    expect(filterCatalogue([serving, retiredOnly], { status: "retired" }, new Set()).map(i => i.code)).toEqual(["retired-only"]);
    expect(versionStatuses(ret)).toEqual(["retired"]);
  });
});
