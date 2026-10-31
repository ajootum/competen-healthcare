import { describe, expect, it } from "vitest";
import { DIAGRAM_FORMAT_GUIDE, inlineSegments, parseAnswer, parseFlow, parseMap, parsePractice, parseTimeline, splitNotCovered } from "./answer-format";

const fence = (json: string) => "```practice\n" + json + "\n```";
const goodMcq = { stem: "Which?", options: ["a", "b", "c"], answer: 1, explanation: "Because." };

describe("blocks", () => {
  it("headings, paragraphs, lists, numbered lists", () => {
    const { blocks } = parseAnswer("## Title\n\n### Sub\n\nFirst line\nsecond line\n\n- one\n* two\n  wrapped\n\n1. a\n2) b");
    expect(blocks).toEqual([
      { type: "heading", level: 2, text: "Title" },
      { type: "heading", level: 3, text: "Sub" },
      { type: "paragraph", text: "First line second line" },
      { type: "list", ordered: false, items: ["one", "two wrapped"] },
      { type: "list", ordered: true, items: ["a", "b"] },
    ]);
  });
  it("single # and #### are plain text", () => {
    const { blocks } = parseAnswer("# One\n\n#### Four");
    expect(blocks.every(b => b.type === "paragraph")).toBe(true);
  });
  it("table with ragged rows is padded or cut to the header width", () => {
    const { blocks } = parseAnswer("| A | B |\n|---|:-:|\n| 1 |\n| 1 | 2 | 3 |\n| x \\| y | z |");
    expect(blocks).toEqual([{ type: "table", header: ["A", "B"], rows: [["1", ""], ["1", "2"], ["x | y", "z"]] }]);
  });
  it.each(["caution", "key", "summary", "memory", "example", "record", "background"] as const)("callout %s", kind => {
    const { blocks } = parseAnswer(`> [!${kind.toUpperCase()}]\n> line one\n> line two\n\nAfter`);
    expect(blocks[0]).toEqual({ type: "callout", kind, lines: ["line one", "line two"] });
    expect(blocks[1]).toEqual({ type: "paragraph", text: "After" });
  });
  it("callout marker is case-insensitive", () => {
    expect(parseAnswer("> [!Caution]\n> x").blocks[0]).toMatchObject({ type: "callout", kind: "caution" });
  });
  it("plain > quote is a paragraph", () => {
    expect(parseAnswer("> just a quote").blocks).toEqual([{ type: "paragraph", text: "just a quote" }]);
  });
  it("raw html stays literal text", () => {
    const { blocks } = parseAnswer("<script>alert(1)</script> and ![i](x)");
    expect(blocks[0]).toEqual({ type: "paragraph", text: "<script>alert(1)</script> and ![i](x)" });
  });
  it("other code fences are plain text", () => {
    const { blocks } = parseAnswer("```js\n## not a heading\n```");
    expect(blocks).toEqual([{ type: "paragraph", text: "## not a heading" }]);
  });
});

describe("practice", () => {
  it("valid fence after blocks", () => {
    const r = parseAnswer("## T\n\n" + fence(JSON.stringify({ flashcard: { front: " f ", back: "b" }, mcq: goodMcq })));
    expect(r.practicePending).toBe(false);
    expect(r.practice).toEqual({ flashcard: { front: "f", back: "b" }, mcq: goodMcq });
    expect(r.blocks).toHaveLength(1);
  });
  it("invalid JSON gives null and shows nothing", () => {
    const r = parseAnswer("text\n\n" + fence("{nope"));
    expect(r.practice).toBeNull();
    expect(r.blocks).toEqual([{ type: "paragraph", text: "text" }]);
  });
  it("missing parts are fine, nothing valid is null", () => {
    expect(parsePractice(JSON.stringify({ flashcard: { front: "f", back: "b" } }))).toEqual({ flashcard: { front: "f", back: "b" } });
    expect(parsePractice(JSON.stringify({ flashcard: { front: "f" } }))).toBeNull();
    expect(parsePractice("[]")).toBeNull();
  });
  it("bad mcq answer index or option count drops the mcq only", () => {
    const keep = { flashcard: { front: "f", back: "b" } };
    for (const bad of [{ ...goodMcq, answer: 3 }, { ...goodMcq, answer: -1 }, { ...goodMcq, answer: 1.5 }, { ...goodMcq, answer: "1" }, { ...goodMcq, options: ["a", "b"] }, { ...goodMcq, options: ["a", "b", "c", "d", "e", "f"] }, { ...goodMcq, options: ["a", "", "c"] }]) {
      expect(parsePractice(JSON.stringify({ ...keep, mcq: bad }))).toEqual(keep);
    }
  });
  it("accepts snake_case model_answer", () => {
    expect(parsePractice(JSON.stringify({ reasoning: { scenario: "s", question: "q", model_answer: "m" } }))?.reasoning).toEqual({ scenario: "s", question: "q", modelAnswer: "m" });
  });
  it("trims over-length strings to the caps", () => {
    const p = parsePractice(JSON.stringify({ flashcard: { front: "f".repeat(400), back: "b".repeat(700) } }))!;
    expect(p.flashcard!.front).toHaveLength(300);
    expect(p.flashcard!.back).toHaveLength(600);
  });
});

