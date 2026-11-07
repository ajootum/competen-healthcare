import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndividualContext } from "../guard";
import { PPTX_MIME } from "./config";

// SCHOLAR-VISUAL-001 phase 2: the safety of the job. The drawn image stays private to its learner, at most one job runs, and any failure leaves a
// clean record and nothing half-stored. The engine itself is proved by the staging walk, not here.

const h = vi.hoisted(() => ({
  policy: { scholarWholeSlides: "on", scholarLessonVisuals: "on", scholarWholeSlidesMax: 80, scholarWholeSlidesConcurrent: 3, scholarLessonVisualsMinPx: 120 },
  material: null as null | { id: string; mimeType: string },
  bytes: null as Uint8Array | null,
  busy: false,
  pdf: vi.fn(),
  pages: 1,
  webp: vi.fn(),
  closed: 0,
  quality: { slideFacts: { version: 1, checkedAt: "x", blank: [], mixed: [], grouped: [], decorativeOnly: [], review: [{ unit: 1, kinds: ["chart"], picture: false }] } } as Record<string, unknown>,
}));
vi.mock("../policy", () => ({ loadIndividualPolicy: async () => h.policy }));
vi.mock("./material-visuals-io", () => ({ scanDeck: async () => ({ slides: 1, pictures: [], undisplayable: [] }) }));
vi.mock("./material-visuals-pdf", () => ({ scanPdfImages: async () => ({ slides: 2, pictures: [], undisplayable: [] }) }));
vi.mock("./store", () => ({
  getMaterial: async () => ({ ok: true, data: h.material }),
  materialBytes: async () => h.bytes,
  materialExtras: async () => ({ byId: new Map([["m1", { quality: h.quality }]]) }),
}));
vi.mock("./slide-render-engine", () => ({
  RenderError: class RenderError extends Error { constructor(public code: string) { super(code); } },
  deckToPdf: h.pdf,
  openPdfDrawing: async () => ({ pageCount: h.pages, draw: h.webp, close: () => { h.closed += 1; } }),
  reserveEngine: () => { if (h.busy) return false; h.busy = true; return true; },
  releaseEngine: () => { h.busy = false; },
}));

import { readDrawnSlide, readRender } from "./slide-render-read";
import { startWholeSlides } from "./slide-render-io";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";

/** A fake database and bucket: the row is keyed on material and user, as the table is. */
function fake() {
  const rows = new Map<string, Record<string, unknown>>();
  const stored = new Set<string>();
  const removed: string[] = [];
  const downloads: string[] = [];
  const key = (r: Record<string, unknown>) => `${r.material_id}`;
  const jobs: { failing: boolean; onCount?: () => void } = { failing: false };
  const admin = {
    from: () => ({
      insert: async (r: Record<string, unknown>) => {
        if (rows.has(key(r))) return { error: { code: "23505", message: "duplicate" } };
        rows.set(key(r), { ...r, units: [], not_drawn: [] });
        return { error: null };
      },
      select: () => {
        const f: Record<string, string> = {};
        let since = "";
        const q = { eq: (k: string, v: string) => { f[k] = v; return q; }, gt: (_k: string, v: string) => { since = v; return q; }, maybeSingle: async () => {
          const r = rows.get(f.material_id);
          return { data: r && r.user_id === f.user_id ? r : null, error: null };
        }, limit: async () => {
          if (jobs.failing) return { data: null, error: { message: "unreadable" } };
          // Reading the count is where a racing request's claim becomes visible.
          jobs.onCount?.();
          return { data: [...rows.values()].filter(r => r.status === f.status && String(r.claimed_at) > since), error: null };
        } };
        return q;
      },
      delete: () => {
        const f: Record<string, unknown> = {};
        const q = { eq: (k: string, v: unknown) => { f[k] = v; return q; }, then: (done: (x: unknown) => void) => {
          const r = rows.get(String(f.material_id));
          if (r && r.user_id === f.user_id && r.attempts === f.attempts) rows.delete(String(f.material_id));
          done({ error: null });
        } };
        return q;
      },
      update: (patch: Record<string, unknown>) => {
        const f: Record<string, unknown> = {};
        const q = { eq: (k: string, v: unknown) => { f[k] = v; return q; }, select: async () => {
          const r = rows.get(String(f.material_id));
          if (!r || r.user_id !== f.user_id || r.attempts !== f.attempts) return { data: [], error: null };
          Object.assign(r, patch);
          return { data: [{ material_id: f.material_id }], error: null };
        } };
        return q;
      },
    }),
    storage: { from: () => ({
      upload: async (p: string) => { stored.add(p); return { error: null }; },
      remove: async (p: string[]) => { removed.push(...p); p.forEach(x => stored.delete(x)); return { error: null }; },
      download: async (p: string) => { downloads.push(p); return { data: new Blob([new Uint8Array([1, 2, 3])]), error: null }; },
    }) },
  };
  return { admin, rows, stored, removed, downloads, jobs };
}
const ctxOf = (admin: unknown, userId: string) => ({ admin, userId }) as unknown as IndividualContext;

