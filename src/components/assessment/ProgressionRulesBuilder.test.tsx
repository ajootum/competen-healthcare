// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ProgressionRulesBuilder } from "./ProgressionRulesBuilder";
import { RESP_ASSESS } from "@/lib/assessment/core/fixtures";
import { validateProgression, type ProgressionDoc, type StageScale } from "@/lib/assessment/core";

afterEach(cleanup);

const SCALE: StageScale = {
  stages: [
    { code: "unstaged", label: "Not staged", ordinal: 0 }, { code: "novice", label: "Novice", ordinal: 1 }, { code: "adv_beginner", label: "Advanced beginner", ordinal: 2 },
    { code: "competent", label: "Competent", ordinal: 3 }, { code: "proficient", label: "Proficient", ordinal: 4 }, { code: "expert", label: "Expert", ordinal: 5 },
  ],
  bands: [
    { stage: "unstaged", from_ordinal: 0, to_ordinal: 0 }, { stage: "novice", from_ordinal: 1, to_ordinal: 2 }, { stage: "adv_beginner", from_ordinal: 3, to_ordinal: 3 },
    { stage: "competent", from_ordinal: 4, to_ordinal: 4 }, { stage: "proficient", from_ordinal: 5, to_ordinal: 5 }, { stage: "expert", from_ordinal: 6, to_ordinal: 6 },
  ],
};
const PROG: ProgressionDoc = {
  schema: "asmt.progression/1", notStaged: "unstaged", target: { stage: "competent" },
  evidence: { attestation: ["assessor_evaluated"], withinDays: 365 },
  stageRules: [
    { stage: "novice", when: { count: { where: { attestation: "assessor_evaluated" } }, op: ">=", value: 2 } },
    { stage: "competent", when: { all: [
      { count: { where: { outcomeClass: "positive", minLevelStage: { group: "skills", atLeast: "competent" } } }, op: ">=", value: 2 },
      { distinctAssessors: {}, op: ">=", value: 2 },
      { not: { anyCriticalFailure: { withinDays: 180 } } },
    ] } },
  ],
  repeated: "best", conflicting: "latest", permitOrdinalMean: false, permitSingleAssessment: false,
};

function Box({ initial, seen }: { initial: ProgressionDoc; seen: ProgressionDoc[] }) {
  const [doc, setDoc] = useState(initial);
  return <ProgressionRulesBuilder doc={doc} stageScale={SCALE} def={RESP_ASSESS} onChange={(d) => { setDoc(d); seen.push(d); }} />;
}

describe("ProgressionRulesBuilder", () => {
  it("draws a valid document, with no error and no change", () => {
    const onChange = vi.fn();
    expect(validateProgression(PROG, SCALE, RESP_ASSESS).errors).toEqual([]);
    render(<ProgressionRulesBuilder doc={PROG} stageScale={SCALE} def={RESP_ASSESS} onChange={onChange} />);
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("No errors.");
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelectorAll("[data-stage-rule]").length).toBe(2);
  });

  it("never offers self-reported evidence, as a counted assessment or inside a condition", () => {
    const { container } = render(<ProgressionRulesBuilder doc={PROG} stageScale={SCALE} def={RESP_ASSESS} onChange={() => undefined} />);
    expect(screen.queryByLabelText(/self.?reported/i)).toBeNull();
    expect(screen.getByLabelText("Assessor evaluated")).toBeTruthy();
    for (const sel of Array.from(container.querySelectorAll("select"))) {
      for (const o of Array.from(sel.options)) expect(o.value).not.toBe("self_reported");
    }
  });

  it("a document that lists self-reported evidence is refused, with a button to remove it", () => {
    const seen: ProgressionDoc[] = [];
    const bad: ProgressionDoc = { ...PROG, evidence: { ...PROG.evidence, attestation: ["self_reported", "assessor_evaluated"] } };
    render(<Box initial={bad} seen={seen} />);
    expect(screen.getAllByText(/Self-reported evidence can never support a stage/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove self-reported" }));
    expect(seen[seen.length - 1].evidence.attestation).toEqual(["assessor_evaluated"]);
    expect(validateProgression(seen[seen.length - 1], SCALE, RESP_ASSESS).errors).toEqual([]);
  });

  it("lowering a count to one assessment is refused unless the permit is on", () => {
    const seen: ProgressionDoc[] = [];
    render(<Box initial={PROG} seen={seen} />);
    fireEvent.change(screen.getByLabelText("Condition stageRules[0].when: number"), { target: { value: "1" } });
    expect(screen.getAllByText(/can be reached from a single assessment/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText(/Allow a stage from a single assessment/));
    expect(seen[seen.length - 1].permitSingleAssessment).toBe(true);
    expect(validateProgression(seen[seen.length - 1], SCALE, RESP_ASSESS).errors).toEqual([]);
  });

  it("adds a stage rule for a stage that has none, and removes one", () => {
    const seen: ProgressionDoc[] = [];
    render(<Box initial={PROG} seen={seen} />);
    fireEvent.click(screen.getByRole("button", { name: "Add rule for Expert" }));
    expect(seen[seen.length - 1].stageRules.map((r) => r.stage)).toEqual(["novice", "competent", "expert"]);
    fireEvent.click(screen.getByRole("button", { name: "Delete rule for Expert" }));
    expect(seen[seen.length - 1].stageRules.length).toBe(2);
  });

  it("the nested NOT and AND tree is editable: wrap, add and remove conditions", () => {
    const seen: ProgressionDoc[] = [];
    render(<Box initial={PROG} seen={seen} />);
    expect(document.querySelectorAll("[data-cond-not]").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove NOT" }));
    expect(JSON.stringify(seen[seen.length - 1].stageRules[1].when)).not.toContain('"not"');
    fireEvent.click(screen.getAllByRole("button", { name: "Add condition" })[0]);
    expect((seen[seen.length - 1].stageRules[1].when as { all: unknown[] }).all.length).toBe(4);
  });
});