describe("streaming", () => {
  it("open practice fence is pending and hidden", () => {
    const r = parseAnswer("## T\n\n```practice\n{\"flashcard\": {\"fr", { streaming: true });
    expect(r.practicePending).toBe(true);
    expect(r.practice).toBeNull();
    expect(r.blocks).toEqual([{ type: "heading", level: 2, text: "T" }]);
  });
  it("a half-written fence marker is hidden", () => {
    expect(parseAnswer("Hello\n\n```prac", { streaming: true }).blocks).toEqual([{ type: "paragraph", text: "Hello" }]);
  });
  it("half table row dropped, complete rows kept", () => {
    const r = parseAnswer("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | ", { streaming: true });
    expect(r.blocks).toEqual([{ type: "table", header: ["A", "B"], rows: [["1", "2"]] }]);
  });
  it("header alone or half separator is not shown as pipe text", () => {
    expect(parseAnswer("Intro\n\n| A | B |", { streaming: true }).blocks).toEqual([{ type: "paragraph", text: "Intro" }]);
    expect(parseAnswer("| A | B |\n|---|--", { streaming: true }).blocks).toEqual([]);
  });
  it("unterminated bold stays text and never throws", () => {
    const r = parseAnswer("This is **half", { streaming: true });
    expect(r.blocks).toEqual([{ type: "paragraph", text: "This is **half" }]);
    expect(inlineSegments("This is **half")).toEqual([{ t: "text", v: "This is **half" }]);
  });
  it("never throws on any prefix of a full answer", () => {
    const full = "## T\n\n- **a** [S1]\n\n> [!KEY]\n> x\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n" + fence(JSON.stringify({ mcq: goodMcq }));
    for (let i = 0; i <= full.length; i++) expect(() => parseAnswer(full.slice(0, i), { streaming: true })).not.toThrow();
  });
});

describe("inline", () => {
  it("bold and the three citation kinds", () => {
    expect(inlineSegments("A **b** [S1] c [R2] d [E3].")).toEqual([
      { t: "text", v: "A " }, { t: "bold", v: "b" }, { t: "text", v: " " }, { t: "cite", v: "1", tag: "S" },
      { t: "text", v: " c " }, { t: "cite", v: "2", tag: "R" }, { t: "text", v: " d " }, { t: "cite", v: "3", tag: "E" }, { t: "text", v: "." },
    ]);
  });
  it("a citation inside bold stays a chip", () => {
    expect(inlineSegments("**x [S2]**")).toEqual([{ t: "bold", v: "x " }, { t: "cite", v: "2", tag: "S" }]);
  });
  it("unknown tags are text", () => {
    expect(inlineSegments("[X1] [S]")).toEqual([{ t: "text", v: "[X1] [S]" }]);
  });
});

