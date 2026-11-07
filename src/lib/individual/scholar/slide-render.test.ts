import { describe, expect, it } from "vitest";
import { addCpuSample, admission, aliasFonts, claimDecision, cpuStalled, layoutMatters, mergeUnits, renderPath, renderRowOf, renderTestHook, pdfPagesToDraw, renderState, RENDER_MAX_ATTEMPTS, RENDER_STALE_MS, RENDER_STALL_WINDOW_MS, slidePageMap, slidesToDraw } from "./slide-render";
import { parseVisualKey, preferWhole, wholeSlideVisual, type Visual } from "./material-visuals";
import type { DeckScan } from "./material-visuals";
import type { SlideFacts } from "./slide-classify";

const presentation = (ids: string[]) => `<p:presentation><p:sldIdLst>${ids.map((id, i) => `<p:sldId id="${256 + i}" r:id="${id}"/>`).join("")}</p:sldIdLst></p:presentation>`;
const rels = (pairs: [string, string][]) => `<Relationships>${pairs.map(([id, t]) => `<Relationship Id="${id}" Type="x/slide" Target="${t}"/>`).join("")}<Relationship Id="rId99" Type="x/theme" Target="theme/theme1.xml"/></Relationships>`;
const parts = ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"];

describe("which page of the drawing is which slide", () => {
  it("a slide moved in PowerPoint keeps its own number and its own page", () => {
    // In the deck the third part comes first, so slide 3 is page 1.
    const map = slidePageMap(presentation(["rId3", "rId1", "rId2"]), rels([["rId1", "slides/slide1.xml"], ["rId2", "slides/slide2.xml"], ["rId3", "slides/slide3.xml"]]), parts);
    expect(map && [...map.entries()].sort((a, b) => a[0] - b[0])).toEqual([[1, 2], [2, 3], [3, 1]]);
  });
  it("a part the deck does not list has no page", () => {
    const map = slidePageMap(presentation(["rId1", "rId2"]), rels([["rId1", "slides/slide1.xml"], ["rId2", "slides/slide2.xml"]]), parts);
    expect(map?.has(3)).toBe(false);
    expect(map?.size).toBe(2);
  });
  it("an absolute target is understood", () => {
    expect(slidePageMap(presentation(["rId1"]), rels([["rId1", "/ppt/slides/slide2.xml"]]), parts)?.get(2)).toBe(1);
  });
  it("draws nothing when the order cannot be trusted: never a picture under the wrong slide", () => {
    expect(slidePageMap("<p:presentation/>", rels([]), parts)).toBeNull();
    expect(slidePageMap(presentation(["rId7"]), rels([["rId1", "slides/slide1.xml"]]), parts)).toBeNull();
    expect(slidePageMap(presentation(["rId1"]), rels([["rId1", "slides/slide9.xml"]]), parts)).toBeNull();
    expect(slidePageMap(presentation(["rId1", "rId2"]), rels([["rId1", "slides/slide1.xml"], ["rId2", "slides/slide1.xml"]]), parts)).toBeNull();
  });
});

describe("whether a slide's arrangement carries meaning", () => {
  const box = `<p:sp><p:nvSpPr/><p:spPr><a:prstGeom prst="rect"/></p:spPr></p:sp>`;
  const textBox = `<p:sp><p:nvSpPr><p:cNvSpPr txBox="1"/></p:nvSpPr><p:spPr><a:prstGeom prst="rect"/></p:spPr></p:sp>`;
  const placeholder = `<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:prstGeom prst="rect"/></p:spPr></p:sp>`;
  it("a table, a connector or two drawn shapes do", () => {
    expect(layoutMatters(`<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"></a:graphicData>`)).toBe(true);
    expect(layoutMatters("<p:cxnSp></p:cxnSp>")).toBe(true);
    expect(layoutMatters(box + box)).toBe(true);
  });
  it("plain text in placeholders and text boxes, or one lone shape, does not", () => {
    expect(layoutMatters(placeholder + placeholder + textBox + textBox)).toBe(false);
    expect(layoutMatters(box)).toBe(false);
  });
});

