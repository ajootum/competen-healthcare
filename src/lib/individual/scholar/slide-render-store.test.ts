/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { deleteMaterial, eraseAllMaterial, sweepPersonUploads } from "./store";

// SCHOLAR-VISUAL-001 phase 2: drawn slides live in the learner's folder beside their files. The clean-up of abandoned uploads must never take one for
// an abandoned upload (a broken picture in every saved lesson), and deleting a file must take all of its drawn slides, recorded or not.

const U = "00000000-0000-4000-8000-0000000000aa", M = "00000000-0000-4000-8000-0000000000bb", OTHER = "00000000-0000-4000-8000-0000000000cc";
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-06T12:00:00Z");
const old = new Date(NOW - 3 * DAY).toISOString();
const drawnPath = `${U}/render-${M}-35-abcdefabcdefabcd.webp`;
const original = `${U}/${M}.pptx`;

function fake(opts: { renderFails?: boolean; renderMissing?: boolean; objects?: { name: string; created_at?: string }[]; unrecorded?: string[] } = {}) {
  const removed: string[] = [];
  const tables: Record<string, any[]> = {
    individual_scholar_material: [{ id: M, user_id: U, storage_path: original }],
    individual_scholar_material_render: [{ material_id: M, user_id: U, units: [{ path: drawnPath }, { path: `${OTHER}/not-yours.webp` }] }],
  };
  const from = (table: string) => {
    const result = () => {
      if (table === "individual_scholar_material_render" && opts.renderFails) return { data: null, error: { code: "500", message: "unreadable" } };
      if (table === "individual_scholar_material_render" && opts.renderMissing) return { data: null, error: { code: "42P01", message: "relation does not exist" } };
      return { data: tables[table] ?? [], error: null };
    };
    const q: any = {
      select: () => q, delete: () => q, update: () => q, insert: async () => ({ error: null }), eq: () => q, in: () => q, lt: () => q, gte: () => q, not: () => q, is: () => q, or: () => q, limit: () => q, order: () => q,
      maybeSingle: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
    };
    return q;
  };
  const admin = {
    from,
    rpc: async () => ({ error: null }),
    storage: { from: () => ({
      list: async (_u: string, o?: { search?: string }) => ({ data: o?.search ? (opts.unrecorded ?? []).map(name => ({ name })) : opts.objects ?? [], error: null }),
      remove: async (p: string[]) => { removed.push(...p); return { error: null }; },
    }) },
  };
  return { admin, removed };
}

describe("the clean-up of abandoned uploads", () => {
  const objects = [
    { name: `${M}.pptx`, created_at: old },
    { name: `render-${M}-35-abcdefabcdefabcd.webp`, created_at: old },
    { name: "abandoned.pdf", created_at: old },
  ];
  it("leaves a drawn slide alone, however old, and still clears a real abandoned upload", async () => {
    const f = fake({ objects });
    await sweepPersonUploads(f.admin as any, U, NOW);
    expect(f.removed).toEqual([`${U}/abandoned.pdf`]);
  });
  it("takes an image no record names: a job killed part-way", async () => {
    const f = fake({ objects: [{ name: `render-${M}-36-1111111111111111.webp`, created_at: old }] });
    await sweepPersonUploads(f.admin as any, U, NOW);
    expect(f.removed).toEqual([`${U}/render-${M}-36-1111111111111111.webp`]);
  });
  it("removes nothing when it cannot tell which are drawn", async () => {
    const f = fake({ objects, renderFails: true });
    expect(await sweepPersonUploads(f.admin as any, U, NOW)).toBe(0);
    expect(f.removed).toEqual([]);
  });
  it("with the table absent (1010 not applied), works as it did", async () => {
    const f = fake({ objects: [{ name: "abandoned.pdf", created_at: old }], renderMissing: true });
    await sweepPersonUploads(f.admin as any, U, NOW);
    expect(f.removed).toEqual([`${U}/abandoned.pdf`]);
  });
});

describe("deleting", () => {
  it("one file takes its drawn slides, recorded or not, and never a path outside the learner's folder", async () => {
    const f = fake({ unrecorded: [`render-${M}-36-1111111111111111.webp`] });
    expect(await deleteMaterial(f.admin as any, U, M)).toEqual({ ok: true, found: true });
    expect(f.removed).toEqual(expect.arrayContaining([original, drawnPath, `${U}/render-${M}-36-1111111111111111.webp`]));
    expect(f.removed.some(p => p.startsWith(OTHER))).toBe(false);
  });
  it("stops if the drawn slides cannot be read: nothing is stranded", async () => {
    const f = fake({ renderFails: true });
    expect((await deleteMaterial(f.admin as any, U, M)).ok).toBe(false);
    expect(f.removed).toEqual([]);
  });
  it("everything takes every drawn slide by its recorded path", async () => {
    const f = fake();
    expect((await eraseAllMaterial(f.admin as any, U)).ok).toBe(true);
    expect(f.removed).toEqual(expect.arrayContaining([original, drawnPath]));
    expect(f.removed.some(p => p.startsWith(OTHER))).toBe(false);
  });
});