describe("diagrams", () => {
  const dfence = (kind: string, o: unknown) => "```" + kind + "\n" + (typeof o === "string" ? o : JSON.stringify(o)) + "\n```";
  const goodFlow = {
    title: " Sepsis bundle ", direction: "right",
    nodes: [{ id: "a", label: "Suspect  sepsis", kind: "start" }, { id: "B", label: "Lactate high?", kind: "decision" }, { id: "c", label: "Fluids" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c", label: "yes" }],
  };
  const goodMap = {
    title: "Web", center: "Asthma",
    nodes: [{ id: "x", label: "Allergen", group: "cause" }, { id: "y", label: "Wheeze", group: "weird" }],
    edges: [{ from: "x", to: "center", label: "triggers" }, { from: "center", to: "y" }],
  };
  const goodTimeline = { title: "Course", events: [{ at: "0-6 h", label: "Onset" }, { at: "6-24 h", label: "Peak" }] };

  it("a flow fence becomes a flow block between the surrounding blocks", () => {
    const { blocks } = parseAnswer("Before\n\n" + dfence("flow", goodFlow) + "\n\nAfter");
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toEqual({
      type: "flow", title: "Sepsis bundle", direction: "right",
      nodes: [{ id: "a", label: "Suspect sepsis", kind: "start" }, { id: "b", label: "Lactate high?", kind: "decision" }, { id: "c", label: "Fluids", kind: "step" }],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c", label: "yes" }],
    });
    expect(blocks[2]).toEqual({ type: "paragraph", text: "After" });
  });
  it("map and timeline blocks", () => {
    const m = parseAnswer(dfence("map", goodMap)).blocks[0];
    expect(m).toEqual({
      type: "map", title: "Web", center: "Asthma",
      nodes: [{ id: "x", label: "Allergen", group: "cause" }, { id: "y", label: "Wheeze", group: "other" }],
      edges: [{ from: "x", to: "center", label: "triggers" }, { from: "center", to: "y" }],
    });
    expect(parseAnswer(dfence("timeline", goodTimeline)).blocks[0]).toEqual({ type: "timeline", ...goodTimeline });
  });
  it("a fence label is case-insensitive and a missing title or direction gets a default", () => {
    const b = parseAnswer(dfence("FLOW", { nodes: goodFlow.nodes, edges: goodFlow.edges })).blocks[0];
    expect(b).toMatchObject({ type: "flow", title: "Process", direction: "down" });
  });
  it("invalid JSON or empty content omits the block silently", () => {
    for (const body of ["{nope", "[]", "{}", { nodes: [], edges: [] }, { nodes: goodFlow.nodes, edges: [] }, { nodes: [goodFlow.nodes[0]], edges: [{ from: "a", to: "a" }] }]) {
      expect(parseAnswer("T\n\n" + dfence("flow", body)).blocks).toEqual([{ type: "paragraph", text: "T" }]);
    }
    expect(parseAnswer(dfence("map", { center: "", nodes: goodMap.nodes, edges: goodMap.edges })).blocks).toEqual([]);
    expect(parseAnswer(dfence("timeline", { events: [{ at: "1", label: "only one" }] })).blocks).toEqual([]);
    expect(parseAnswer(dfence("timeline", { events: [{ at: "", label: "x" }, { label: "y" }] })).blocks).toEqual([]);
  });
  it("drops invalid edges, bad ids, duplicate ids and repeated edges", () => {
    const d = parseFlow(JSON.stringify({
      nodes: [{ id: "a", label: "A" }, { id: "a", label: "dup" }, { id: "has space", label: "bad id" }, { id: "b", label: "B" }, { id: "c", label: "" }, { id: "d", label: "D", kind: "bogus" }],
      edges: [{ from: "a", to: "b" }, { from: "a", to: "b", label: "again" }, { from: "a", to: "zzz" }, { from: "b", to: "b" }, { from: "d", to: "a" }, { from: 7, to: "a" }, "x"],
    }))!;
    expect(d.nodes.map(n => n.id)).toEqual(["a", "b", "d"]);
    expect(d.nodes[2].kind).toBe("step");
    expect(d.edges).toEqual([{ from: "a", to: "b" }, { from: "d", to: "a" }]);
  });
  it("a map node cannot take the centre id", () => {
    const d = parseMap(JSON.stringify({ center: "C", nodes: [{ id: "center", label: "x" }, { id: "k", label: "K" }], edges: [{ from: "center", to: "k" }] }))!;
    expect(d.nodes.map(n => n.id)).toEqual(["k"]);
  });
  it("caps nodes, edges, events and label lengths", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, label: "L".repeat(120) }));
    const edges = Array.from({ length: 19 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, label: "e".repeat(50) }));
    const f = parseFlow(JSON.stringify({ title: "T".repeat(200), nodes, edges }))!;
    expect(f.nodes).toHaveLength(12);
    expect(f.edges).toHaveLength(11);
    expect(f.nodes[0].label).toHaveLength(80);
    expect(f.edges[0].label).toHaveLength(30);
    expect(f.title).toHaveLength(80);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: "x" }));
    const dense = many.flatMap((a, i) => many.slice(i + 1).map(b => ({ from: a.id, to: b.id })));
    expect(parseFlow(JSON.stringify({ nodes: many, edges: dense }))!.edges).toHaveLength(16);
    const t = parseTimeline(JSON.stringify({ events: Array.from({ length: 14 }, (_, i) => ({ at: "a".repeat(40), label: `e${i}` })) }))!;
    expect(t.events).toHaveLength(10);
    expect(t.events[0].at).toHaveLength(30);
  });
  it("at most two diagrams per answer, the rest omitted", () => {
    const text = [dfence("flow", goodFlow), dfence("map", goodMap), dfence("timeline", goodTimeline)].join("\n\n");
    expect(parseAnswer(text).blocks.map(b => b.type)).toEqual(["flow", "map"]);
  });
  it("an invalid diagram does not use up the allowance", () => {
    const text = [dfence("flow", "{bad"), dfence("map", goodMap), dfence("timeline", goodTimeline)].join("\n\n");
    expect(parseAnswer(text).blocks.map(b => b.type)).toEqual(["map", "timeline"]);
  });
  it("diagrams before and after the practice fence both count", () => {
    const text = dfence("flow", goodFlow) + "\n\n" + fence(JSON.stringify({ mcq: goodMcq })) + "\n\n" + dfence("map", goodMap);
    const r = parseAnswer(text);
    expect(r.blocks.map(b => b.type)).toEqual(["flow", "map"]);
    expect(r.practice?.mcq).toEqual(goodMcq);
  });
  it("an unclosed fence while streaming is pending and hidden; finished, it is tried", () => {
    const open = "Intro\n\n```flow\n{\"title\": \"T\", \"nodes\": [{\"id\"";
    const s = parseAnswer(open, { streaming: true });
    expect(s.diagramPending).toBe(true);
    expect(s.blocks).toEqual([{ type: "paragraph", text: "Intro" }]);
    const done = parseAnswer("```timeline\n" + JSON.stringify(goodTimeline));
    expect(done.diagramPending).toBe(false);
    expect(done.blocks[0]).toMatchObject({ type: "timeline" });
    expect(parseAnswer(dfence("flow", goodFlow), { streaming: true }).diagramPending).toBe(false);
  });
  it("raw html in labels stays a literal string", () => {
    const d = parseFlow(JSON.stringify({ nodes: [{ id: "a", label: "<img src=x onerror=1>" }, { id: "b", label: "**b**" }], edges: [{ from: "a", to: "b" }] }))!;
    expect(d.nodes[0].label).toBe("<img src=x onerror=1>");
  });
  it("never throws on any prefix of an answer with diagrams", () => {
    const full = "## T\n\n" + dfence("flow", goodFlow) + "\n\ntext\n\n" + dfence("map", goodMap) + "\n\n" + fence(JSON.stringify({ mcq: goodMcq }));
    for (let i = 0; i <= full.length; i++) expect(() => parseAnswer(full.slice(0, i), { streaming: true })).not.toThrow();
  });
  it("the prompt guide names the three blocks, the caps and the safety limits", () => {
    for (const w of ["flow", "map", "timeline", "At most one per answer", "never decorative", "12 nodes", "16 edges", "10 events", "80 characters", "never draw a care pathway for a real patient"]) expect(DIAGRAM_FORMAT_GUIDE).toContain(w);
    expect(DIAGRAM_FORMAT_GUIDE.length).toBeLessThan(2600);
  });
});