describe("which slides are drawn", () => {
  const facts: SlideFacts = { version: 1, checkedAt: "x", blank: [9], mixed: [3], grouped: [4], decorativeOnly: [8], review: [{ unit: 5, kinds: ["chart"], picture: false }] };
  const photo = { media: "ppt/media/a.png", kind: "png" as const, width: 800, height: 600, bytes: 90_000, sha: "0123456789abcdef" };
  const scan: DeckScan = { slides: 12, pictures: [{ n: 2, ...photo }, { n: 3, ...photo, media: "ppt/media/b.png", sha: "1123456789abcdef" }], undisplayable: [{ n: 6, media: "ppt/media/d.emf" }] };
  const pages = new Map(Array.from({ length: 12 }, (_, i) => [i + 1, i + 1] as [number, number]));
  it("a picture, a mix, a group, a chart, a browser-unfriendly picture and a table are; plain text and blanks are not", () => {
    const { draw, notDrawn } = slidesToDraw({ scan, facts, layout: new Set([7]), pages, minPx: 120, max: 80 });
    expect(draw).toEqual([2, 3, 4, 5, 6, 7]);
    expect(notDrawn).toEqual([]);
  });
  it("a logo on most slides does not make them worth drawing", () => {
    const logo = { slides: 4, pictures: [], undisplayable: [1, 2, 3, 4].map(n => ({ n, media: "ppt/media/logo.emf" })) };
    expect(slidesToDraw({ scan: logo, facts: undefined, layout: new Set(), pages, minPx: 120, max: 80 }).draw).toEqual([]);
  });
  it("a blank slide is never drawn, even if something else named it", () => {
    expect(slidesToDraw({ scan, facts, layout: new Set([9, 8]), pages, minPx: 120, max: 80 }).draw).not.toContain(9);
  });
  it("a logo-only slide is not drawn, unless it also holds a chart or a drawn layout", () => {
    const withChart: SlideFacts = { ...facts, decorativeOnly: [5, 8] };
    expect(slidesToDraw({ scan, facts: withChart, layout: new Set(), pages, minPx: 120, max: 80 }).draw).toContain(5);
    expect(slidesToDraw({ scan, facts: withChart, layout: new Set(), pages, minPx: 120, max: 80 }).draw).not.toContain(8);
    expect(slidesToDraw({ scan, facts: withChart, layout: new Set([8]), pages, minPx: 120, max: 80 }).draw).toContain(8);
  });
  it("a slide the deck does not list is not drawn", () => {
    expect(slidesToDraw({ scan, facts, layout: new Set(), pages: new Map([[2, 1]]), minPx: 120, max: 80 }).draw).toEqual([2]);
  });
  it("over the cap: first come first, the rest named", () => {
    const { draw, notDrawn } = slidesToDraw({ scan, facts, layout: new Set(), pages, minPx: 120, max: 2 });
    expect(draw).toEqual([2, 3]);
    expect(notDrawn).toEqual([4, 5, 6]);
  });
});

