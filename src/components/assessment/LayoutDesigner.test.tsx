// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { LayoutDesigner } from "./LayoutDesigner";
import { cleanLayout } from "./layout-clean";
import { BEDSIDE_AUDIT, RESP_ASSESS, RESP_RULES } from "@/lib/assessment/core/fixtures";
import { ITEM_SELECTOR_KEYS, GUIDED_ASSESSMENT_LAYOUT, STANDARD_CHECKLIST_LAYOUT, validateLayout, type LayoutDoc } from "@/lib/assessment/core";

afterEach(cleanup);

/** Every key at every depth. */
function allKeys(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((v) => allKeys(v, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.push(k); allKeys(v, out); }
  return out;
}
const selectorKeysIn = (l: unknown) => allKeys(l).filter((k) => (ITEM_SELECTOR_KEYS as readonly string[]).includes(k));

const HOSTILE = {
  ...STANDARD_CHECKLIST_LAYOUT,
  hide: ["a"], items: ["b"], order: "reverse", filter: { critical: true },
  navigation: { ...STANDARD_CHECKLIST_LAYOUT.navigation, skip: 2 },
  section: { ...STANDARD_CHECKLIST_LAYOUT.section, only: ["x"] },
  item: { ...STANDARD_CHECKLIST_LAYOUT.item, where: "critical", slots: { ...STANDARD_CHECKLIST_LAYOUT.item.slots, hidden: true } },
  controls: { rating_scale: "segmented", hide: "yes" },
  print: { ...STANDARD_CHECKLIST_LAYOUT.print, exclude: ["k"] },
} as unknown as LayoutDoc;

describe("cleanLayout", () => {
  it("drops every key outside the closed vocabulary, at every depth", () => {
    expect(selectorKeysIn(HOSTILE).length).toBeGreaterThan(5);
    const clean = cleanLayout(HOSTILE);
    expect(selectorKeysIn(clean)).toEqual([]);
    expect(validateLayout(clean, RESP_ASSESS).errors).toEqual([]);
  });
  it("leaves a valid layout exactly as it was", () => {
    expect(cleanLayout(STANDARD_CHECKLIST_LAYOUT)).toEqual(STANDARD_CHECKLIST_LAYOUT);
    expect(cleanLayout(GUIDED_ASSESSMENT_LAYOUT)).toEqual(GUIDED_ASSESSMENT_LAYOUT);
  });
});

describe("LayoutDesigner cannot emit a layout with item selectors", () => {
  it("has no control that hides, filters, skips or reorders items", () => {
    const { container } = render(<LayoutDesigner layout={STANDARD_CHECKLIST_LAYOUT} def={RESP_ASSESS} onChange={() => undefined} />);
    const panel = container.firstElementChild!.firstElementChild as HTMLElement;
    const words = Array.from(panel.querySelectorAll("label, legend, button, option, summary")).map((e) => e.textContent ?? "").join(" | ");
    expect(words).not.toMatch(/\b(hide|hidden|filter|skip|exclude|sort|reorder|visible items|only show)\b/i);
    expect(words).toMatch(/Presentation/);
  });

  it("a hostile layout is cleaned on the first edit", () => {
    const onChange = vi.fn();
    render(<LayoutDesigner layout={HOSTILE} def={RESP_ASSESS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Grouping"), { target: { value: "group" } });
    const emitted = onChange.mock.calls[0][0] as LayoutDoc;
    expect(emitted.grouping).toBe("group");
    expect(selectorKeysIn(emitted)).toEqual([]);
    expect(validateLayout(emitted, RESP_ASSESS).errors).toEqual([]);
  });

  it("a layout that already carries a selector key is reported, never accepted silently", () => {
    render(<LayoutDesigner layout={HOSTILE} def={RESP_ASSESS} onChange={() => undefined} />);
    expect(screen.getAllByText(/would select, hide, filter or reorder items/).length).toBeGreaterThan(0);
  });

  it("every option of every picker produces a layout with no selector and no error", () => {
    const onChange = vi.fn();
    const { container } = render(<LayoutDesigner layout={STANDARD_CHECKLIST_LAYOUT} def={RESP_ASSESS} onChange={onChange} />);
    const panel = container.firstElementChild!.firstElementChild as HTMLElement;
    const selects = Array.from(panel.querySelectorAll("select"));
    expect(selects.length).toBeGreaterThan(25);
    let emitted = 0;
    for (const sel of selects) {
      for (const opt of Array.from(sel.options)) {
        if (opt.value === sel.value) continue;
        onChange.mockClear();
        fireEvent.change(sel, { target: { value: opt.value } });
        for (const c of onChange.mock.calls) {
          emitted++;
          const l = c[0] as LayoutDoc;
          expect(selectorKeysIn(l)).toEqual([]);
          expect(validateLayout(l, RESP_ASSESS).errors, `${opt.text}`).toEqual([]);
        }
      }
    }
    expect(emitted).toBeGreaterThan(60);
  });

  it("the header can be reordered and edited, and still validates", () => {
    const seen: LayoutDoc[] = [];
    function Box() {
      const [l, setL] = useState<LayoutDoc>(STANDARD_CHECKLIST_LAYOUT);
      return <LayoutDesigner layout={l} def={RESP_ASSESS} onChange={(n) => { setL(n); seen.push(n); }} />;
    }
    render(<Box />);
    fireEvent.click(screen.getByRole("button", { name: "Move Progress up" }));
    expect(seen[seen.length - 1].header).toEqual(["TitleBlock", "ProgressBlock", "SubjectBlock"]);
    fireEvent.click(screen.getByRole("button", { name: "Add Details row" }));
    expect(validateLayout(seen[seen.length - 1], RESP_ASSESS).errors.map((e) => e.code)).toEqual(["metadata_missing"]);
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect(validateLayout(seen[seen.length - 1], RESP_ASSESS).errors).toEqual([]);
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("No errors.");
  });
});

describe("LayoutDesigner previews", () => {
  it("draws every item at desktop, tablet and mobile widths, with the real runner", () => {
    const { container } = render(<LayoutDesigner layout={STANDARD_CHECKLIST_LAYOUT} def={BEDSIDE_AUDIT} onChange={() => undefined} />);
    const preview = container.querySelector("[data-layout-preview]") as HTMLElement;
    for (const [name, width, bp] of [["Desktop", "1100", "desktop"], ["Tablet", "768", "tablet"], ["Mobile", "375", "mobile"]] as const) {
      fireEvent.click(within(preview).getByRole("button", { name }));
      expect(preview.querySelector(`[data-preview-width="${width}"]`)).toBeTruthy();
      expect(preview.querySelector(`[data-breakpoint="${bp}"]`)).toBeTruthy();
      expect(preview.querySelectorAll("article[data-item-key]").length).toBe(BEDSIDE_AUDIT.items.length);
    }
    // the mobile override of the standard layout turns rows into cards and stacks the fields
    expect(preview.querySelector('article[data-component="ItemCard"]')).toBeTruthy();
    expect(preview.querySelector('[data-fields="stack"]')).toBeTruthy();
  });

  it("a stepper layout previews as a stepper", () => {
    const { container } = render(<LayoutDesigner layout={GUIDED_ASSESSMENT_LAYOUT} def={RESP_ASSESS} rules={RESP_RULES} onChange={() => undefined} />);
    expect(container.querySelector("[data-stepper]")).toBeTruthy();
    expect(container.querySelectorAll("[data-layout-preview] article[data-item-key]").length).toBe(1);
  });

  it("the print preview draws every item and follows the print options", () => {
    const layout: LayoutDoc = { ...STANDARD_CHECKLIST_LAYOUT, print: { ...STANDARD_CHECKLIST_LAYOUT.print, guidance: false, signature: true, orientation: "landscape", pageBreak: "section" } };
    const def = { ...RESP_ASSESS, items: RESP_ASSESS.items.map((i, n) => (n === 0 ? { ...i, guidance: "Secret guidance text" } : i)) };
    const { container, rerender } = render(<LayoutDesigner layout={layout} def={def} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    const sheet = container.querySelector("[data-print-sheet]")!;
    expect(sheet.getAttribute("data-orientation")).toBe("landscape");
    expect(sheet.querySelectorAll("article").length).toBe(def.items.length);
    expect(sheet.textContent).not.toContain("Secret guidance text");
    expect(sheet.querySelector("[data-print-signature]")).toBeTruthy();
    expect(sheet.querySelectorAll("[data-print-section]").length).toBe(def.sections.length);
    rerender(<LayoutDesigner layout={{ ...layout, print: { ...layout.print, guidance: true, signature: false } }} def={def} onChange={() => undefined} />);
    expect(container.querySelector("[data-print-sheet]")!.textContent).toContain("Secret guidance text");
    expect(container.querySelector("[data-print-signature]")).toBeNull();
  });
});
