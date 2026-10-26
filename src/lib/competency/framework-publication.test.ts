/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOLDINGS_ONLY, isHoldingsGoverned, transitionFramework } from "./framework-lifecycle";
import { archivePublication, contributorsOf, decidePublication, nextVersion, publisherConflict, submitForPublication } from "./framework-publication";

// Owner, COMPETEN COMPETENCY FRAMEWORKS -- CENTRAL GOVERNANCE (26 Oct 2026), migration 580: a centrally governed framework
// (shared, CFCA layer) is published only through Holdings, by an independent publisher, with an advancing version label,
// and the legacy estate paths cannot move it.

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));

const FW = "00000000-0000-4000-8000-0000000000f1", DOM = "00000000-0000-4000-8000-0000000000d1", COMP = "00000000-0000-4000-8000-0000000000e1";
const AUTHOR = { userId: "00000000-0000-4000-8000-0000000000a1", name: "Author" };
const PUBLISHER = { userId: "00000000-0000-4000-8000-0000000000b1", name: "Publisher" };

let T: Record<string, any[]>;
let failPublish: string | null;
function fake() {
  const from = (table: string) => {
    const f: ((r: any) => boolean)[] = [];
    const q: any = {};
    let write: { op: string; row: any } | null = null;
    for (const op of ["select", "order", "limit", "not"]) q[op] = () => q;
    q.eq = (k: string, v: any) => { f.push(r => !(k in r) || r[k] === v); return q; };
    q.is = (k: string, v: any) => { f.push(r => !(k in r) || r[k] === v); return q; };
    q.in = (k: string, vs: any[]) => { f.push(r => vs.includes(r[k])); return q; };
    q.insert = (row: any) => { write = { op: "insert", row }; return q; };
    q.update = (row: any) => { write = { op: "update", row }; return q; };
    const hit = () => (T[table] ??= []).filter(r => f.every(p => p(r)));
    const done = () => {
      if (write?.op === "insert") { T[table].push({ ...write.row }); return { data: null, error: null }; }
      if (write?.op === "update") {
        if (table === "frameworks" && write.row.pub_status === "published" && failPublish) return { data: null, error: { message: failPublish } };
        for (const r of hit()) Object.assign(r, write.row);
        return { data: null, error: null };
      }
      return { data: hit(), error: null };
    };
    q.maybeSingle = async () => ({ data: hit()[0] ?? null, error: null });
    q.single = async () => ({ data: hit()[0] ?? null, error: null });
    q.then = (ok: any, ko: any) => Promise.resolve(done()).then(ok, ko);
    return q;
  };
  return { from, rpc: async () => ({ data: [], error: null }) };
}
const fw = (over: Record<string, any> = {}) => ({ id: FW, name: "CF Foundation", hospital_id: null, competency_layer: "foundational", pub_status: "draft", version_num: 0, version_major: 1, version_minor: 0, version_revision: 0, ...over });

beforeEach(() => {
  failPublish = null;
  T = {
    frameworks: [fw()],
    framework_domains: [{ id: DOM, framework_id: FW, framework_competencies: [{ id: COMP }] }],
    content_approvals: [], audit_log: [{ actor_id: AUTHOR.userId, action: "create_competency", entity_id: COMP }],
    framework_versions: [], competency_catalogue_entry: [],
  };
});

describe("pure rules", () => {
  it("a governed framework is shared AND layered (the 466 predicate)", () => {
    expect(isHoldingsGoverned({ hospital_id: null, competency_layer: "foundational" })).toBe(true);
    expect(isHoldingsGoverned({ hospital_id: null, competency_layer: null })).toBe(false);
    expect(isHoldingsGoverned({ hospital_id: "h1", competency_layer: "foundational" })).toBe(false);
    expect(isHoldingsGoverned({ competency_layer: "foundational" })).toBe(false);
  });
  it("the label advances by the kind of change, and a first publication keeps its label", () => {
    const v = { major: 1, minor: 2, revision: 3 };
    expect(nextVersion(v, "major", false)).toEqual({ major: 2, minor: 0, revision: 0 });
    expect(nextVersion(v, "minor", false)).toEqual({ major: 1, minor: 3, revision: 0 });
    expect(nextVersion(v, "revision", false)).toEqual({ major: 1, minor: 2, revision: 4 });
    expect(nextVersion(v, "major", true)).toBeNull();
  });
  it("contributors are content makers and curators, never governance acts", () => {
    expect(contributorsOf([
      { actor_id: "a", action: "update_competency" }, { actor_id: "c", action: "catalogue_entry_add" },
      { actor_id: "g", action: "publish" }, { actor_id: "g", action: "approve_content" }, { actor_id: "r", action: "clinical_review_decided" },
    ]).sort()).toEqual(["a", "c"]);
    expect(publisherConflict("p", "p", [])).toMatch(/put this framework forward/);
    expect(publisherConflict("p", "s", ["p"])).toMatch(/authored or curated/);
    expect(publisherConflict("p", "s", ["a"])).toBeNull();
  });
});

