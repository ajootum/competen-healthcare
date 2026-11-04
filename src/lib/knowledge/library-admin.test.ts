import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("./educator", () => ({
  submitDraft: vi.fn(async (_a: unknown, _m: string, id: string) => { calls.push(`submit:${id}`); return id.endsWith("1") ? { ok: true } : { ok: false, error: "Possible duplicate of q-2." }; }),
  newVersion: vi.fn(async (_a: unknown, _m: string, id: string) => { calls.push(`new:${id}`); return { ok: true, versionId: `v-of-${id}` }; }),
  retireVersion: vi.fn(async (_a: unknown, _m: string, id: string, reason: string) => { calls.push(`retire:${id}:${reason}`); return { ok: true }; }),
  publishVersion: vi.fn(async (_a: unknown, _m: string, id: string) => { calls.push(`publish:${id}`); return { ok: false, error: "not independent" }; }),
  createResource: vi.fn(async (_a: unknown, _m: string, r: { code: string; ai?: unknown }) => { calls.push(`create:${r.code}:${r.ai ? "ai" : "educator"}`); return r.code === "dup" ? { ok: false, error: "duplicate code" } : { ok: true, resourceId: `r-${r.code}`, versionId: `v-${r.code}` }; }),
  setCompetencies: vi.fn(async (_a: unknown, v: string, ids: string[]) => { calls.push(`comp:${v}:${ids.length}`); return { ok: true }; }),
}));

import { BULK_MAX, IMPORT_MAX, bulkIds, importDrafts, importItems, importProvenance, loadCompetencyOptions, pickableCompetencies, runBulk } from "./library-admin";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("bulkIds", () => {
  it("distinct uuids only", () => { expect(bulkIds([U(1), U(1), "x", 5, U(2)])).toEqual({ ok: true, ids: [U(1), U(2)] }); });
  it("none, or over the cap, is refused whole (never silently cut)", () => {
    expect(bulkIds([]).ok).toBe(false);
    expect(bulkIds(Array.from({ length: BULK_MAX + 1 }, (_, i) => U(i + 1))).ok).toBe(false);
  });
});

describe("runBulk: every item through the single-item function, each reported on its own", () => {
  it("one refusal does not stop the others", async () => {
    calls.length = 0;
    const r = await runBulk({}, "me", "bulk_submit", [U(1), U(2), U(11)]);
    expect(r).toEqual([{ id: U(1), ok: true }, { id: U(2), ok: false, error: "Possible duplicate of q-2." }, { id: U(11), ok: true }]);
    expect(calls).toEqual([`submit:${U(1)}`, `submit:${U(2)}`, `submit:${U(11)}`]);
  });
  it("replace starts a new version; retire passes the one reason", async () => {
    calls.length = 0;
    expect(await runBulk({}, "me", "bulk_replace", [U(3)])).toEqual([{ id: U(3), ok: true, versionId: `v-of-${U(3)}` }]);
    await runBulk({}, "me", "bulk_retire", [U(4)], "Outdated guidance replaced.");
    expect(calls).toEqual([`new:${U(3)}`, `retire:${U(4)}:Outdated guidance replaced.`]);
  });
});

