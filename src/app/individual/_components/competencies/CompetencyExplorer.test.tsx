// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { EMPTY_FACTS, buildExplorerModel, type ExplorerCompetency, type ExplorerFacts, type ExplorerStructure } from "@/lib/individual/scholar/competency-explorer";
import type { ExplorerDetail } from "@/app/individual/(app)/[experience]/(scholar)/my-competencies/explorer-data";
import CompetencyExplorer from "./CompetencyExplorer";

// SCHOLAR-COMPETENCY-EXPLORER-HFE-01: the Explorer over a NUR-CCF-shaped programme -- two Areas as Holdings named them, domains under
// the right Area in the saved order, a drawer that opens without navigation, search that shows the other Area with its context.

beforeAll(() => {
  // jsdom has no <dialog> showModal/close: the native behaviour is approximated by the open attribute.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { cleanup(); try { window.localStorage.clear(); } catch { /* ignore */ } });

const comp = (id: string, title: string, domainId: string, sortOrder: number): ExplorerCompetency => ({
  id, code: id.toUpperCase(), title, frameworkId: "fw", catalogue: "Competen Nursing Competency Framework", frameworkCode: "NUR-CCF", catalogueVersion: "1.0.0",
  domain: domainId, domainId, sortOrder, expectedLevel: null, contentStatus: "approved",
});
const COMPS = [
  comp("c1", "Concepts of Ventilation", "d-vent", 1), comp("c2", "Care of the Ventilated Patient", "d-vent", 2),
  comp("c3", "Basic Blood Gas Interpretation", "d-gas", 1), comp("c4", "Acts with accountability", "d-pp1", 1), comp("c5", "Communication & Teamwork", "d-pp2", 1),
];
const STRUCT: ExplorerStructure = {
  frameworkId: "fw",
  areas: [{ id: "a-clin", name: "Clinical Practice", sortOrder: 1 }, { id: "a-prof", name: "Professional Practice", sortOrder: 2 }],
  domains: [
    { id: "d-gas", name: "Blood Gases", code: null, sortOrder: 2, areaId: "a-clin" }, { id: "d-vent", name: "Ventilation", code: null, sortOrder: 1, areaId: "a-clin" },
    { id: "d-pp2", name: "Communication", code: "PP-02", sortOrder: 2, areaId: "a-prof" }, { id: "d-pp1", name: "Accountability", code: "PP-01", sortOrder: 1, areaId: "a-prof" },
  ],
};
const facts = new Map<string, ExplorerFacts>([["c3", { ...EMPTY_FACTS, sectionsAccepted: 2 }]]);
const detail = (id: string): ExplorerDetail => ({
  id, description: `About ${id}`, outcomes: [], self: null, selfOpenInstanceId: null, selfStartable: null, gaps: [], strengths: 0,
  evidence: { outcome: null, sectionsAccepted: id === "c3" ? 2 : 0, sectionsProposed: 0, questions: 0, answered: 0, accuracy: null, lastAt: null, lastVerdict: null, osceFinished: 0, casesCompleted: 0, learningSessions: 0, materials: [] },
  compare: { text: "Not enough to compare.", differs: false, selfBand: null, evidenceBand: null }, stages: [], verification: { state: "not_yet", line: "Verified competency: Not yet verified", detail: null },
});
const model = buildExplorerModel({ competencies: COMPS, structures: new Map([["fw", STRUCT]]), facts });
const details = Object.fromEntries(COMPS.map(c => [c.id, detail(c.id)]));
const mount = () => render(<CompetencyExplorer model={model} details={details} scaleMax={6} study={null} assessmentsBase="/individual/scholar/my-competencies/assessments" structureUnreadable={false} practiceUnreadable={false} expectedConfigured={false} />);

describe("CompetencyExplorer", () => {
  it("shows the two Areas as tabs in saved order, the first Area's domains in saved order, and the first domain open", () => {
    const { getAllByRole, getByRole, queryByText } = mount();
    const tabs = getAllByRole("tab").map(t => t.textContent?.trim());
    expect(tabs[0]).toMatch(/^Clinical Practice/);
    expect(tabs[1]).toMatch(/^Professional Practice/);
    expect(getByRole("heading", { name: "Explore Your Competencies" })).toBeTruthy();
    const domains = getAllByRole("button", { expanded: true }).concat(getAllByRole("button", { expanded: false })).map(b => b.textContent ?? "");
    expect(domains.some(d => d.includes("Ventilation"))).toBe(true);
    expect(domains.some(d => d.includes("Blood Gases"))).toBe(true);
    expect(domains.some(d => d.includes("Accountability"))).toBe(false);
    // the open domain lists its competencies in saved order, compact, with one concise indicator each and no "No expected level set"
    const rows = getAllByRole("button", { name: /open details$/ }).map(b => b.getAttribute("aria-label"));
    expect(rows).toEqual(["Concepts of Ventilation: open details", "Care of the Ventilated Patient: open details"]);
    expect(queryByText("No expected level set")).toBeNull();
    expect(queryByText(/Practised 0 of/)).toBeNull();
  });

  it("switches to the Professional Area, whose domains carry their codes in saved order", () => {
    const { getAllByRole } = mount();
    fireEvent.click(getAllByRole("tab")[1]);
    const domains = getAllByRole("button", { expanded: false }).map(b => b.textContent ?? "");
    expect(domains[0]).toMatch(/PP-01.*Accountability/);
    expect(domains[1]).toMatch(/PP-02.*Communication/);
  });

  it("opens a drawer for the selected competency without leaving the page, with the two perspectives kept apart, and closes back to the list", () => {
    const { getByRole, container } = mount();
    fireEvent.click(getByRole("button", { name: "Concepts of Ventilation: open details" }));
    const dialog = container.querySelector("dialog[open]")!;
    expect(dialog).toBeTruthy();
    expect(within(dialog as HTMLElement).getByRole("heading", { name: "Concepts of Ventilation" })).toBeTruthy();
    expect(within(dialog as HTMLElement).getByText("How I rate myself")).toBeTruthy();
    expect(within(dialog as HTMLElement).getByText("What my learning evidence shows")).toBeTruthy();
    expect(within(dialog as HTMLElement).getByText("Verified competency: Not yet verified")).toBeTruthy();
    const actions = within(dialog as HTMLElement).getByRole("group", { name: /Actions for/ });
    expect(within(actions).getByText("Learn").getAttribute("href")).toContain("study/learn?competency=c1");
    expect(within(actions).getByText("Practise")).toBeTruthy();
    expect(within(actions).queryByText("View Evidence")).toBeNull(); // nothing to view: the action is not drawn
    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "Close" }));
    expect(container.querySelector("dialog[open]")).toBeNull();
    expect(getByRole("button", { name: "Concepts of Ventilation: open details" })).toBeTruthy();
  });

  it("an accepted mapping shows as Material linked on the row, never as Practised", () => {
    const { getAllByRole, getByRole } = mount();
    fireEvent.click(getByRole("button", { name: "Expand all" }));
    const row = getAllByRole("button", { name: "Basic Blood Gas Interpretation: open details" })[0];
    expect(row.textContent).toContain("Material linked");
    expect(row.textContent).not.toContain("Practised");
  });

  it("a search shows a match from the other Area with its Area context, and the tabs come back when cleared", () => {
    const { getByRole, queryAllByRole, getAllByRole, container } = mount();
    const box = getByRole("searchbox");
    fireEvent.change(box, { target: { value: "accountab" } });
    expect(queryAllByRole("tab")).toHaveLength(0);
    const heads = [...container.querySelectorAll("h4")].map(h => h.textContent);
    expect(heads).toEqual(["Professional Practice"]);
    expect(getAllByRole("button", { name: /open details$/ }).map(b => b.getAttribute("aria-label"))).toEqual(["Acts with accountability: open details"]);
    fireEvent.change(box, { target: { value: "" } });
    expect(queryAllByRole("tab")).toHaveLength(2);
  });

  it("filters keep the structure and name the other Area's matches", () => {
    const { getByLabelText, getAllByRole, getByText } = mount();
    fireEvent.change(getByLabelText("Filter competencies"), { target: { value: "in_progress" } });
    // c3 (Material linked) is in Clinical Practice, under Blood Gases: the only domain left, opened so the match is visible
    expect(getAllByRole("button", { expanded: true }).map(b => b.textContent)).toEqual([expect.stringContaining("Blood Gases")]);
    expect(getAllByRole("button", { name: /open details$/ }).map(b => b.getAttribute("aria-label"))).toEqual(["Basic Blood Gas Interpretation: open details"]);
    fireEvent.change(getByLabelText("Filter competencies"), { target: { value: "not_started" } });
    expect(getByText(/2 in Professional Practice/)).toBeTruthy();
  });
});
