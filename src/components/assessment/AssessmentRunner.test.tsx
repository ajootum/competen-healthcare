// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { Host } from "./test-harness";
import { SaveStatusPill } from "./AssessmentRunner";
import { BEDSIDE_AUDIT, CHART_AUDIT, HH_AUDIT, RESP_ASSESS, RESP_RULES, uid } from "@/lib/assessment/core/fixtures";
import { GUIDED_ASSESSMENT_LAYOUT, STANDARD_CHECKLIST_LAYOUT, presetAllSatisfactory, presetOneCriticalFailed, type InstrumentDef, type LayoutDoc } from "@/lib/assessment/core";

afterEach(cleanup);

const FIXTURES: [string, InstrumentDef][] = [["staged skills", RESP_ASSESS], ["hand hygiene audit", HH_AUDIT], ["concurrent audit", BEDSIDE_AUDIT], ["chart audit", CHART_AUDIT]];
const article = (container: HTMLElement, key: string) => container.querySelector<HTMLElement>(`article[data-item-key="${key}"]`)!;

describe("every item is drawn", () => {
  it.each(FIXTURES)("standard checklist draws every item of the %s", (_n, def) => {
    const { container } = render(<Host def={def} layout={STANDARD_CHECKLIST_LAYOUT} />);
    for (const it of def.items) expect(screen.getByText(it.prompt)).toBeTruthy();
    expect(container.querySelectorAll("article[data-item-key]").length).toBe(def.items.length);
  });

  it.each(FIXTURES)("guided assessment reaches every item of the %s with Next, one at a time", (_n, def) => {
    const { container } = render(<Host def={def} layout={GUIDED_ASSESSMENT_LAYOUT} mode="guided" />);
    const seen: string[] = [];
    for (let i = 0; i < def.items.length; i++) {
      expect(screen.getAllByText(`Item ${i + 1} of ${def.items.length}`, { exact: false }).length).toBeGreaterThan(0);
      const arts = container.querySelectorAll("article[data-item-key]");
      expect(arts.length).toBe(1);
      seen.push(arts[0].getAttribute("data-item-key")!);
      if (i < def.items.length - 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(seen).toEqual(def.items.map((x) => x.stable_key));
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a layout that hides things in its own way still draws every item (unknown keys are ignored)", () => {
    const hostile = { ...STANDARD_CHECKLIST_LAYOUT, hide: [uid(11)], items: [uid(12)], order: "reverse" } as unknown as LayoutDoc;
    const { container } = render(<Host def={RESP_ASSESS} layout={hostile} />);
    expect(container.querySelectorAll("article[data-item-key]").length).toBe(RESP_ASSESS.items.length);
  });
});

describe("modes share the responses", () => {
  it("switching Standard and Guided keeps every answer", () => {
    const { container } = render(<Host def={RESP_ASSESS} layout={STANDARD_CHECKLIST_LAYOUT} />);
    const first = article(container, uid(11));
    fireEvent.click(within(first).getByRole("radio", { name: /3 Advanced beginner/ }));
    expect(screen.getByText("1 of 5 completed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Guided assessment" }));
    expect(screen.getByText("1 of 5 completed")).toBeTruthy();
    // guided starts at the first item still open: item 2
    expect(screen.getAllByText("Item 2 of 5", { exact: false }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    const radio = within(article(container, uid(11))).getByRole("radio", { name: /3 Advanced beginner/ }) as HTMLInputElement;
    expect(radio.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Standard checklist" }));
    expect(screen.getByText("1 of 5 completed")).toBeTruthy();
    expect((within(article(container, uid(11))).getByRole("radio", { name: /3 Advanced beginner/ }) as HTMLInputElement).checked).toBe(true);
    expect(container.querySelectorAll("article[data-item-key]").length).toBe(5);
  });

  it("onChange reports the new responses", () => {
    const seen = vi.fn();
    const { container } = render(<Host def={RESP_ASSESS} layout={STANDARD_CHECKLIST_LAYOUT} onResponses={seen} />);
    fireEvent.click(within(article(container, uid(12))).getByRole("radio", { name: /4 Competent/ }));
    expect(seen).toHaveBeenLastCalledWith({ [uid(12)]: { level_code: "L4" } });
  });
});

describe("anchored descriptors", () => {
  it("shows every level's label AND description on the segmented rating control", () => {
    render(<Host def={RESP_ASSESS} layout={STANDARD_CHECKLIST_LAYOUT} />);
    expect(screen.getAllByText("Needs step-by-step direction.").length).toBe(5);
    expect(screen.getAllByText("Intuitive, fluent performance.").length).toBe(5);
    expect(screen.getAllByText("No evidence of the expected performance.").length).toBe(5);
  });

  it("radio list and select controls keep the descriptors too", () => {
    const radio = { ...STANDARD_CHECKLIST_LAYOUT, controls: { rating_scale: "radio_list" } } as LayoutDoc;
    const { unmount } = render(<Host def={RESP_ASSESS} layout={radio} />);
    expect(screen.getAllByText("Plans and prioritises independently.").length).toBe(5);
    unmount();
    const sel = { ...STANDARD_CHECKLIST_LAYOUT, controls: { rating_scale: "select" } } as LayoutDoc;
    const { container } = render(<Host def={RESP_ASSESS} layout={sel} />);
    const select = within(article(container, uid(11))).getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(select.options).some((o) => o.text.includes("4 Competent") && o.text.includes("Plans and prioritises independently."))).toBe(true);
    fireEvent.change(select, { target: { value: "L4" } });
    expect(screen.getByText("1 of 5 completed")).toBeTruthy();
  });
});

describe("states", () => {
  it("Not applicable needs a reason when the item says so, and the reason clears the error", () => {
    const seen = vi.fn();
    const { container } = render(<Host def={BEDSIDE_AUDIT} layout={STANDARD_CHECKLIST_LAYOUT} onResponses={seen} />);
    const art = article(container, uid(311));
    expect(within(art).queryByRole("alert")).toBeNull();
    fireEvent.click(within(art).getByRole("button", { name: "Not applicable" }));
    expect(within(art).getByRole("alert").textContent).toBe("Not applicable needs a reason.");
    expect(within(art).getByText("Not applicable reason (required)")).toBeTruthy();
    fireEvent.change(within(art).getByLabelText(/Not applicable reason/), { target: { value: "Patient was discharged" } });
    expect(within(art).queryByRole("alert")).toBeNull();
    expect(seen).toHaveBeenLastCalledWith({ [uid(311)]: { state: "not_applicable", reason: "Patient was discharged" } });
  });

  it("an item that does not require a reason accepts Not applicable at once", () => {
    const { container } = render(<Host def={HH_AUDIT} layout={STANDARD_CHECKLIST_LAYOUT} />);
    const art = article(container, uid(211));
    fireEvent.click(within(art).getByRole("button", { name: "Not applicable" }));
    expect(within(art).queryByRole("alert")).toBeNull();
    expect(within(art).getByText("Not applicable reason (optional)")).toBeTruthy();
  });

  it("state labels come from the definition and the first button clears the response", () => {
    const { container } = render(<Host def={BEDSIDE_AUDIT} layout={STANDARD_CHECKLIST_LAYOUT} />);
    const art = article(container, uid(311));
    fireEvent.click(within(art).getByRole("button", { name: "Could not observe" }));
    expect(within(art).getByRole("button", { name: "Could not observe" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(art).getByRole("button", { name: "Not assessed" }));
    expect(within(art).getByRole("button", { name: "Could not observe" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(art).getByRole("button", { name: "Not assessed" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("a rating item offers Not observed and Unable to demonstrate from its scale", () => {
    const { container } = render(<Host def={RESP_ASSESS} layout={STANDARD_CHECKLIST_LAYOUT} />);
    const art = article(container, uid(13));
    expect(within(art).getByRole("button", { name: "Not observed" })).toBeTruthy();
    fireEvent.click(within(art).getByRole("button", { name: "Unable to demonstrate" }));
    expect(screen.getByText("Critical item not met")).toBeTruthy();
  });
});

describe("indicators, critical items, slots", () => {
  it("critical items carry the accent and badge, and progress reads x of y completed", () => {
    const { container } = render(<Host def={RESP_ASSESS} layout={STANDARD_CHECKLIST_LAYOUT} />);
    const crit = article(container, uid(13));
    expect(crit.className).toContain("border-l-4");
    expect(within(crit).getByText("Critical")).toBeTruthy();
    expect(article(container, uid(12)).className).not.toContain("border-l-4");
    expect(screen.getByText("0 of 5 completed")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText("5 not answered")).toBeTruthy();
    expect(screen.getByText("1 critical")).toBeTruthy();
    expect(screen.getByText("1 missing evidence")).toBeTruthy();
  });

  it("guidance and expected performance follow the slots: disclosure or inline", () => {
    const def: InstrumentDef = { ...RESP_ASSESS, items: RESP_ASSESS.items.map((i, n) => (n === 0 ? { ...i, guidance: "Look for chest movement.", expected_performance: [{ text: "Counts for a full minute" }] } : i)) };
    const { container, unmount } = render(<Host def={def} layout={STANDARD_CHECKLIST_LAYOUT} />);
    const a = article(container, uid(11));
    expect(within(a).getByText("Guidance").tagName).toBe("SUMMARY");
    expect(within(a).getByText("Expected performance", { selector: "p" })).toBeTruthy();
    unmount();
    const inline = { ...STANDARD_CHECKLIST_LAYOUT, item: { ...STANDARD_CHECKLIST_LAYOUT.item, slots: { ...STANDARD_CHECKLIST_LAYOUT.item.slots, guidance: "inline", expected: "disclosure" } } } as LayoutDoc;
    const r2 = render(<Host def={def} layout={inline} />);
    const b = article(r2.container, uid(11));
    expect(within(b).getByText("Look for chest movement.").tagName).toBe("P");
    expect(within(b).getByText("Expected performance", { selector: "summary" })).toBeTruthy();
  });

  it("evidence and comment can sit in a drawer or inline", () => {
    const onAttach = vi.fn();
    const { container, unmount } = render(<Host def={RESP_ASSESS} layout={STANDARD_CHECKLIST_LAYOUT} onAttachEvidence={onAttach} onCommentChange={() => undefined} />);
    const a = article(container, uid(15));
    const btn = within(a).getByRole("button", { name: "Evidence (0)" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(a).getByRole("button", { name: "Attach evidence" }));
    expect(onAttach).toHaveBeenCalledWith(uid(15));
    unmount();
    const inline = { ...STANDARD_CHECKLIST_LAYOUT, item: { ...STANDARD_CHECKLIST_LAYOUT.item, slots: { ...STANDARD_CHECKLIST_LAYOUT.item.slots, comment: "inline", evidence: "inline" } } } as LayoutDoc;
    const r = render(<Host def={RESP_ASSESS} layout={inline} onCommentChange={() => undefined} />);
    expect(within(article(r.container, uid(15))).getByLabelText("Comment on RA-AP-01")).toBeTruthy();
  });

  it("secondary fields use a two-column grid from the md edge and stack below it", () => {
    const wide = render(<Host def={BEDSIDE_AUDIT} layout={STANDARD_CHECKLIST_LAYOUT} breakpoint="desktop" />);
    expect(wide.container.querySelector('[data-fields="grid2"]')).toBeTruthy();
    wide.unmount();
    const narrow = render(<Host def={BEDSIDE_AUDIT} layout={STANDARD_CHECKLIST_LAYOUT} breakpoint="mobile" />);
    expect(narrow.container.querySelector('[data-fields="grid2"]')).toBeNull();
    expect(narrow.container.querySelector('[data-fields="stack"]')).toBeTruthy();
    expect(narrow.container.querySelector('[data-breakpoint="mobile"]')).toBeTruthy();
  });

  it("required secondary fields show as missing until answered", () => {
    const { container } = render(<Host def={BEDSIDE_AUDIT} layout={STANDARD_CHECKLIST_LAYOUT} />);
    const a = article(container, uid(311));
    fireEvent.click(within(a).getByRole("radio", { name: "Yes" }));
    expect(within(a).getByText("Required: Staff role")).toBeTruthy();
    fireEvent.click(within(a).getByRole("radio", { name: "Registered" }));
    expect(within(a).queryByText("Required: Staff role")).toBeNull();
    expect(within(a).getByText("Completed")).toBeTruthy();
  });
});

describe("header blocks, section tabs, preview, save status", () => {
  it("renders the MetadataBlock and ContextBlock supplied by the host", () => {
    const layout = { ...STANDARD_CHECKLIST_LAYOUT, header: ["TitleBlock", "MetadataBlock", "ContextBlock", "ProgressBlock"], metadata: { fields: [{ key: "who", label: "Assessed" }, { key: "by", label: "Assessor" }] } } as LayoutDoc;
    render(<Host def={RESP_ASSESS} layout={layout} metadata={{ who: "Person A" }} context="Pathway: stage three of five" title="Staged skills" />);
    expect(screen.getByText("Assessed")).toBeTruthy();
    expect(screen.getByText("Person A")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("Pathway: stage three of five")).toBeTruthy();
    expect(screen.getByText("Staged skills")).toBeTruthy();
  });

  it("section tabs show counts and keep every section in the page", () => {
    const layout = { ...STANDARD_CHECKLIST_LAYOUT, navigation: { ...STANDARD_CHECKLIST_LAYOUT.navigation, mode: "section_tabs", sectionTabs: { counts: true } } } as LayoutDoc;
    const { container } = render(<Host def={RESP_ASSESS} layout={layout} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Assess breathing0/4", "Interpret findings0/1"]);
    expect(container.querySelectorAll("article[data-item-key]").length).toBe(5);
    expect(container.querySelector('[role="tabpanel"][hidden]')).toBeTruthy();
    fireEvent.click(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  });

  it("Preview outcome calls evaluate and announces the outcome and the deciding reason", () => {
    const { container } = render(<Host def={RESP_ASSESS} layout={STANDARD_CHECKLIST_LAYOUT} rules={RESP_RULES} initial={presetAllSatisfactory(RESP_ASSESS)} />);
    const live = container.querySelector("[data-outcome-preview]")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Preview outcome" }));
    expect(live.textContent).toContain("Achieved");
    expect(live.textContent).toContain("High average");
  });

  it("a failed critical item shows the critical outcome whatever the average", () => {
    const { container } = render(<Host def={RESP_ASSESS} layout={STANDARD_CHECKLIST_LAYOUT} rules={RESP_RULES} initial={presetOneCriticalFailed(RESP_ASSESS)} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview outcome" }));
    const live = container.querySelector("[data-outcome-preview]")!;
    expect(live.textContent).toContain("Not achieved");
    expect(live.textContent).toContain("a critical item failed");
  });

  it("the save-status pill follows the host", () => {
    const labels: [Parameters<typeof SaveStatusPill>[0]["status"], string][] = [["saving", "Saving"], ["saved", "Saved"], ["offline", "Offline, will retry"], ["conflict", "Conflict"]];
    for (const [s, text] of labels) {
      const { unmount } = render(<SaveStatusPill status={s} />);
      expect(screen.getByRole("status").textContent).toBe(text);
      unmount();
    }
    render(<Host def={RESP_ASSESS} layout={STANDARD_CHECKLIST_LAYOUT} saveStatus="offline" />);
    expect(screen.getByText("Offline, will retry")).toBeTruthy();
  });
});
