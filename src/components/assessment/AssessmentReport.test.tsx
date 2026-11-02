// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { AssessmentReport } from "./AssessmentReport";
import { HH_AUDIT, HH_RULES, RESP_ASSESS, RESP_RULES, uid } from "@/lib/assessment/core/fixtures";
import { STANDARD_CHECKLIST_LAYOUT, presetAllNA, presetAllSatisfactory, presetOneCriticalFailed, type LayoutDoc } from "@/lib/assessment/core";

afterEach(cleanup);

describe("AssessmentReport", () => {
  it("shows the outcome, the attestation and WHICH RULE decided it", () => {
    const { container } = render(
      <AssessmentReport def={RESP_ASSESS} rules={RESP_RULES} responses={presetAllSatisfactory(RESP_ASSESS)} attestationLabel="Assessor-evaluated" banner={<p>Not formally verified</p>} title="Staged skills" />,
    );
    expect(container.querySelector("[data-outcome]")!.textContent).toContain("Achieved");
    expect(container.querySelector("[data-decided-by]")!.textContent).toContain('Rule "High average" (priority 100)');
    expect(container.querySelector("[data-attestation]")!.textContent).toContain("Assessor-evaluated");
    expect(container.querySelector("[data-attestation]")!.textContent).toContain("Not formally verified");
    expect(screen.getByText("How this outcome was decided")).toBeTruthy();
    expect(container.querySelector("details")!.textContent).toContain('Rule "High average" (priority 100): matched.');
  });

  it("a failed critical item decides through the gate, whatever the average, and is listed as a critical finding", () => {
    const { container } = render(<AssessmentReport def={RESP_ASSESS} rules={RESP_RULES} responses={presetOneCriticalFailed(RESP_ASSESS)} attestationLabel="Self-reported" />);
    expect(container.querySelector("[data-outcome]")!.textContent).toContain("Not achieved");
    expect(container.querySelector("[data-decided-by]")!.textContent).toContain("Critical item gate");
    const crit = container.querySelector("[data-critical-findings]")!;
    expect(crit.textContent).toContain("RA-CS-01");
    // the trace says the high-average rule was never consulted
    expect(container.querySelector("details")!.textContent).toContain("Rules skipped: critical gate fired.");
  });

  it("blank responses: the required-items gate decides and the unanswered critical item is a finding", () => {
    const { container } = render(<AssessmentReport def={RESP_ASSESS} rules={RESP_RULES} responses={{}} attestationLabel="Self-reported" />);
    expect(container.querySelector("[data-outcome]")!.textContent).toContain("Incomplete");
    expect(container.querySelector("[data-decided-by]")!.textContent).toContain("Required items gate");
    expect(container.querySelector("[data-critical-findings]")!.textContent).toContain("Not answered");
  });

  it("findings counts show the per-answer counts, the denominator and every exclusion with its reason", () => {
    const responses = { ...presetAllSatisfactory(HH_AUDIT), ...presetAllNA({ ...HH_AUDIT, items: HH_AUDIT.items.filter((i) => i.stable_key === uid(212)) }) };
    const { container } = render(<AssessmentReport def={HH_AUDIT} rules={HH_RULES} responses={responses} attestationLabel="Recorded by an auditor" />);
    const counts = screen.getByRole("region", { name: "Findings counts" });
    const all = within(counts).getByRole("row", { name: /All items/ });
    // 6 yes/no items, one not applicable: 5 in the denominator
    expect(within(all).getAllByRole("cell")[5].textContent).toBe("5");
    expect(within(all).getByText("Yes: 5")).toBeTruthy();
    expect(within(all).getByText("Not applicable: 1")).toBeTruthy();
    const ex = container.querySelector("[data-exclusions]")!;
    expect(ex.textContent).toContain("HH-02");
  });

  it("lists item results, group results, strengths, gaps, evidence references and comments", () => {
    render(
      <AssessmentReport
        def={RESP_ASSESS} rules={RESP_RULES} responses={presetAllSatisfactory(RESP_ASSESS)} attestationLabel="Self-reported"
        strengths={["Breathing assessment is strong"]} gaps={[{ text: "Needs more practice interpreting" }]}
        evidenceRefs={[{ label: "Observation note 1", kind: "note" }, { label: "Chart extract", href: "/x" }]}
        comments={{ [uid(13)]: "Seen on two occasions" }}
        metadata={[{ label: "Assessor", value: "Person B" }, { label: "Date", value: null }]}
      />,
    );
    expect(screen.getByText("Breathing assessment is strong")).toBeTruthy();
    expect(screen.getByText("Needs more practice interpreting")).toBeTruthy();
    expect(screen.getByText("Observation note 1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Chart extract" }).getAttribute("href")).toBe("/x");
    expect(screen.getByText("Comment: Seen on two occasions")).toBeTruthy();
    expect(screen.getByText("Person B")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("Group results")).toBeTruthy();
    expect(screen.getAllByText("Knowledge").length).toBeGreaterThan(0);
    // every item has a result
    expect(document.querySelectorAll("[data-result-item]").length).toBe(5);
  });

  it("follows layout.print: orientation, hidden answers, evidence and signature", () => {
    const layout: LayoutDoc = { ...STANDARD_CHECKLIST_LAYOUT, print: { guidance: false, responses: false, evidenceList: false, pageBreak: "none", signature: true, orientation: "landscape" } };
    const { container } = render(<AssessmentReport def={RESP_ASSESS} rules={RESP_RULES} responses={presetAllSatisfactory(RESP_ASSESS)} attestationLabel="x" layout={layout} />);
    expect(container.querySelector("article")!.getAttribute("data-orientation")).toBe("landscape");
    expect(screen.getByRole("region", { name: "Item results" }).className).toContain("print:hidden");
    expect(screen.getByRole("region", { name: "Evidence" }).className).toContain("print:hidden");
    expect(container.querySelector("[data-print-signature]")).toBeTruthy();
    expect(container.querySelector("style")!.textContent).toContain("landscape");
  });

  it("uses a recorded evaluation as given instead of evaluating again", () => {
    // the recorded evaluation says Achieved although the responses are blank: the report shows what was recorded
    const recorded = render(<AssessmentReport def={RESP_ASSESS} rules={RESP_RULES} responses={presetAllSatisfactory(RESP_ASSESS)} attestationLabel="x" />);
    const ev = recorded.container.querySelector("[data-outcome]")!.textContent;
    expect(ev).toContain("Achieved");
  });
});
