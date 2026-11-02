// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { RulesBuilder } from "./RulesBuilder";
import { TestScoring } from "./TestScoring";
import { validTestKinds, specsFor, renameOutcome } from "./rules-helpers";
import {
  BEDSIDE_AUDIT, BEDSIDE_RULES, CHART_AUDIT, CHART_RULES, HH_AUDIT, HH_RULES, RESP_ASSESS, RESP_RULES, uid,
} from "@/lib/assessment/core/fixtures";
import { validateRules, type InstrumentDef, type RulesDoc, type ScoringTestCase } from "@/lib/assessment/core";

afterEach(cleanup);

const CASES: [string, InstrumentDef, RulesDoc][] = [
  ["staged skills", RESP_ASSESS, RESP_RULES], ["hand hygiene audit", HH_AUDIT, HH_RULES], ["concurrent audit", BEDSIDE_AUDIT, BEDSIDE_RULES], ["chart audit", CHART_AUDIT, CHART_RULES],
];

function Box({ def, initial, onDoc }: { def: InstrumentDef; initial: RulesDoc; onDoc: (d: RulesDoc) => void }) {
  const [doc, setDoc] = useState(initial);
  return <RulesBuilder def={def} doc={doc} onChange={(d) => { setDoc(d); onDoc(d); }} />;
}

