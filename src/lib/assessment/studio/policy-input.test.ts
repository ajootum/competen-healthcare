import { describe, expect, it } from "vitest";
import { parseNewPolicy, parsePolicyPatch } from "./policy-input";

const vocab = { types: ["alpha", "beta"], scopes: ["one", "two"] } as const;

describe("parseNewPolicy", () => {
  it("accepts a minimal policy and trims the title", () => {
    const r = parseNewPolicy({ title: "  Hand hygiene  ", policyType: "alpha" }, vocab);
    expect(r).toEqual({ ok: true, value: { title: "Hand hygiene", policyType: "alpha", scope: undefined, description: null, summary: null, content: "" } });
  });
  it("keeps a given scope, description, summary and text", () => {
    const r = parseNewPolicy({ title: "Abc", policyType: "beta", scope: "two", description: "d", summary: "s", content: "text" }, vocab);
    expect(r.ok && r.value).toMatchObject({ scope: "two", description: "d", summary: "s", content: "text" });
  });
  it("treats an empty scope as not given", () => {
    const r = parseNewPolicy({ title: "Abc", policyType: "alpha", scope: "" }, vocab);
    expect(r.ok && r.value.scope).toBeUndefined();
  });
  it.each([
    [null], ["x"], [[]], [{}], [{ title: "ab", policyType: "alpha" }], [{ title: "Abc", policyType: "gamma" }], [{ title: "Abc" }],
    [{ title: "Abc", policyType: "alpha", scope: "three" }], [{ title: "Abc", policyType: "alpha", content: 5 }], [{ title: "a".repeat(201), policyType: "alpha" }],
    [{ title: "Abc", policyType: "alpha", content: "x".repeat(200_001) }],
  ])("refuses %j", (body) => {
    expect(parseNewPolicy(body, vocab).ok).toBe(false);
  });
});

describe("parsePolicyPatch", () => {
  it("accepts any subset", () => {
    expect(parsePolicyPatch({ content: "new" })).toEqual({ ok: true, value: { content: "new" } });
    expect(parsePolicyPatch({ title: "Abc", summary: null, effectiveFrom: "2027-01-31", reviewDue: "" })).toEqual({ ok: true, value: { title: "Abc", summary: null, effectiveFrom: "2027-01-31", reviewDue: null } });
  });
  it("lets the text be emptied", () => {
    expect(parsePolicyPatch({ content: "" })).toEqual({ ok: true, value: { content: "" } });
  });
  it.each([
    [null], [[]], [{}], [{ title: "ab" }], [{ title: 3 }], [{ summary: 4 }], [{ content: 4 }], [{ effectiveFrom: "31/01/2027" }], [{ effectiveFrom: "2027-02-30" }], [{ reviewDue: 20270101 }],
  ])("refuses %j", (body) => {
    expect(parsePolicyPatch(body).ok).toBe(false);
  });
});