describe("at most once", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("no row: claim. Finished: never again", () => {
    expect(claimDecision(null, now)).toBe("claim");
    expect(claimDecision({ status: "done", attempts: 1, claimedAt: ago(RENDER_STALE_MS * 100) }, now)).toBe("finished");
    expect(claimDecision({ status: "partial", attempts: 1, claimedAt: ago(RENDER_STALE_MS * 100) }, now)).toBe("finished");
  });
  it("running is left alone until it is clearly dead, then one more try", () => {
    expect(claimDecision({ status: "running", attempts: 1, claimedAt: ago(1000) }, now)).toBe("running");
    expect(claimDecision({ status: "running", attempts: 1, claimedAt: ago(RENDER_STALE_MS) }, now)).toBe("reclaim");
    expect(claimDecision({ status: "failed", attempts: 1, claimedAt: ago(RENDER_STALE_MS) }, now)).toBe("reclaim");
    expect(claimDecision({ status: "failed", attempts: 1, claimedAt: ago(1000) }, now)).toBe("finished");
  });
  it("attempts are capped, whatever state it died in", () => {
    expect(claimDecision({ status: "failed", attempts: RENDER_MAX_ATTEMPTS, claimedAt: ago(RENDER_STALE_MS * 100) }, now)).toBe("finished");
    expect(claimDecision({ status: "running", attempts: RENDER_MAX_ATTEMPTS, claimedAt: ago(RENDER_STALE_MS * 100) }, now)).toBe("finished");
    expect(claimDecision({ status: "running", attempts: RENDER_MAX_ATTEMPTS, claimedAt: ago(1000) }, now)).toBe("running");
  });
  it("the page is told the same", () => {
    expect(renderState(false, null, now)).toBe("off");
    expect(renderState(true, null, now)).toBe("not_started");
    expect(renderState(true, { status: "running", attempts: 1, claimedAt: ago(1000) }, now)).toBe("running");
    expect(renderState(true, { status: "done", attempts: 1, claimedAt: ago(1000) }, now)).toBe("finished");
  });
});

describe("fonts in the working copy", () => {
  it("names metric-compatible equivalents, and leaves other fonts and other attributes alone", () => {
    expect(aliasFonts(`<a:latin typeface="Cambria Math"/><a:cs typeface="Calibri"/><a:ea typeface="Agency FB"/><x y="Arial"/>`))
      .toBe(`<a:latin typeface="Caladea"/><a:cs typeface="Carlito"/><a:ea typeface="Agency FB"/><x y="Arial"/>`);
  });
});

describe("the stored record", () => {
  const u = "11111111-1111-4111-8111-111111111111", m = "22222222-2222-4222-8222-222222222222";
  it("an image is stored flat under the learner's own folder", () => {
    expect(renderPath(u, m, 35, "abcdefabcdefabcd")).toBe(`${u}/render-${m}-35-abcdefabcdefabcd.webp`);
  });
  it("malformed units are left out rather than shown", () => {
    const row = renderRowOf({ material_id: m, user_id: u, status: "done", attempts: 1, claimed_at: "x", units: [
      { n: 1, path: "p", sha: "abcdefabcdefabcd", width: 1920, height: 1080, bytes: 5 },
      { n: "1", path: "p", sha: "abcdefabcdefabcd", width: 1920, height: 1080 },
      { n: 2, path: "p", sha: "../..", width: 1920, height: 1080 },
      null,
    ], not_drawn: [4, "x"] });
    expect(row?.units.map(x => x.n)).toEqual([1]);
    expect(row?.notDrawn).toEqual([4]);
    expect(renderRowOf(null)).toBeNull();
  });
});

describe("a drawn slide among the pictures", () => {
  const unit = { n: 35, sha: "abcdefabcdefabcd", width: 1920, height: 1080, bytes: 1000 };
  const pictureOf = (n: number) => ({ n, key: [n, "0".repeat(16)].join("-"), whole: undefined }) as unknown as Visual;
  const picture = pictureOf(35), other = pictureOf(36);
  it("has its own key, never confused with a picture's", () => {
    const v = wholeSlideVisual(unit);
    expect(v).toMatchObject({ key: "w35-abcdefabcdefabcd", whole: true, media: null, kind: "webp", unit: "slide", n: 35 });
    expect(parseVisualKey(v.key)).toEqual({ kind: "whole", n: 35, sha: "abcdefabcdefabcd" });
    expect(parseVisualKey("w35-../etc")).toBeNull();
    expect(parseVisualKey("w0-abcdefabcdefabcd")).toBeNull();
  });
  it("says it is the whole slide, not an original picture", () => {
    expect(wholeSlideVisual(unit).caption).toBe("Slide 35 · the whole slide from your presentation");
  });
  it("stands for that slide's pictures in the notes, and leaves other slides' pictures", () => {
    const v = wholeSlideVisual(unit);
    expect(preferWhole([v, picture, other]).map(x => x.key)).toEqual([v.key, other.key]);
    expect(preferWhole([picture, other]).map(x => x.key)).toEqual([picture.key, other.key]);
  });
});