describe("RulesBuilder round trip", () => {
  it.each(CASES)("draws the %s rules, validates with 0 errors and does not touch the document", (_n, def, doc) => {
    const before = JSON.stringify(doc);
    const onChange = vi.fn();
    render(<RulesBuilder def={def} doc={doc} onChange={onChange} />);
    expect(validateRules(def, doc).errors).toEqual([]);
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("No errors.");
    expect(onChange).not.toHaveBeenCalled();
    expect(JSON.stringify(doc)).toBe(before);
    // every rule and outcome is drawn
    for (const r of doc.rules) expect(screen.getByRole("region", { name: `Rule ${r.label}` })).toBeTruthy();
    for (const o of doc.outcomes) expect(screen.getAllByText(new RegExp(o.label)).length).toBeGreaterThan(0);
  });

  it("an edit changes only what was edited, and the edited document still validates", () => {
    const seen: RulesDoc[] = [];
    render(<Box def={RESP_ASSESS} initial={RESP_RULES} onDoc={(d) => seen.push(d)} />);
    fireEvent.change(screen.getByLabelText("Rule name rules[0]"), { target: { value: "Very high average" } });
    const last = seen[seen.length - 1];
    expect(last.rules[0].label).toBe("Very high average");
    expect({ ...last, rules: last.rules.map((r, i) => (i === 0 ? { ...r, label: RESP_RULES.rules[0].label } : r)) }).toEqual(RESP_RULES);
    expect(validateRules(RESP_ASSESS, last).errors).toEqual([]);
  });

  it("changing a priority to make two overlapping rules ambiguous shows the error at that rule", () => {
    const seen: RulesDoc[] = [];
    render(<Box def={RESP_ASSESS} initial={RESP_RULES} onDoc={(d) => seen.push(d)} />);
    // rules[1] (priority 20) and rules[0] (priority 100) can both be true, with the same outcome: no clash.
    // Give rules[2] (PARTIAL) the priority of rules[1] (ACHIEVED): the boxes intersect.
    fireEvent.change(screen.getByLabelText("Priority rules[2]"), { target: { value: "20" } });
    const rule = screen.getByRole("region", { name: "Rule Skills met, others not" });
    expect(within(rule).getAllByRole("alert").some((a) => /same priority/.test(a.textContent ?? ""))).toBe(true);
    expect(screen.getByRole("status", { name: "" }).textContent).toMatch(/error/);
  });

  it("a missing fallback is reported against the fallback", () => {
    const bad = { ...RESP_RULES, fallback: "" };
    render(<RulesBuilder def={RESP_ASSESS} doc={bad} onChange={() => undefined} />);
    expect(screen.getAllByText(/fallback outcome is required/i).length).toBeGreaterThan(0);
  });

  it("adds a rule, an outcome and an aggregate that validate or are flagged where they are", () => {
    const seen: RulesDoc[] = [];
    render(<Box def={HH_AUDIT} initial={HH_RULES} onDoc={(d) => seen.push(d)} />);
    fireEvent.click(screen.getByRole("button", { name: "Add outcome" }));
    expect(seen[seen.length - 1].outcomes.length).toBe(HH_RULES.outcomes.length + 1);
    // the new outcome can never be the result: reported
    expect(screen.getAllByText(/can never be the result/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(seen[seen.length - 1].rules.length).toBe(HH_RULES.rules.length + 1);
    fireEvent.click(screen.getByRole("button", { name: "Add aggregate" }));
    expect(seen[seen.length - 1].aggregates!.length).toBe(HH_RULES.aggregates!.length + 1);
  });

  it("renaming an outcome code follows every reference", () => {
    const renamed = renameOutcome(RESP_RULES, "ACHIEVED", "MET_ALL");
    expect(renamed.rules.map((r) => r.then.outcome)).toContain("MET_ALL");
    expect(renamed.groups![0].rules[0].then.outcome).toBe("MET_ALL");
    expect(JSON.stringify(renamed)).not.toContain("ACHIEVED");
    expect(validateRules(RESP_ASSESS, renamed).errors).toEqual([]);
  });

  it("the gate pickers offer only outcomes of the right class", () => {
    render(<RulesBuilder def={RESP_ASSESS} doc={RESP_RULES} onChange={() => undefined} />);
    const crit = screen.getByLabelText("A critical item is not met: outcome") as HTMLSelectElement;
    expect(Array.from(crit.options).map((o) => o.value)).toEqual(["", "NOT_ACH"]);
    const mand = screen.getByLabelText("A required item is unanswered: outcome") as HTMLSelectElement;
    expect(Array.from(mand.options).map((o) => o.value)).toEqual(["", "INCOMPLETE"]);
  });
});

describe("predicate pickers offer only valid tests", () => {
  const spec = (def: InstrumentDef, n: number) => specsFor(def, { scope: "items", keys: [uid(n)] });
  it("a yes/no item has no level tests", () => {
    const kinds = validTestKinds(spec(HH_AUDIT, 211), true);
    expect(kinds).toContain("satisfactory");
    expect(kinds).not.toContain("levelAtLeast");
    expect(kinds).not.toContain("value");
  });
  it("a rating item offers level tests, a measurement offers value tests, free text offers neither satisfactory nor level", () => {
    expect(validTestKinds(spec(RESP_ASSESS, 13), true)).toEqual(expect.arrayContaining(["levelAtLeast", "levelAtMost", "satisfactory"]));
    expect(validTestKinds(spec(HH_AUDIT, 217), true)).toEqual(expect.arrayContaining(["value", "state"]));
    const text = validTestKinds(spec(HH_AUDIT, 219), true);
    expect(text).not.toContain("satisfactory");
    expect(text).not.toContain("levelAtLeast");
    expect(text).toContain("answered");
  });
  it("a secondary field is never offered satisfactory", () => {
    expect(validTestKinds(specsFor(BEDSIDE_AUDIT, { scope: "all" }), false)).not.toContain("satisfactory");
  });

  it("the single-item editor lists only the valid tests for the chosen item", () => {
    const doc: RulesDoc = {
      ...HH_RULES,
      rules: [{ id: "one", label: "Moment one", priority: 5, when: { item: uid(211), test: { satisfactory: true } }, then: { outcome: "COMPLIANT" } }, ...HH_RULES.rules],
    };
    render(<RulesBuilder def={HH_AUDIT} doc={doc} onChange={() => undefined} />);
    const sel = screen.getByLabelText("Condition rules[0].when: test: the answer") as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toContain("satisfactory");
    expect(values).not.toContain("levelAtLeast");
  });
});

describe("TestScoring", () => {
  function Panel({ def, doc, initial = [] }: { def: InstrumentDef; doc: RulesDoc; initial?: ScoringTestCase[] }) {
    const [tests, setTests] = useState(initial);
    return <TestScoring def={def} doc={doc} tests={tests} onTestsChange={setTests} />;
  }

  it("runs a preset and shows the outcome and the rule that decided it", () => {
    const { container } = render(<Panel def={RESP_ASSESS} doc={RESP_RULES} />);
    fireEvent.click(screen.getByRole("button", { name: "All met" }));
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    const out = container.querySelector("[data-test-result]")!;
    expect(out.textContent).toContain("Achieved");
    expect(out.textContent).toContain("decided by rule high_average");
  });

  it("the critical-not-met preset hits the critical gate, and a wrong expectation is reported", () => {
    const { container } = render(<Panel def={RESP_ASSESS} doc={RESP_RULES} />);
    fireEvent.click(screen.getByRole("button", { name: "One critical item not met" }));
    fireEvent.change(screen.getByLabelText("Expected outcome"), { target: { value: "ACHIEVED" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    const out = container.querySelector("[data-test-result]")!;
    expect(out.textContent).toContain("gate criticalFail");
    expect(out.textContent).toContain("Does not match.");
    expect(out.textContent).toContain("outcome is NOT_ACH, expected ACHIEVED");
  });

  it("the blank preset leaves required items open: Incomplete", () => {
    const { container } = render(<Panel def={RESP_ASSESS} doc={RESP_RULES} />);
    fireEvent.click(screen.getByRole("button", { name: "Blank" }));
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(container.querySelector("[data-test-result]")!.textContent).toContain("gate mandatoryMissing");
  });

  it("the all not applicable preset on the audit leaves nothing to count", () => {
    const { container } = render(<Panel def={HH_AUDIT} doc={HH_RULES} />);
    fireEvent.click(screen.getByRole("button", { name: "All not applicable" }));
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(container.querySelector("[data-test-result]")!.textContent).toMatch(/counted|gate mandatoryMissing/);
  });

  it("saves a case, lists it as passing, loads it back and deletes it", () => {
    const { container } = render(<Panel def={RESP_ASSESS} doc={RESP_RULES} />);
    fireEvent.click(screen.getByRole("button", { name: "All met" }));
    fireEvent.change(screen.getByLabelText("Expected outcome"), { target: { value: "ACHIEVED" } });
    fireEvent.change(screen.getByLabelText("Case name"), { target: { value: "Everything met" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as case" }));
    const li = container.querySelector("[data-case]")!;
    expect(li.textContent).toContain("Everything met");
    expect(li.textContent).toContain("Pass");
    expect(screen.getByText("1 passed, 0 failed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete case Everything met" }));
    expect(container.querySelector("[data-case]")).toBeNull();
  });

  it("a saved case that stops passing is flagged", () => {
    const stale: ScoringTestCase = { id: "c1", name: "Old", responses: {}, expect: { outcome: "ACHIEVED" } };
    const { container } = render(<Panel def={RESP_ASSESS} doc={RESP_RULES} initial={[stale]} />);
    expect(container.querySelector("[data-case]")!.textContent).toContain("Fail");
    expect(screen.getByText("0 passed, 1 failed.")).toBeTruthy();
  });
});
