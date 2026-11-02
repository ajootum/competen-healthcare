import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// SCHOLAR-CE-2026 CE-05: how the sessions route treats a scenario. The route has no unit harness, so its wiring is pinned in the source, as the other
// wiring tests do: the sufficiency check comes before any AI call, a scenario that keeps nothing says the scenario-specific thing, and the audit
// outcome names the rule that dropped each draft.

const route = fs.readFileSync(path.resolve(__dirname, "../../../app/api/individual/scholar/revision/sessions/route.ts"), "utf8");

describe("sessions route and scenarios", () => {
  it("the existing source-sufficiency check decides before the AI runner is built, and skips with no call", () => {
    const check = route.indexOf('caseReadiness([passage.content], "case_blueprint")');
    const runner = route.indexOf('scholarAiRunner(ctx, req, "questions"');
    expect(check).toBeGreaterThan(-1);
    expect(runner).toBeGreaterThan(check);
    expect(route).toMatch(/ready\.outcome === "insufficient" \|\| ready\.outcome === "simpler"/);
  });
  it("a scenario that is written for and keeps nothing sets the scenario message", () => {
    expect(route).toContain('call.kind === "scenario" && !ids.length && outcome.startsWith("kept:0")) scenarioSkipped = true');
    expect(route).toContain("scenarioSkipped ? SCENARIO_INSUFFICIENT_NOTE");
  });
  it("the stage count of each kept scenario is in the audit, without the route touching an answer key", () => {
    expect(route).toContain("scenarioStages = scenarioStageCounts(r.kept)");
    expect(route).toContain("scenario_stages: scenarioStages");
  });
  it("the audit outcome counts the dropped drafts by the rule's own name", () => {
    expect(route).toContain("const why = [...new Set(r.dropped)].map(x => `${x}:${r.dropped.filter(y => y === x).length}`).join(\"/\");");
    expect(route).toContain("outcome = s.ok ? `kept:${ids.length},dropped:${r.dropped.length}${why ? `(${why})` : \"\"}`");
  });
});