describe("which pages of a PDF are drawn", () => {
  const v = (n: number, kind: "png" | "jpeg" | "pdf_page") => ({ n, kind });
  it("a page the browser cannot be handed, and an empty page", () => {
    expect(pdfPagesToDraw({ visuals: [v(3, "pdf_page"), v(7, "pdf_page")], textless: [3, 7], max: 80 }).draw).toEqual([3, 7]);
  });
  it("a text page whose picture the browser cannot be handed", () => {
    expect(pdfPagesToDraw({ visuals: [v(6, "pdf_page")], textless: [], max: 80 }).draw).toEqual([6]);
  });
  it("a page with no text layer and two or more pictures: its layout is its meaning", () => {
    expect(pdfPagesToDraw({ visuals: [v(5, "jpeg"), v(5, "png")], textless: [5], max: 80 }).draw).toEqual([5]);
  });
  it("one ordinary picture, or pictures on a page with text, are already shown: not drawn", () => {
    expect(pdfPagesToDraw({ visuals: [v(2, "jpeg")], textless: [2], max: 80 }).draw).toEqual([]);
    expect(pdfPagesToDraw({ visuals: [v(4, "jpeg"), v(4, "png")], textless: [], max: 80 }).draw).toEqual([]);
  });
  it("over the cap: first come first, the rest named", () => {
    expect(pdfPagesToDraw({ visuals: [v(1, "pdf_page"), v(2, "pdf_page"), v(3, "pdf_page")], textless: [], max: 2 })).toEqual({ draw: [1, 2], notDrawn: [3] });
  });
});

describe("a drawn PDF page", () => {
  it("says it is the whole page", () => {
    const w = wholeSlideVisual({ n: 3, sha: "abcdefabcdefabcd", width: 1920, height: 2717, bytes: 9 }, { unit: "page" });
    expect(w).toMatchObject({ unit: "page", whole: true, kind: "webp", caption: "Page 3 · the whole page from your file" });
  });
});

describe("the stall watchdog's rule", () => {
  const at = (s: number, cpuS: number) => ({ atMs: s * 1000, cpuMs: cpuS * 1000 });
  const feed = (xs: { atMs: number; cpuMs: number }[]) => xs.reduce<{ atMs: number; cpuMs: number }[]>((kept, s) => addCpuSample(kept, s), []);
  it("a job just started is never stalled, however idle", () => {
    expect(cpuStalled(feed([at(0, 0), at(10, 0), at(28, 0)]))).toBe(false);
  });
  it("a full window under the floor is stalled", () => {
    expect(cpuStalled(feed([at(0, 5), at(10, 5.5), at(20, 6), at(30, 6.5)]))).toBe(true);
  });
  it("slow but working is not stalled: a large deck may take minutes", () => {
    const xs = Array.from({ length: 100 }, (_, i) => at(i * 2, i * 0.4));
    expect(cpuStalled(feed(xs))).toBe(false);
  });
  it("a stall after a busy start is seen, whatever was used before it", () => {
    const busy = Array.from({ length: 11 }, (_, i) => at(i * 2, i * 2));
    const idle = Array.from({ length: 17 }, (_, i) => at(22 + i * 2, 20));
    expect(cpuStalled(feed([...busy, ...idle]))).toBe(true);
  });
  it("working again before the window ends is not a stall", () => {
    expect(cpuStalled(feed([at(0, 5), at(20, 5), at(30, 12)]))).toBe(false);
  });
  it("a process ending makes the count start again, not a false stall", () => {
    const kept = addCpuSample(feed([at(0, 50), at(30, 90)]), at(32, 2));
    expect(kept).toEqual([at(32, 2)]);
    expect(cpuStalled(kept)).toBe(false);
  });
  it("keeps a bounded number of samples", () => {
    const xs = Array.from({ length: 200 }, (_, i) => at(i * 2, i * 2));
    expect(feed(xs).length).toBeLessThan(RENDER_STALL_WINDOW_MS / 2000 + 3);
  });
});

