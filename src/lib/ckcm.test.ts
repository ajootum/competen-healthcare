import { describe, it, expect } from "vitest";
import { indicatorStatus } from "./ckcm";

describe("indicatorStatus — quality indicator evaluation (EQOS Ch.44)", () => {
  it("higher-is-better: meets target", () => {
    expect(indicatorStatus(90, 85, 70, "higher_is_better")).toBe("on_target");
    expect(indicatorStatus(85, 85, 70, "higher_is_better")).toBe("on_target");
  });
  it("higher-is-better: below target but above escalation → warning", () => {
    expect(indicatorStatus(80, 85, 70, "higher_is_better")).toBe("warning");
  });
  it("higher-is-better: below escalation → breach", () => {
    expect(indicatorStatus(65, 85, 70, "higher_is_better")).toBe("breach");
    expect(indicatorStatus(70, 85, 70, "higher_is_better")).toBe("warning"); // at escalation = not breached
  });
  it("lower-is-better: inverted comparisons", () => {
    expect(indicatorStatus(3, 5, 10, "lower_is_better")).toBe("on_target");
    expect(indicatorStatus(7, 5, 10, "lower_is_better")).toBe("warning");
    expect(indicatorStatus(12, 5, 10, "lower_is_better")).toBe("breach");
  });
  it("no measurement → no_data", () => {
    expect(indicatorStatus(null, 85, 70, "higher_is_better")).toBe("no_data");
  });
  it("no target set → no_data even with a value", () => {
    expect(indicatorStatus(50, null, null, "higher_is_better")).toBe("no_data");
  });
});
