/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { isProgrammeRefusal, saveProgramme, validateProgramme } from "@/lib/individual/programme-admin";

// COMPETEN-SCHOLAR-JOIN-01: HQ administration of Scholar programmes -- every 387/389 rule before the database,
// catalogue links only to shared published frameworks, links replaced exactly, nothing deleted but links.

const F1 = "11111111-1111-4111-8111-111111111111", F2 = "22222222-2222-4222-8222-222222222222";
const good = { code: "midwifery-ug-diploma", label: "Midwifery (Uganda), diploma", profession: "Midwifery", country: "ug", level: "Diploma", active: true,
  frameworks: [{ frameworkId: F1, layer: "profession" }] };

type Q = { table: string; op: string; row?: any; filters: [string, unknown][] };
function fakeAdmin(answer: (q: Q) => { data?: any; error?: any } | undefined) {
  const writes: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, op: "select", filters: [] };
    const run = () => { if (q.op !== "select") writes.push(q); const r = answer(q) ?? {}; return { data: r.data ?? null, error: r.error ?? null }; };
    const b: any = {
      select: () => b, order: () => b, limit: () => b, is: () => b,
      eq: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      in: (c: string, v: unknown) => { q.filters.push([c, v]); return b; },
      insert: (row: any) => { q.op = "insert"; q.row = row; return b; },
      update: (row: any) => { q.op = "update"; q.row = row; return b; },
      upsert: (row: any) => { q.op = "upsert"; q.row = row; return b; },
      delete: () => { q.op = "delete"; return b; },
      then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  };
  return { admin: { from }, writes };
}

describe("validateProgramme", () => {
  it("accepts a programme, normalising the country and ordering the links", () => {
    expect(validateProgramme({ ...good, frameworks: [{ frameworkId: F1, layer: "profession" }, { frameworkId: F2.toUpperCase(), layer: "foundational" }] })).toEqual({
      code: "midwifery-ug-diploma", label: "Midwifery (Uganda), diploma", profession: "Midwifery", country: "UG", level: "Diploma", active: true,
      frameworks: [{ frameworkId: F1, layer: "profession", sortOrder: 0 }, { frameworkId: F2, layer: "foundational", sortOrder: 1 }],
    });
  });
  it("refuses what 387 and 389 refuse", () => {
    for (const bad of [
      { code: "Bad Code" }, { label: "" }, { profession: "" }, { country: "UGA" }, { level: "x".repeat(81) },
      { frameworks: [{ frameworkId: "not-a-uuid", layer: "profession" }] },
      { frameworks: [{ frameworkId: F1, layer: "expert" }] },
      { frameworks: [{ frameworkId: F1, layer: "profession" }, { frameworkId: F1, layer: "context" }] },
    ]) expect(isProgrammeRefusal(validateProgramme({ ...good, ...bad }))).toBe(true);
  });
  it("all five 389 layers are accepted, and active defaults to true", () => {
    for (const layer of ["foundational", "profession", "advanced", "specialty", "context"])
      expect(isProgrammeRefusal(validateProgramme({ ...good, frameworks: [{ frameworkId: F1, layer }] }))).toBe(false);
    expect(validateProgramme({ ...good, active: undefined })).toMatchObject({ active: true });
  });
});

describe("saveProgramme", () => {
  const existing = { code: good.code, label: "Old", profession: "Midwifery", country: "UG", level: null, is_active: true };
  it("refuses a catalogue that is not shared, active and published -- before writing anything", async () => {
    const { admin, writes } = fakeAdmin(q => q.table === "frameworks" ? { data: [] } : undefined);
    const p = validateProgramme(good) as any;
    expect(await saveProgramme(admin, p)).toMatchObject({ ok: false, status: 422 });
    expect(writes).toHaveLength(0);
  });
  it("creates a new programme with its links", async () => {
    const { admin, writes } = fakeAdmin(q => q.table === "frameworks" ? { data: [{ id: F1 }] } : { data: [] });
    const r = await saveProgramme(admin, validateProgramme(good) as any);
    expect(r).toMatchObject({ ok: true, before: null });
    expect(writes.find(w => w.table === "individual_scholar_programme")).toMatchObject({ op: "insert", row: { code: good.code, is_active: true, country: "UG" } });
    expect(writes.find(w => w.table === "individual_scholar_programme_framework")).toMatchObject({ op: "upsert", row: [{ programme_code: good.code, framework_id: F1, layer: "profession", sort_order: 0 }] });
  });
  it("an edit updates the row and removes exactly the links no longer listed; retiring never deletes the programme", async () => {
    const { admin, writes } = fakeAdmin(q =>
      q.table === "frameworks" ? { data: [{ id: F1 }] }
      : q.table === "individual_scholar_programme" && q.op === "select" ? { data: [existing] }
      : q.table === "individual_scholar_programme_framework" && q.op === "select" ? { data: [
          { programme_code: good.code, framework_id: F1, layer: "profession", sort_order: 0 },
          { programme_code: good.code, framework_id: F2, layer: "context", sort_order: 1 }] }
      : undefined);
    const r = await saveProgramme(admin, validateProgramme({ ...good, active: false }) as any);
    expect(r).toMatchObject({ ok: true, before: { code: good.code, is_active: true } });
    expect(writes.find(w => w.table === "individual_scholar_programme")).toMatchObject({ op: "update", row: { is_active: false } });
    const del = writes.find(w => w.op === "delete")!;
    expect(del.table).toBe("individual_scholar_programme_framework");
    expect(del.filters).toContainEqual(["framework_id", [F2]]);
    expect(writes.some(w => w.table === "individual_scholar_programme" && w.op === "delete")).toBe(false);
  });
});
