import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { addPictureSlideSections } from "./store";

// SCHOLAR-PPTX-READING-01: the picture on a slide with text is read and charged once, whatever fails afterwards.
const USER = "u1", MATERIAL = "m1";
type Row = Record<string, unknown>;

function fakeDb(o: { failMaterialUpdate?: (n: number) => boolean; failInsert?: boolean }) {
  const state = {
    quality: { unit: "slide", units: 3, empty_units: [], chars: 10, sections: 2, slide_facts: { version: 1, checkedAt: "x", blank: [], mixed: [2], grouped: [], decorativeOnly: [], review: [] } } as Row,
    chunks: [{ id: "a", ordinal: 1, page_from: 1 }, { id: "b", ordinal: 2, page_from: 2 }] as Row[],
    updates: 0,
  };
  const chain = (table: string) => {
    let patch: Row | null = null;
    const api: Record<string, unknown> = {
      select: () => api, eq: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => ({ data: { extraction_quality: state.quality, chunk_count: state.chunks.length, char_count: 10, extractor: "x" }, error: null }),
      update: (p: Row) => { patch = p; return api; },
      insert: async (rows: Row[]) => {
        if (o.failInsert) return { error: { message: "no" } };
        state.chunks.push(...rows);
        return { error: null };
      },
      then: (done: (v: unknown) => void) => {
        if (table === "individual_scholar_chunk" && !patch) return done({ data: [...state.chunks], error: null });
        if (table === "individual_scholar_material" && patch) {
          state.updates++;
          if (o.failMaterialUpdate?.(state.updates)) return done({ error: { message: "no" } });
          state.quality = patch.extraction_quality as Row;
        }
        return done({ error: null });
      },
    };
    return api;
  };
  return { admin: { from: chain } as never, state };
}

const input = { additions: [{ pageFrom: 2, pageTo: 2, content: "Read from the picture." }], read: [2], tried: [2], extractorTag: "t", provenance: null };

describe("reading the picture on a slide with text", () => {
  it("adds its section after the slide's own, and records it", async () => {
    const { admin, state } = fakeDb({});
    const r = await addPictureSlideSections(admin, USER, MATERIAL, input);
    expect(r).toEqual({ ok: true, added: 1, recorded: true });
    expect(state.chunks).toHaveLength(3);
    expect(state.quality.ai_read_units).toEqual([2]);
    expect(state.quality.ai_tried_units).toEqual([2]);
  });
  it("⚠ if the last save fails, the same reading cannot add the section twice", async () => {
    const { admin, state } = fakeDb({ failMaterialUpdate: n => n === 2 });
    const first = await addPictureSlideSections(admin, USER, MATERIAL, input);
    expect(first).toMatchObject({ ok: true, added: 1, recorded: false });
    expect(state.quality.ai_read_units).toEqual([2]);
    const again = await addPictureSlideSections(admin, USER, MATERIAL, input);
    expect(again).toEqual({ ok: true, added: 0, recorded: false });
    expect(state.chunks).toHaveLength(3);
  });
  it("⚠ if the section cannot be added, the slide is not left saying it was read", async () => {
    const { admin, state } = fakeDb({ failInsert: true });
    const r = await addPictureSlideSections(admin, USER, MATERIAL, input);
    expect(r).toEqual({ ok: false, error: "insert" });
    expect(state.quality.ai_read_units).toBeUndefined();
    expect(state.quality.ai_tried_units).toBeUndefined();
  });
});
