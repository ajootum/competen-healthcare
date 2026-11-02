// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import type { StudyBarView } from "@/lib/individual/scholar/study-carry";
import { studyStages } from "@/lib/individual/scholar/study-carry";

vi.mock("next/navigation", () => ({ usePathname: () => "/individual/scholar/study/revise", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import StudyNav from "./StudyNav";
import { setActiveStudy, useActiveStudyId } from "./study-active";

afterEach(() => { cleanup(); setActiveStudy(null); });

const ID = "2f7c1a5e-0000-4000-8000-000000000000";
const bar: StudyBarView = {
  id: ID, title: "Cardiac", objective: null, current: "revise", status: "active",
  stages: studyStages({ status: "active", currentStep: 0 }, 3, []),
};

describe("StudyNav (the in-workspace switcher)", () => {
  it("without a study session: a pill row of Learn, Revise, Apply and Evaluate with the due badge, Revise current", () => {
    render(<StudyNav dueCount={4} study={null} />);
    const nav = screen.getByRole("navigation", { name: "Learning spaces" });
    const links = nav.querySelectorAll("a");
    expect([...links].map(a => a.textContent?.replace(/\s*\d+ cards due$/, "").replace(/\d+$/, ""))).toEqual(["Learn", "Revise", "Apply", "Evaluate"]);
    expect(nav.textContent).toContain("4 cards due");
    expect(nav.querySelector('a[aria-current="page"]')?.textContent).toContain("Revise");
    expect(screen.queryByTestId("study-session-bar")).toBeNull();
  });

  it("with a study session: only the session bar, no pill row", () => {
    render(<StudyNav dueCount={4} study={bar} />);
    expect(screen.getByTestId("study-session-bar")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Learning spaces" })).toBeNull();
  });
});

describe("useActiveStudyId", () => {
  function Probe() { return <p data-testid="id">{useActiveStudyId() ?? "none"}</p>; }
  it("follows setActiveStudy, ignores a non-session id, and is cleared when StudyNav unmounts", () => {
    render(<Probe />);
    expect(screen.getByTestId("id").textContent).toBe("none");
    act(() => setActiveStudy(ID));
    expect(screen.getByTestId("id").textContent).toBe(ID);
    act(() => setActiveStudy("not-a-uuid"));
    expect(screen.getByTestId("id").textContent).toBe("none");
    const nav = render(<StudyNav study={bar} />);
    expect(screen.getAllByTestId("id")[0].textContent).toBe(ID);
    nav.unmount();
    expect(screen.getByTestId("id").textContent).toBe("none");
  });
});
