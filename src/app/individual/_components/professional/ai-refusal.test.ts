import { describe, expect, it } from "vitest";
import { aiNotice } from "./ai-refusal";

// A Professional AI refusal says what the server said, and when the allowance is used it says what still works.

describe("aiNotice", () => {
  it("uses the server's words, with a fallback when there are none", () => {
    expect(aiNotice({ error: "This needs an active subscription." }, "x")).toEqual({ text: "This needs an active subscription.", continuity: false });
    expect(aiNotice({}, "The assistant could not answer just now.")).toEqual({ text: "The assistant could not answer just now.", continuity: false });
    expect(aiNotice(null, "Fallback.")).toEqual({ text: "Fallback.", continuity: false });
  });

  it("on Continuity, says the record stays usable, and flags it so the allowance link shows", () => {
    const n = aiNotice({ error: "Your AI allowance for this period is used.", continuity: true, standing: { level: "continuity" } }, "x");
    expect(n.continuity).toBe(true);
    expect(n.text).toBe("Your AI allowance for this period is used. Your goals, CPD and evidence stay available and can still be edited by hand.");
    expect(aiNotice({ error: "Used.", standing: { level: "continuity" } }, "x").continuity).toBe(true);
  });
});

describe("HFE-01 Wave 1: the shared reason words", () => {
  it("an unpublished policy says AI is not switched on yet, never 'not offered'", () => {
    const n = aiNotice({ error: "AI help is not switched on for Competen Individual yet.", code: "policy_unpublished" }, "x");
    expect(n.text).toMatch(/not switched on for Competen Individual yet/);
    expect(n.text).not.toMatch(/not offered/);
    expect(n.next).toBeNull();
  });
  it("an unsupported activity names the product; an unreadable check asks to retry", () => {
    expect(aiNotice({ error: "This AI activity is not offered.", code: "unknown_activity" }, "x").text).toBe("This kind of AI help is not offered in Competen Professional yet.");
    expect(aiNotice({ code: "unreadable" }, "x").text).toMatch(/could not be checked just now/);
  });
});