// SCHOLAR-PAI-RESEARCH-01: notes versus background, and what the notes did not cover.
describe("background callout and the NOT COVERED line", () => {
  it("the background callout keeps its own kind, apart from the notes", () => {
    const { blocks } = parseAnswer("The notes say X [S1].\n\n> [!BACKGROUND]\n> Generally, Y.\n\nMore.");
    expect(blocks.map(b => b.type)).toEqual(["paragraph", "callout", "paragraph"]);
    expect(blocks[1]).toEqual({ type: "callout", kind: "background", lines: ["Generally, Y."] });
    expect(inlineSegments("X [S1]").find(s => s.t === "cite")).toMatchObject({ tag: "S", v: "1" });
  });
  it("lifts a final NOT COVERED line out of the shown text and returns its items", () => {
    const r = parseAnswer("## Answer\n\nPart one [S1].\n\nNOT COVERED: causes; first-line treatment.");
    expect(r.notCovered).toEqual(["causes", "first-line treatment"]);
    expect(JSON.stringify(r.blocks)).not.toMatch(/NOT COVERED|first-line/);
    expect(r.blocks).toHaveLength(2);
  });
  it("is case-insensitive, deduplicated, capped, and strips tags and bold from items", () => {
    const { items } = splitNotCovered("a\nNot covered: **causes** [S2]; Causes; " + Array.from({ length: 9 }, (_, i) => "item" + i).join("; "));
    expect(items[0]).toBe("causes");
    expect(items).toHaveLength(6);
    expect(items.filter(x => x.toLowerCase() === "causes")).toHaveLength(1);
  });
  it("an answer without the line is untouched; a sentence that merely says not covered is kept", () => {
    expect(splitNotCovered("Dosing is not covered here.")).toEqual({ text: "Dosing is not covered here.", items: [] });
    expect(parseAnswer("Hello").notCovered).toEqual([]);
  });
  it("while streaming, a half-written marker never flashes, and the practice block still parses", () => {
    expect(parseAnswer("Body.\n\nNOT COV", { streaming: true }).blocks).toEqual([{ type: "paragraph", text: "Body." }]);
    expect(parseAnswer("Body.\n\nNOT COVERED: a; b", { streaming: true }).notCovered).toEqual(["a", "b"]);
    const r = parseAnswer("Body.\n\n" + fence(JSON.stringify({ mcq: goodMcq })) + "\n\nNOT COVERED: dosing");
    expect(r.practice?.mcq?.answer).toBe(1);
    expect(r.notCovered).toEqual(["dosing"]);
  });
});
