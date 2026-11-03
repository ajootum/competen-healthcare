// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FieldInput } from "./FieldControls";
import { fieldSpec, validateResponse, type InstrumentItem, type ResponseValue } from "@/lib/assessment/core";
import { mkItem, mkSection, STAGE_RATING } from "@/lib/assessment/core/fixtures";

afterEach(cleanup);

const section = mkSection(1, "S", 1);
const mk = (partial: Partial<InstrumentItem> & Pick<InstrumentItem, "response_type">) => mkItem(5, 1, "X-1", { ...partial, section_key: section.stable_key });
function show(item: InstrumentItem, value: ResponseValue | null = null, control?: string, evidence?: { count: number; onAttach?: () => void }) {
  const onChange = vi.fn();
  const out = render(<FieldInput spec={fieldSpec(item)!} control={control} value={value} onChange={onChange} idBase="t" label="Question" evidence={evidence} issues={validateResponse(item, value).issues} />);
  return { onChange, ...out };
}

describe("FieldInput, one control per response type", () => {
  it("rating scale: every level with its label and descriptor", () => {
    const { onChange } = show(mk({ response_type: "rating_scale", scale: STAGE_RATING }));
    expect(screen.getAllByRole("radio").length).toBe(7);
    expect(screen.getByText("Follows rules, little discretion.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /5 Proficient/ }));
    expect(onChange).toHaveBeenCalledWith({ level_code: "L5" });
  });

  it("yes/no, pass/fail and achieved write the engine's values", () => {
    for (const [t, label, value] of [["yes_no", "No", "no"], ["pass_fail", "Pass", "pass"], ["achieved", "Not achieved", "not_achieved"]] as const) {
      const { onChange, unmount } = show(mk({ response_type: t }));
      fireEvent.click(screen.getByRole("radio", { name: label }));
      expect(onChange).toHaveBeenCalledWith({ value });
      unmount();
    }
  });

  it("multiple choice single and multi", () => {
    const options = [{ code: "a", label: "Alpha" }, { code: "b", label: "Bravo" }];
    const single = show(mk({ response_type: "multiple_choice", config: { options, select: "single" } }));
    fireEvent.click(screen.getByRole("radio", { name: "Bravo" }));
    expect(single.onChange).toHaveBeenCalledWith({ value: "b" });
    single.unmount();
    const multi = show(mk({ response_type: "multiple_choice", config: { options, select: "multi" } }), { value: ["a"] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Bravo" }));
    expect(multi.onChange).toHaveBeenCalledWith({ value: ["a", "b"] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    expect(multi.onChange).toHaveBeenLastCalledWith(null);
  });

  it("numeric rating, measurement with a unit, free text, datetime", () => {
    const num = show(mk({ response_type: "numeric_rating", config: { min: 1, max: 5, integer: true } }));
    fireEvent.click(screen.getByRole("radio", { name: "4" }));
    expect(num.onChange).toHaveBeenCalledWith({ value: 4 });
    num.unmount();
    const meas = show(mk({ response_type: "measurement", config: { unit: "mmol", min: 0 } }));
    expect(screen.getByText("mmol")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "7.5" } });
    expect(meas.onChange).toHaveBeenCalledWith({ value: 7.5 });
    meas.unmount();
    const txt = show(mk({ response_type: "free_text", config: { maxLength: 50 } }), { value: "hello" });
    expect(screen.getByText("5 of 50")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "hello!" } });
    expect(txt.onChange).toHaveBeenCalledWith({ value: "hello!" });
    txt.unmount();
    const dt = show(mk({ response_type: "datetime" }));
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "2026-11-03T10:30" } });
    expect(dt.onChange).toHaveBeenCalledWith({ value: "2026-11-03T10:30" });
  });

  it("na is a checkbox that writes the state; evidence shows the count and an attach button", () => {
    const na = show(mk({ response_type: "na", config: { naReasonRequired: true } }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Not applicable" }));
    expect(na.onChange).toHaveBeenCalledWith({ state: "not_applicable", reason: "" });
    na.unmount();
    const onAttach = vi.fn();
    show(mk({ response_type: "evidence" }), null, undefined, { count: 2, onAttach });
    expect(screen.getByText("2 attached")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Attach evidence" }));
    expect(onAttach).toHaveBeenCalled();
  });

  it("a response never holds two of level, state and value", () => {
    const item = mk({ response_type: "rating_scale", scale: STAGE_RATING });
    const { onChange } = show(item, { level_code: "L3" });
    fireEvent.click(screen.getByRole("button", { name: "Not observed" }));
    const written = onChange.mock.calls[0][0] as ResponseValue;
    expect(written.state).toBe("not_observed");
    expect(written.level_code).toBeUndefined();
    expect(written.value).toBeUndefined();
    expect(validateResponse(item, written).ok).toBe(true);
  });
});
