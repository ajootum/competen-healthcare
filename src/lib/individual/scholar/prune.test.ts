/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { deleteMaterial } from "./store";

// REVISION-01 s8 / LEARN-01 L4: deleting a material removes what it emptied -- a Learn session with no step, a saved
// revision set or a revision session with no question left -- and nothing else. A failed read never prunes. Every
// statement is keyed on the user (store rule A1). The database is an in-memory fake: these pin Scholar's rule only.

const U = "00000000-0000-4000-8000-0000000000aa", M = "00000000-0000-4000-8000-0000000000bb";
type Row = Record<string, unknown>;

function fakeAdmin(tables: Record<string, Row[]>, failRead: string | null = null) {
  const deletes: { table: string; userKeyed: boolean; ids: unknown[] }[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [], ins: [string, unknown[]][] = [];
    let op: "select" | "delete" = "select";
    const rows = () => (tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v) && ins.every(([k, vs]) => vs.includes(r[k])));
    const run = () => {
      if (op === "delete") {
        const gone = rows();
        deletes.push({ table, userKeyed: filters.some(([k, v]) => k === "user_id" && v === U), ids: gone.map(r => r.id) });
        tables[table] = (tables[table] ?? []).filter(r => !gone.includes(r));
        return { error: null };
      }
      return table === failRead ? { data: null, error: { message: "unreadable" } } : { data: rows(), error: null };
    };
    const q: any = {
      select: () => q, delete: () => { op = "delete"; return q; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      in: (k: string, vs: unknown[]) => { ins.push([k, vs]); return q; },
      limit: () => q, maybeSingle: async () => { const r = run() as any; return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };
  return { admin: { from, storage: { from: () => ({ remove: async () => ({ error: null }) }) } }, deletes, tables };
}

const world = (): Record<string, Row[]> => ({
  individual_scholar_material: [{ id: M, user_id: U, storage_path: "u/m.pdf" }],
  // After the material's cascade: Learn session L1 kept a step, L2 lost all; set S1 kept an item, S2 lost all;
  // revision session R1 kept one, R2 lost all.
  individual_scholar_learning_session: [{ id: "L1", user_id: U }, { id: "L2", user_id: U }],
  individual_scholar_learning_step: [{ session_id: "L1", user_id: U }],
  individual_scholar_revision_set: [{ id: "S1", user_id: U }, { id: "S2", user_id: U }],
  individual_scholar_revision_set_item: [{ set_id: "S1", user_id: U }],
  individual_scholar_revision_session: [{ id: "R1", user_id: U }, { id: "R2", user_id: U }],
  individual_scholar_revision_session_item: [{ session_id: "R1", user_id: U }],
});

describe("deleting a material prunes only what it emptied", () => {
  it("removes the empty Learn session, saved set and revision session, keeps the rest, keyed on the user", async () => {
    const f = fakeAdmin(world());
    expect(await deleteMaterial(f.admin, U, M)).toEqual({ ok: true, found: true });
    expect(f.tables.individual_scholar_learning_session.map(r => r.id)).toEqual(["L1"]);
    expect(f.tables.individual_scholar_revision_set.map(r => r.id)).toEqual(["S1"]);
    expect(f.tables.individual_scholar_revision_session.map(r => r.id)).toEqual(["R1"]);
    expect(f.deletes.every(d => d.userKeyed)).toBe(true);
  });

  it.each(["individual_scholar_learning_step", "individual_scholar_revision_set_item", "individual_scholar_revision_session_item"])(
    "prunes nothing from the parent when %s cannot be read", async child => {
      const f = fakeAdmin(world(), child);
      await deleteMaterial(f.admin, U, M);
      const parent = { individual_scholar_learning_step: "individual_scholar_learning_session", individual_scholar_revision_set_item: "individual_scholar_revision_set",
        individual_scholar_revision_session_item: "individual_scholar_revision_session" }[child]!;
      expect(f.tables[parent]).toHaveLength(2);
    });
});