describe("the competency picker offers published catalogues only", () => {
  it("pickableCompetencies refuses ids outside the options and caps at 20", () => {
    const options = Array.from({ length: 25 }, (_, i) => ({ id: U(i + 1), title: `C${i}`, code: null, catalogue: "NUR-CCF" }));
    const r = pickableCompetencies([U(1), U(99), U(1), ...options.map(o => o.id)], options);
    expect(r.refused).toEqual([U(99)]);
    expect(r.ok.length).toBe(20);
  });
  it("loadCompetencyOptions: published catalogue entries, then draft mappings from frameworks pending publication", async () => {
    const seen: Record<string, unknown[]> = {};
    const q = (table: string, data: unknown[]) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "is", "eq", "in", "limit", "order"]) chain[m] = (...a: unknown[]) => { (seen[table] ??= []).push([m, ...a]); return chain; };
      chain.then = (res: (v: unknown) => void) => res({ data, error: null });
      return chain;
    };
    let compCall = 0;
    const admin = { from: (t: string) => q(t, t === "frameworks" ? [{ id: "f1", name: "Nursing CCF", pub_status: "published" }, { id: "f2", name: "Competen Nursing", code: "NUR-CCF", pub_status: "draft" }]
      : t === "competency_catalogue_entry" ? [{ catalogue_id: "f1", competency_id: U(1), sort_order: 1 }, { catalogue_id: "f1", competency_id: U(2), sort_order: 0 }]
      : t === "framework_domains" ? [{ id: "d2", framework_id: "f2" }]
      : compCall++ === 0 ? [{ id: U(1), name: "Fluid balance", code: "FB1" }, { id: U(2), name: "Airway", code: null }]
      : [{ id: U(3), name: "Hemodynamic Assessment", code: "NUR-CCF-010", domain_id: "d2" }, { id: U(1), name: "Fluid balance", code: "FB1", domain_id: "d2" }]) };
    const out = await loadCompetencyOptions(admin);
    expect(out?.map(o => [o.title, !!o.pending])).toEqual([["Airway", false], ["Fluid balance", false], ["Hemodynamic Assessment", true]]);
    expect(out?.[2].catalogue).toMatch(/not published \(draft mapping\)/);
    expect(seen.frameworks).toContainEqual(["is", "hospital_id", null]);
    expect(seen.frameworks).toContainEqual(["in", "pub_status", ["published", "draft", "in_review", "approved"]]);
  });
});

describe("bulk publish goes through publishVersion and reports its refusal", () => {
  it("one item", async () => {
    calls.length = 0;
    expect(await runBulk({}, "me", "bulk_publish", [U(5)])).toEqual([{ id: U(5), ok: false, error: "not independent" }]);
    expect(calls).toEqual([`publish:${U(5)}`]);
  });
});

describe("bulk draft import (owner decision 4 Nov, item 2)", () => {
  it("reads items, refuses the unreadable, duplicates and over the cap", () => {
    expect(importItems([{ code: "a", title: "A", fields: { format: "mcq" } }])).toMatchObject({ ok: true });
    expect(importItems([]).ok).toBe(false);
    expect(importItems([{ code: "a", title: "A" }]).ok).toBe(false);
    expect(importItems([{ code: "a", title: "A", fields: {} }, { code: "a", title: "B", fields: {} }]).ok).toBe(false);
    expect(importItems(Array.from({ length: IMPORT_MAX + 1 }, (_, i) => ({ code: `c${i}`, title: "t", fields: {} }))).ok).toBe(false);
  });
  it("AI provenance needs both model and prompt version", () => {
    expect(importProvenance(undefined)).toBeNull();
    expect(importProvenance({ model: "m", prompt_version: "p" })).toEqual({ model: "m", prompt_version: "p" });
    expect(importProvenance({ model: "m" })).toBe("invalid");
  });
  it("drafts only, each on its own; a competency outside the options refuses only that item", async () => {
    calls.length = 0;
    const options = [{ id: U(1), title: "C", code: null, catalogue: "NUR-CCF -- not published (draft mapping)", pending: true }];
    const r = await importDrafts({}, "me", [
      { code: "a", title: "A", fields: {}, competencyIds: [U(1)] }, { code: "dup", title: "D", fields: {} }, { code: "b", title: "B", fields: {}, competencyIds: [U(9)] },
    ], { model: "m", prompt_version: "p" }, options);
    expect(r).toEqual([
      { code: "a", ok: true, resourceId: "r-a", versionId: "v-a", competencies: 1 },
      { code: "dup", ok: false, error: "duplicate code" },
      { code: "b", ok: false, error: "1 of its competencies are in no catalogue or framework that can be mapped." },
    ]);
    expect(calls).toEqual(["create:a:ai", "comp:v-a:1", "create:dup:ai"]);
  });
});