describe("the legacy estate paths cannot move a governed framework", () => {
  it("transitionFramework refuses without the Holdings path, and nothing is written", async () => {
    for (const a of ["submit_review", "publish", "archive", "revert"] as const) {
      const r = await transitionFramework(fake(), FW, a, { id: AUTHOR.userId, name: null });
      expect(r).toMatchObject({ ok: false, code: 409, error: HOLDINGS_ONLY });
    }
    expect(T.frameworks[0].pub_status).toBe("draft");
    expect(T.content_approvals).toEqual([]);
  });
  it("a hospital framework still moves through the legacy path", async () => {
    T.frameworks = [fw({ hospital_id: "00000000-0000-4000-8000-0000000000h1" })];
    expect(await transitionFramework(fake(), FW, "submit_review", { id: AUTHOR.userId, name: null })).toMatchObject({ ok: true });
  });
  it("the estate review queue and the estate studio refuse it in code", () => {
    for (const p of ["src/app/api/content/review/route.ts", "src/app/api/studio/authoring/route.ts"]) {
      const src = readFileSync(p, "utf8").replace(/^\s*\/\/.*$/gm, "");
      expect(src, p).toMatch(/isHoldingsGoverned\(/);
      expect(src, p).toMatch(/HOLDINGS_ONLY/);
    }
  });
});

describe("Holdings publication", () => {
  it("draft -> put forward -> an independent publisher publishes, with a version and its provenance", async () => {
    expect(await submitForPublication(fake(), AUTHOR, { frameworkId: FW })).toMatchObject({ ok: true, status: "in_review" });
    expect(T.content_approvals).toHaveLength(1);
    const r = await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish", note: "Ready" });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, status: "published", version: "1.0.0" });
    expect(T.frameworks[0]).toMatchObject({ pub_status: "published", version_num: 1 });
    expect(T.framework_versions[0]).toMatchObject({ version_num: 1, notes: "Ready", snapshot: expect.objectContaining({ version_label: "1.0.0", published_by: PUBLISHER.userId }) });
    expect(T.content_approvals[0]).toMatchObject({ status: "approved", reviewed_by: PUBLISHER.userId });
  });

  it("the person who put it forward, or anybody who authored it, cannot publish it", async () => {
    await submitForPublication(fake(), PUBLISHER, { frameworkId: FW });
    expect(await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish" })).toMatchObject({ ok: false, status: 403 });
    T.content_approvals = []; T.frameworks[0].pub_status = "draft";
    await submitForPublication(fake(), PUBLISHER, { frameworkId: FW });
    T.content_approvals[0].submitted_by = "00000000-0000-4000-8000-0000000000c9";
    expect(await decidePublication(fake(), AUTHOR, { frameworkId: FW, decision: "publish" })).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/authored or curated/) });
    expect(T.frameworks[0].pub_status).toBe("in_review");
    expect(T.framework_versions).toEqual([]);
  });

  it("466 refusing publication leaves the label, the request and the versions untouched", async () => {
    T.frameworks = [fw({ pub_status: "published", version_num: 1 })];
    await submitForPublication(fake(), AUTHOR, { frameworkId: FW });
    failPublish = "cfca publication: 1 of 1 competencies are not clinically approved at their current content";
    const r = await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish", changeKind: "minor" });
    expect(r).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/1 of its 1 competencies/) });
    expect(T.frameworks[0]).toMatchObject({ version_major: 1, version_minor: 0, version_num: 1 });
    expect(T.content_approvals[0].status).toBe("pending");
  });

  it("a revision is put forward while the framework stays published, and needs a kind of change", async () => {
    T.frameworks = [fw({ pub_status: "published", version_num: 1 })];
    expect(await submitForPublication(fake(), AUTHOR, { frameworkId: FW })).toMatchObject({ ok: true, status: "published" });
    expect(T.frameworks[0].pub_status).toBe("published");
    expect(await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish" })).toMatchObject({ ok: false, status: 400 });
    const r = await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish", changeKind: "major" });
    expect(r).toMatchObject({ ok: true, version: "2.0.0" });
    expect(T.frameworks[0]).toMatchObject({ version_major: 2, version_minor: 0, version_revision: 0, version_num: 2 });
    expect(T.framework_versions[0].snapshot.version_label).toBe("2.0.0");
  });

  it("returning needs a reason; a draft goes back to draft, a published framework stays published", async () => {
    await submitForPublication(fake(), AUTHOR, { frameworkId: FW });
    expect(await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "return" })).toMatchObject({ ok: false, status: 400 });
    expect(await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "return", note: "Outcome 3 is vague" })).toMatchObject({ ok: true, status: "draft" });
    expect(T.frameworks[0].pub_status).toBe("draft");
    expect(T.content_approvals[0]).toMatchObject({ status: "rejected", comment: "Outcome 3 is vague" });
  });

  it("nothing to decide, an ungoverned framework, and archiving without a reason are refused", async () => {
    expect(await decidePublication(fake(), PUBLISHER, { frameworkId: FW, decision: "publish" })).toMatchObject({ ok: false, status: 409 });
    T.frameworks = [fw({ competency_layer: null })];
    expect(await submitForPublication(fake(), AUTHOR, { frameworkId: FW })).toMatchObject({ ok: false, status: 404 });
    T.frameworks = [fw({ pub_status: "published", version_num: 1 })];
    expect(await archivePublication(fake(), PUBLISHER, { frameworkId: FW })).toMatchObject({ ok: false, status: 400 });
    expect(await archivePublication(fake(), PUBLISHER, { frameworkId: FW, note: "Superseded by CF-FOUND-2" })).toMatchObject({ ok: true, status: "archived" });
    expect(T.audit_log.at(-1)).toMatchObject({ action: "archive", new_value: expect.objectContaining({ note: "Superseded by CF-FOUND-2" }) });
  });
});

describe("the route", () => {
  it("puts forward under author or curator, and decides only under the publisher capability", () => {
    const src = readFileSync("src/app/api/hq/competency/publication/route.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src.match(/hqApiGate\(/g)).toHaveLength(2);
    expect(src).toMatch(/action === "submit"\s*\?\s*await hqApiGate\(\["hq\.quality\.competency\.author", "hq\.individual\.config\.manage"\]\)\s*:\s*await hqApiGate\(\["hq\.quality\.competency\.publish"\]\)/);
  });
});