async function deck(slides = 1): Promise<Uint8Array> {
  const z = new JSZip();
  const ns = Array.from({ length: slides }, (_, i) => i + 1);
  z.file("ppt/presentation.xml", `<p:presentation><p:sldIdLst>${ns.map(n => `<p:sldId id="${255 + n}" r:id="rId${n}"/>`).join("")}</p:sldIdLst></p:presentation>`);
  z.file("ppt/_rels/presentation.xml.rels", `<Relationships>${ns.map(n => `<Relationship Id="rId${n}" Target="slides/slide${n}.xml"/>`).join("")}</Relationships>`);
  for (const n of ns) z.file(`ppt/slides/slide${n}.xml`, `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"></a:graphicData>`);
  return z.generateAsync({ type: "uint8array" });
}
const factsOf = () => (h.quality as { slideFacts: { review: { unit: number }[] } }).slideFacts;
/** A deck of three chart slides, each drawing as different bytes. */
async function threeSlides() {
  h.bytes = await deck(3);
  h.pages = 3;
  const one = factsOf().review[0];
  factsOf().review = [1, 2, 3].map(unit => ({ ...one, unit }));
  h.webp.mockImplementation(async (page: number) => ({ bytes: new Uint8Array([page, page]), width: 1920, height: 1080, blank: false }));
}
const unitOf = (n: number) => ({ n, path: `${A}/render-m1-${n}-${"a".repeat(16)}.webp`, sha: "a".repeat(16), width: 1920, height: 1080, bytes: 2 });
const stale = () => new Date(Date.now() - 7 * 60_000).toISOString();

beforeEach(async () => {
  h.policy.scholarWholeSlides = "on";
  h.policy.scholarLessonVisuals = "on";
  h.policy.scholarWholeSlidesConcurrent = 3;
  factsOf().review = factsOf().review.slice(0, 1);
  h.material = { id: "m1", mimeType: PPTX_MIME };
  h.bytes = await deck();
  h.busy = false;
  h.pdf.mockReset().mockResolvedValue(new Uint8Array([9]));
  h.pages = 1;
  h.closed = 0;
  h.webp.mockReset().mockResolvedValue({ bytes: new Uint8Array([1, 2]), width: 1920, height: 1080, blank: false });
});

