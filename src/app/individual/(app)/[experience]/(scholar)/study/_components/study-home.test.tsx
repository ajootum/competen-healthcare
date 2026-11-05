// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../../../_components/SearchHistoryChoice", () => ({ HistoryNotice: () => null }));
vi.mock("./search-history-client", () => ({ HistoryKeyInput: () => null }));

import { ContinueCard, RecentMaterials, StartLearning } from "./study-home";

const session = { id: "abc", title: "T", topic: "Critically ill patients", status: "active" as const, steps: 8, currentStep: 0, sources: ["Essential Nursing Care"], lastActiveAt: "2026-11-05T10:00:00Z", createdAt: "2026-11-01T10:00:00Z" };

describe("Study Home sections", () => {
  it("Continue resumes the session it names, with its step and no percentage", () => {
    const h = renderToStaticMarkup(<ContinueCard s={session} href="/individual/scholar/study/learn?session=abc" more />);
    expect(h).toContain('href="/individual/scholar/study/learn?session=abc"');
    expect(h).toContain("Critically ill patients");
    expect(h).toContain("Step 1 of 8");
    expect(h).toContain("View all sessions");
    expect(h).not.toMatch(/\d+%/);
  });
  it("hides View all sessions with only one session", () => {
    expect(renderToStaticMarkup(<ContinueCard s={session} href="#" more={false} />)).not.toContain("View all sessions");
  });
  it("Start Learning hands the words to Learn's search, and asks for no teaching or study session", () => {
    const h = renderToStaticMarkup(<StartLearning hasMaterials historyOn={false} sessionsLink={false} libraryHref="/lib" />);
    expect(h).toMatch(/<form[^>]*action="[^"]*\/study\/learn"[^>]*method="get"/);
    expect(h).toContain('name="q"');
    expect(h).toContain("required");
    expect(h).not.toContain('name="teach"');
    expect(h).not.toContain('name="study"');
    expect(h).toContain("Or choose from your materials");
  });
  it("a new learner has no route to materials that do not exist", () => {
    expect(renderToStaticMarkup(<StartLearning hasMaterials={false} historyOn={false} sessionsLink={false} libraryHref="/lib" />)).not.toContain("Or choose from your materials");
  });
  it("a new learner sees the upload entry, and not an empty list", () => {
    const h = renderToStaticMarkup(<RecentMaterials rows={[]} unreadable={false} upload={<button>+ Upload material</button>} libraryHref="/lib" />);
    expect(h).toContain("ready for your first upload");
    expect(h).toContain("+ Upload material");
    expect(h).not.toContain("<ul");
  });
  it("each material opens its own page and says its state; a fifth stays off a phone", () => {
    const rows = [1, 2, 3, 4].map(i => ({ id: `m${i}`, title: `Doc ${i}`, type: "PDF", state: i === 2 ? { label: "No readable text", ready: false } : { label: "Ready", ready: true } }));
    const h = renderToStaticMarkup(<RecentMaterials rows={rows} unreadable={false} upload={null} libraryHref="/lib" />);
    expect(h).toContain("/study/m1");
    expect(h).toContain("PDF · <span>Ready");
    expect(h).toContain("No readable text");
    expect(h.match(/hidden md:block/g)).toHaveLength(1);
  });
  it("materials that cannot be read say so, and are not an empty library", () => {
    const h = renderToStaticMarkup(<RecentMaterials rows={[]} unreadable upload={null} libraryHref="/lib" />);
    expect(h).not.toContain("first upload");
  });
});

describe("Study Home: no repetition", () => {
  it("drops the source where it only repeats the heading", () => {
    const same = { ...session, topic: null, title: "Quality Improvement", sources: ["Quality Improvement"] };
    expect(renderToStaticMarkup(<ContinueCard s={same} href="#" more={false} />).match(/Quality Improvement/g)).toHaveLength(2); // heading, and the button's name for a screen reader
  });
});
