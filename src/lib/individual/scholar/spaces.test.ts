import { describe, expect, it } from "vitest";
import { FORMATIVE_NOTICE, SCHOLAR_SPACES, SCHOLAR_STAGES, scholarSpace, spaceOfPath } from "./spaces";

describe("Scholar learning spaces (HFE redesign)", () => {
  it("are the prototype's six, in order, each with its own page", () => {
    expect(SCHOLAR_SPACES.map(s => s.tab)).toEqual(["Library", "Learn", "Revise", "Apply", "Evaluate", "Progress"]);
    expect(new Set(SCHOLAR_SPACES.map(s => s.segment)).size).toBe(SCHOLAR_SPACES.length);
    for (const s of SCHOLAR_SPACES) expect(s.segment.startsWith("study")).toBe(true);
  });

  it("name the current tab from the path, most specific first", () => {
    expect(spaceOfPath("/individual/scholar/study")).toBe("library");
    expect(spaceOfPath("/individual/scholar/study/2f7c1a5e-0000-4000-8000-000000000000")).toBe("library");
    expect(spaceOfPath("/individual/scholar/study/ready?ids=a")).toBe("library");
    expect(spaceOfPath("/individual/scholar/study/learn")).toBe("learn");
    expect(spaceOfPath("/individual/scholar/study/saved")).toBe("learn");
    expect(spaceOfPath("/individual/scholar/study/revise?session=x")).toBe("revise");
    expect(spaceOfPath("/individual/scholar/study/apply/case")).toBe("apply");
    expect(spaceOfPath("/individual/scholar/study/evaluate/abc")).toBe("evaluate");
    expect(spaceOfPath("/individual/scholar/study/progress/explore/")).toBe("progress");
  });

  it("claim no page outside My Learning, and no lookalike segment", () => {
    expect(spaceOfPath("/individual/scholar")).toBeNull();
    expect(spaceOfPath("/individual/scholar/passport")).toBeNull();
    expect(spaceOfPath("/individual/scholar/studyx")).toBeNull();
    expect(spaceOfPath("/individual/scholar/study/learning")).toBe("library");
  });

  it("keep the eight-stage taxonomy of the product architecture, in its order", () => {
    expect(SCHOLAR_STAGES.map(s => s.name)).toEqual(["Join", "Upload", "Classify", "Learn", "Revise", "Apply", "Evaluate", "Progress"]);
  });

  it("say formative learning is not verified competence", () => {
    expect(FORMATIVE_NOTICE).toMatch(/Not verified clinical competence/);
    expect(scholarSpace("progress").intro).toMatch(/distinct from verified competence/);
  });
});