describe("how many jobs run at once", () => {
  const job = (materialId: string, userId: string, claimedAt: string) => ({ materialId, userId, claimedAt });
  it("one job per learner", () => {
    const jobs = [job("m1", "a", "2026-01-01T00:00:00.000Z"), job("m2", "a", "2026-01-01T00:00:01.000Z")];
    expect(admission(jobs, { materialId: "m1", userId: "a" }, 5)).toBe("go");
    expect(admission(jobs, { materialId: "m2", userId: "a" }, 5)).toBe("learner");
  });
  it("no more than the platform's limit, oldest first", () => {
    const jobs = [job("m1", "a", "2026-01-01T00:00:00.000Z"), job("m2", "b", "2026-01-01T00:00:01.000Z"), job("m3", "c", "2026-01-01T00:00:02.000Z")];
    expect(admission(jobs, { materialId: "m2", userId: "b" }, 2)).toBe("go");
    expect(admission(jobs, { materialId: "m3", userId: "c" }, 2)).toBe("platform");
  });
  it("two claimed in the same millisecond agree on who goes", () => {
    const same = "2026-01-01T00:00:00.000Z";
    const jobs = [job("m9", "b", same), job("m1", "a", same)];
    expect(admission(jobs, { materialId: "m1", userId: "a" }, 1)).toBe("go");
    expect(admission([...jobs].reverse(), { materialId: "m9", userId: "b" }, 1)).toBe("platform");
  });
  it("a limit below one still lets one run", () => {
    expect(admission([job("m1", "a", "x")], { materialId: "m1", userId: "a" }, 0)).toBe("go");
  });
});

describe("what a retry keeps", () => {
  const unit = (n: number, sha: string) => ({ n, sha, path: `u/render-m-${n}-${sha}.webp`, width: 1, height: 1, bytes: 1 });
  it("one record per slide, in slide order, the later drawing winning", () => {
    expect(mergeUnits([unit(3, "a"), unit(1, "a")], [unit(1, "b"), unit(2, "a")]).map(u => `${u.n}${u.sha}`)).toEqual(["1b", "2a", "3a"]);
  });
  it("attempts stay inside what the table allows", () => {
    expect(RENDER_MAX_ATTEMPTS).toBeLessThanOrEqual(3);
  });
  it("a row is only called dead once no function can still be running it", () => {
    expect(RENDER_STALE_MS).toBeGreaterThan(300_000);
  });
});

describe("the forced stall and kill", () => {
  const on = { VERCEL_ENV: "preview", SCHOLAR_RENDER_TEST_HOOKS: "1" };
  it("works only on a preview that asked for it", () => {
    expect(renderTestHook("x render-test-stall-2 render-test-kill-3.pptx", on)).toEqual({ stallTries: 2, killAfterSlides: 3 });
    expect(renderTestHook("x.pptx", on)).toEqual({ stallTries: 0, killAfterSlides: 0 });
  });
  it("can never run in production, or anywhere else", () => {
    const name = "render-test-kill-3.pptx";
    expect(renderTestHook(name, { VERCEL_ENV: "production", SCHOLAR_RENDER_TEST_HOOKS: "1" })).toBeNull();
    expect(renderTestHook(name, { SCHOLAR_RENDER_TEST_HOOKS: "1" })).toBeNull();
    expect(renderTestHook(name, { VERCEL_ENV: "preview" })).toBeNull();
    expect(renderTestHook(name, {})).toBeNull();
  });
});
