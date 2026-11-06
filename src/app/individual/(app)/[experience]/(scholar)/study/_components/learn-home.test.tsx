// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./learn-landing", () => ({ learnHref: (q: Record<string, string>) => `/learn?${new URLSearchParams(q).toString()}` }));
vi.mock("./study-home", () => ({ textLink: "" }));

import { LearningLibrary, RecentLessons, StudyNext, recentLessons } from "./learn-home";

const s = (id: string, o = {}) => ({ id, title: `T ${id}`, topic: null, status: "completed" as const, steps: 4, currentStep: 3, sources: [], lastActiveAt: "2026-11-05T10:00:00Z", createdAt: "2026-11-01T10:00:00Z", ...o });

describe("Learn landing sections", () => {
  it("recent lessons leave out the one offered for resuming", () => {
    expect(recentLessons([s("a"), s("b"), s("c"), s("d")], "b").map(x => x.id)).toEqual(["a", "c", "d"]);
  });
  it("a recent lesson opens by its session, so nothing is regenerated", () => {
    const h = renderToStaticMarkup(<RecentLessons sessions={[s("a")]} unreadable={false} total={2} />);
    expect(h).toContain("session=a");
    expect(h).toContain("Completed");
    expect(h).not.toMatch(/teach=|study=new/);
  });
  it("no lessons, no section; unreadable says so", () => {
    expect(renderToStaticMarkup(<RecentLessons sessions={[]} unreadable={false} total={0} />)).toBe("");
    expect(renderToStaticMarkup(<RecentLessons sessions={[]} unreadable total={null} />)).toContain("could not be read");
  });
  it("Study next offers the plan's step, and is honest when there is none or it failed", () => {
    expect(renderToStaticMarkup(<StudyNext item={{ title: "Learn sepsis", minutes: 15, href: "/x" }} starting={false} unreadable={false} />)).toContain("From your plan");
    expect(renderToStaticMarkup(<StudyNext item={{ title: "Learn sepsis", minutes: null, href: "/x" }} starting unreadable={false} />)).toContain("suggestion from your materials");
    expect(renderToStaticMarkup(<StudyNext item={null} starting={false} unreadable={false} />)).toContain("Nothing is waiting");
    expect(renderToStaticMarkup(<StudyNext item={null} starting={false} unreadable />)).toContain("could not be worked out");
  });
  it("the library goes straight to the library, and keeps the learner's own apart from Competen's", () => {
    const h = renderToStaticMarkup(<LearningLibrary materials={3} savedOn coursesOn />);
    expect(h).toContain("/study/library");
    expect(h).toContain("3 materials");
    expect(h).toContain("Yours");
    expect(h).toContain("From Competen");
    expect(h.indexOf("Yours")).toBeLessThan(h.indexOf("From Competen"));
  });
  it("private or off areas are not mentioned, and an unread count is not zero", () => {
    const h = renderToStaticMarkup(<LearningLibrary materials={null} savedOn={false} coursesOn={false} />);
    expect(h).not.toContain("Competen</p>");
    expect(h).not.toContain("Courses");
    expect(h).not.toContain("Saved learning");
    expect(h).toContain("Could not be counted");
  });
});