describe("the claim", () => {
  it("policy off starts nothing and writes nothing", async () => {
    const f = fake();
    h.policy.scholarWholeSlides = "off";
    const r = await startWholeSlides(ctxOf(f.admin, A), "m1");
    expect(r.out.body).toEqual({ state: "off" });
    expect(r.run).toBeUndefined();
    expect(f.rows.size).toBe(0);
  });
  it("another person's id is a 404", async () => {
    const f = fake();
    h.material = null;
    expect((await startWholeSlides(ctxOf(f.admin, B), "m1")).out.status).toBe(404);
    expect(f.rows.size).toBe(0);
  });
  it("a Word file is not drawn here", async () => {
    const f = fake();
    h.material = { id: "m1", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    expect((await startWholeSlides(ctxOf(f.admin, A), "m1")).out.body).toEqual({ state: "not_needed" });
  });
  it("runs once: a second request finds the claim and starts nothing", async () => {
    const f = fake();
    const first = await startWholeSlides(ctxOf(f.admin, A), "m1");
    expect(first.out.status).toBe(202);
    const second = await startWholeSlides(ctxOf(f.admin, A), "m1");
    expect(second.run).toBeUndefined();
    expect(second.out.body).toEqual({ state: "running" });
  });
  it("an engine busy with another file spends no claim", async () => {
    const f = fake();
    h.busy = true;
    expect((await startWholeSlides(ctxOf(f.admin, A), "m1")).out.body).toEqual({ state: "busy" });
    expect(f.rows.size).toBe(0);
  });
  it("two requests for two files together: the second is told to come back, and the engine frees when the first ends", async () => {
    const f = fake();
    const first = await startWholeSlides(ctxOf(f.admin, A), "m1");
    h.material = { id: "m2", mimeType: PPTX_MIME };
    expect((await startWholeSlides(ctxOf(f.admin, A), "m2")).out.body).toEqual({ state: "busy" });
    expect(f.rows.has("m2")).toBe(false);
    await first.run!();
    expect(h.busy).toBe(false);
  });
  it("a lost claim frees the engine", async () => {
    const f = fake();
    f.rows.set("m1", { material_id: "m1", user_id: A, status: "running", attempts: 1, claimed_at: new Date().toISOString(), units: [], not_drawn: [] });
    await startWholeSlides(ctxOf(f.admin, A), "m1");
    expect(h.busy).toBe(false);
  });
  it("the table absent (1010 not applied) fails closed", async () => {
    const f = fake();
    const missing = { ...f.admin, from: () => ({ ...f.admin.from(), insert: async () => ({ error: { code: "42P01", message: "relation does not exist" } }) }) };
    const r = await startWholeSlides(ctxOf(missing, A), "m1");
    expect(r.out.body).toEqual({ state: "off" });
    expect(r.run).toBeUndefined();
  });
});

describe("the job", () => {
  it("draws the chart slide and records where it is, in the learner's own folder", async () => {
    const f = fake();
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    const row = f.rows.get("m1")!;
    expect(row.status).toBe("done");
    const units = row.units as { n: number; path: string }[];
    expect(units.map(u => u.n)).toEqual([1]);
    expect(units[0].path.startsWith(`${A}/render-m1-1-`)).toBe(true);
    expect([...f.stored]).toEqual([units[0].path]);
  });
  it("an engine failure records a reason and leaves nothing stored", async () => {
    const { RenderError } = await import("./slide-render-engine");
    const f = fake();
    h.pdf.mockRejectedValue(new RenderError("timed_out"));
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect(f.rows.get("m1")).toMatchObject({ status: "failed", reason: "timed_out", units: [] });
    expect(f.stored.size).toBe(0);
  });
  it("a failure while storing removes what was already stored", async () => {
    const f = fake();
    h.webp.mockRejectedValueOnce(new Error("canvas"));
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect(f.rows.get("m1")).toMatchObject({ status: "failed", reason: "engine_failed", units: [] });
    expect(f.stored.size).toBe(0);
  });
  it("a page count that differs stores nothing: a page must be a place in the deck", async () => {
    const f = fake();
    h.pages = 2;
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect(f.rows.get("m1")).toMatchObject({ status: "failed", reason: "page_count_differs", units: [] });
    expect(f.stored.size).toBe(0);
    expect(h.webp).not.toHaveBeenCalled();
    expect(h.closed).toBe(1);
  });
  it("a slide that draws as flat colour is not stored, and is named as not drawn", async () => {
    const f = fake();
    h.webp.mockResolvedValue({ bytes: new Uint8Array([1]), width: 1920, height: 1080, blank: true });
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect(f.rows.get("m1")).toMatchObject({ status: "partial", units: [], not_drawn: [1] });
    expect(f.stored.size).toBe(0);
  });
  it("a deck whose order cannot be read is never drawn", async () => {
    const f = fake();
    const z = await (await import("jszip")).default.loadAsync(h.bytes as Uint8Array);
    z.remove("ppt/_rels/presentation.xml.rels");
    h.bytes = await z.generateAsync({ type: "uint8array" });
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect(f.rows.get("m1")).toMatchObject({ status: "failed", reason: "order_unknown" });
    expect(h.pdf).not.toHaveBeenCalled();
  });
  it("a file deleted while it was being drawn leaves no image behind", async () => {
    const f = fake();
    const { run } = await startWholeSlides(ctxOf(f.admin, A), "m1");
    h.webp.mockImplementationOnce(async () => { f.rows.delete("m1"); return { bytes: new Uint8Array([1]), width: 1920, height: 1080, blank: false }; });
    await run!();
    expect(f.stored.size).toBe(0);
    expect(f.removed).toHaveLength(1);
  });
});

describe("the job for a PDF", () => {
  const pdf = () => { h.material = { id: "m1", mimeType: "application/pdf" }; h.bytes = new Uint8Array([1]); };
  it("needs no LibreOffice, and draws a page with no text layer", async () => {
    const f = fake();
    pdf();
    const q = h.quality; h.quality = { emptyUnits: [2], aiReadUnits: [] };
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    h.quality = q;
    expect(h.pdf).not.toHaveBeenCalled();
    const row = f.rows.get("m1")!;
    expect(row).toMatchObject({ status: "done" });
    expect((row.units as { n: number }[]).map(u => u.n)).toEqual([2]);
    expect(h.closed).toBe(1);
  });
  it("one page that cannot be drawn does not cost the others their drawing", async () => {
    const f = fake();
    pdf();
    const q = h.quality; h.quality = { emptyUnits: [2], aiReadUnits: [] };
    h.webp.mockRejectedValueOnce(new Error("decode"));
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    h.quality = q;
    expect(f.rows.get("m1")).toMatchObject({ status: "partial", units: [], not_drawn: [2] });
    expect(h.closed).toBe(1);
  });
  it("a page that draws as flat colour is not stored: the button to the original page stays", async () => {
    const f = fake();
    pdf();
    const q = h.quality; h.quality = { emptyUnits: [2], aiReadUnits: [] };
    h.webp.mockResolvedValue({ bytes: new Uint8Array([1]), width: 1920, height: 2717, blank: true });
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    h.quality = q;
    expect(f.rows.get("m1")).toMatchObject({ status: "partial", units: [], not_drawn: [2] });
    expect(f.stored.size).toBe(0);
  });
});

describe("private to its learner", () => {
  const unit = { n: 1, path: `${A}/render-m1-1-abcdefabcdefabcd.webp`, sha: "abcdefabcdefabcd", width: 1920, height: 1080, bytes: 3 };
  const seeded = () => {
    const f = fake();
    f.rows.set("m1", { material_id: "m1", user_id: A, status: "done", attempts: 1, claimed_at: "x", units: [unit], not_drawn: [] });
    return f;
  };
  it("the owner reads their own image", async () => {
    const f = seeded();
    expect(await readDrawnSlide(ctxOf(f.admin, A), "m1", 1, unit.sha)).not.toBeNull();
    expect(f.downloads).toEqual([unit.path]);
  });
  it("another person gets nothing, and nothing is read from storage", async () => {
    const f = seeded();
    expect(await readRender(ctxOf(f.admin, B), "m1")).toBeNull();
    expect(await readDrawnSlide(ctxOf(f.admin, B), "m1", 1, unit.sha)).toBeNull();
    expect(f.downloads).toEqual([]);
  });
  it("a wrong digest or slide is nothing", async () => {
    const f = seeded();
    expect(await readDrawnSlide(ctxOf(f.admin, A), "m1", 1, "0000000000000000")).toBeNull();
    expect(await readDrawnSlide(ctxOf(f.admin, A), "m1", 2, unit.sha)).toBeNull();
    expect(f.downloads).toEqual([]);
  });
  it("a record pointing outside the learner's folder is never followed", async () => {
    const f = fake();
    f.rows.set("m1", { material_id: "m1", user_id: A, status: "done", attempts: 1, claimed_at: "x", units: [{ ...unit, path: `${B}/render-m1-1-abcdefabcdefabcd.webp` }], not_drawn: [] });
    expect(await readDrawnSlide(ctxOf(f.admin, A), "m1", 1, unit.sha)).toBeNull();
    expect(f.downloads).toEqual([]);
  });
});

describe("when a job stops working", () => {
  it("a stalled engine is started once more, and the job finishes", async () => {
    const { RenderError } = await import("./slide-render-engine");
    const f = fake();
    h.pdf.mockRejectedValueOnce(new RenderError("stalled"));
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect(h.pdf).toHaveBeenCalledTimes(2);
    expect(f.rows.get("m1")).toMatchObject({ status: "done", reason: null });
  });
  it("low memory gets the same one more start", async () => {
    const { RenderError } = await import("./slide-render-engine");
    const f = fake();
    h.pdf.mockRejectedValueOnce(new RenderError("memory_low"));
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect(h.pdf).toHaveBeenCalledTimes(2);
    expect(f.rows.get("m1")).toMatchObject({ status: "done" });
  });
  it("stalling twice stops: the row says why, and the engine is free", async () => {
    const { RenderError } = await import("./slide-render-engine");
    const f = fake();
    h.pdf.mockRejectedValue(new RenderError("stalled"));
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect(h.pdf).toHaveBeenCalledTimes(2);
    expect(f.rows.get("m1")).toMatchObject({ status: "failed", reason: "stalled" });
    expect(h.busy).toBe(false);
  });
  it("a file the engine cannot read is not tried again: it would fail again", async () => {
    const { RenderError } = await import("./slide-render-engine");
    const f = fake();
    h.pdf.mockRejectedValue(new RenderError("engine_failed"));
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect(h.pdf).toHaveBeenCalledTimes(1);
  });
  it("too little of the budget left: no second start", async () => {
    const { RenderError } = await import("./slide-render-engine");
    const f = fake();
    const { run } = await startWholeSlides(ctxOf(f.admin, A), "m1");
    const real = Date.now();
    const clock = vi.spyOn(Date, "now");
    h.pdf.mockImplementation(async () => { clock.mockReturnValue(real + 230_000); throw new RenderError("stalled"); });
    await run!();
    clock.mockRestore();
    expect(h.pdf).toHaveBeenCalledTimes(1);
    expect(f.rows.get("m1")).toMatchObject({ status: "failed", reason: "stalled" });
  });
  it("each slide is on record as soon as it is stored", async () => {
    const f = fake();
    await threeSlides();
    const seen: number[] = [];
    const { run } = await startWholeSlides(ctxOf(f.admin, A), "m1");
    h.webp.mockImplementation(async (page: number) => { seen.push((f.rows.get("m1")!.units as unknown[]).length); return { bytes: new Uint8Array([page]), width: 1, height: 1, blank: false }; });
    await run!();
    expect(seen).toEqual([0, 1, 2]);
  });
  it("a slide failing keeps the slides already drawn, on record and in storage", async () => {
    const f = fake();
    await threeSlides();
    h.webp.mockImplementationOnce(async () => ({ bytes: new Uint8Array([1]), width: 1, height: 1, blank: false })).mockRejectedValueOnce(new Error("canvas"));
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    const row = f.rows.get("m1")!;
    expect(row).toMatchObject({ status: "failed", reason: "engine_failed" });
    expect((row.units as { n: number }[]).map(u => u.n)).toEqual([1]);
    expect(f.stored.size).toBe(1);
  });
  it("a job that failed before drawing keeps what an earlier job drew", async () => {
    const { RenderError } = await import("./slide-render-engine");
    const f = fake();
    await threeSlides();
    f.rows.set("m1", { material_id: "m1", user_id: A, status: "failed", attempts: 1, claimed_at: stale(), units: [unitOf(1)], not_drawn: [] });
    h.pdf.mockRejectedValue(new RenderError("engine_failed"));
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect((f.rows.get("m1")!.units as { n: number }[]).map(u => u.n)).toEqual([1]);
  });
  it("an image stored but not recorded goes: nothing could ever show or erase it", async () => {
    const f = fake();
    const failing = { ...f.admin, from: () => ({ ...f.admin.from(), update: () => { const q = { eq: () => q, select: async () => ({ data: null, error: { message: "write failed" } }) }; return q; } }) };
    await (await startWholeSlides(ctxOf(failing, A), "m1")).run!();
    expect(f.stored.size).toBe(0);
    expect(f.removed).toHaveLength(1);
  });
});

describe("a retry after a job that died", () => {
  const died = (f: ReturnType<typeof fake>, units: unknown[], attempts = 1) => f.rows.set("m1", { material_id: "m1", user_id: A, status: "running", attempts, claimed_at: stale(), units, not_drawn: [] });
  it("draws only what is left, and makes no second record of a slide", async () => {
    const f = fake();
    await threeSlides();
    died(f, [unitOf(1), unitOf(2)]);
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    const row = f.rows.get("m1")!;
    expect(row).toMatchObject({ status: "done", attempts: 2 });
    expect((row.units as { n: number }[]).map(u => u.n)).toEqual([1, 2, 3]);
    expect(h.webp).toHaveBeenCalledTimes(1);
    expect(h.webp).toHaveBeenCalledWith(3);
  });
  it("with everything already drawn, no engine starts", async () => {
    const f = fake();
    await threeSlides();
    died(f, [unitOf(1), unitOf(2), unitOf(3)]);
    await (await startWholeSlides(ctxOf(f.admin, A), "m1")).run!();
    expect(h.pdf).not.toHaveBeenCalled();
    expect(h.webp).not.toHaveBeenCalled();
    expect(f.rows.get("m1")).toMatchObject({ status: "done", attempts: 2 });
  });
  it("stops at the limit: the slides drawn stay, and nothing more starts", async () => {
    const f = fake();
    await threeSlides();
    died(f, [unitOf(1)], 3);
    const r = await startWholeSlides(ctxOf(f.admin, A), "m1");
    expect(r.run).toBeUndefined();
    expect(r.out.body).toEqual({ state: "finished" });
    expect((f.rows.get("m1")!.units as unknown[]).length).toBe(1);
  });
  it("a job that outlived its row's attempt cannot write over the retry", async () => {
    const f = fake();
    await threeSlides();
    const late = await startWholeSlides(ctxOf(f.admin, A), "m1");
    f.rows.get("m1")!.attempts = 2;
    await late.run!();
    expect(f.rows.get("m1")).toMatchObject({ status: "running", units: [] });
    expect(f.stored.size).toBe(0);
  });
});

describe("how many jobs run at once", () => {
  const running = (f: ReturnType<typeof fake>, id: string, user: string, at = new Date(Date.now() - 1000).toISOString()) => f.rows.set(id, { material_id: id, user_id: user, status: "running", attempts: 1, claimed_at: at, units: [], not_drawn: [] });
  it("a learner's second file waits, and spends no claim", async () => {
    const f = fake();
    running(f, "m9", A);
    const r = await startWholeSlides(ctxOf(f.admin, A), "m1");
    expect(r.out.body).toEqual({ state: "busy" });
    expect(r.run).toBeUndefined();
    expect(f.rows.has("m1")).toBe(false);
    expect(h.busy).toBe(false);
  });
  it("another learner waits at the platform's limit, and goes under it", async () => {
    const f = fake();
    running(f, "m9", B);
    h.policy.scholarWholeSlidesConcurrent = 1;
    expect((await startWholeSlides(ctxOf(f.admin, A), "m1")).out.body).toEqual({ state: "busy" });
    expect(f.rows.has("m1")).toBe(false);
    h.policy.scholarWholeSlidesConcurrent = 2;
    expect((await startWholeSlides(ctxOf(f.admin, A), "m1")).out.status).toBe(202);
  });
  it("a job that died holds no place", async () => {
    const f = fake();
    running(f, "m9", A, stale());
    expect((await startWholeSlides(ctxOf(f.admin, A), "m1")).out.status).toBe(202);
  });
  it("two racing past the first count: the later gives its claim back", async () => {
    const f = fake();
    h.policy.scholarWholeSlidesConcurrent = 1;
    let reads = 0;
    f.jobs.onCount = () => { if (++reads === 2) running(f, "m9", B, new Date(Date.now() - 60_000).toISOString()); };
    const r = await startWholeSlides(ctxOf(f.admin, A), "m1");
    expect(r.out.body).toEqual({ state: "busy" });
    expect(f.rows.has("m1")).toBe(false);
    expect(h.busy).toBe(false);
  });
  it("giving back a retry's claim returns its attempt and keeps its slides", async () => {
    const f = fake();
    const when = stale();
    f.rows.set("m1", { material_id: "m1", user_id: A, status: "failed", attempts: 1, claimed_at: when, finished_at: when, reason: "stalled", units: [unitOf(1)], not_drawn: [] });
    h.policy.scholarWholeSlidesConcurrent = 1;
    let reads = 0;
    f.jobs.onCount = () => { if (++reads === 2) running(f, "m9", B, new Date(Date.now() - 400_000 + 60_000).toISOString()); };
    const r = await startWholeSlides(ctxOf(f.admin, A), "m1");
    expect(r.out.body).toEqual({ state: "busy" });
    expect(f.rows.get("m1")).toMatchObject({ status: "failed", attempts: 1, reason: "stalled" });
    expect((f.rows.get("m1")!.units as unknown[]).length).toBe(1);
  });
  it("the count unreadable: nothing starts", async () => {
    const f = fake();
    f.jobs.failing = true;
    const r = await startWholeSlides(ctxOf(f.admin, A), "m1");
    expect(r.out.body).toEqual({ state: "busy" });
    expect(f.rows.size).toBe(0);
  });
});
