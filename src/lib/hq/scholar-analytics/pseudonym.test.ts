import { describe, expect, it } from "vitest";
import { pseudonymTable, resolvePseudonym, PSEUDONYM_PREFIX } from "./pseudonym";

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

describe("pseudonyms", () => {
  it("are stable for the same salt and change with the salt", () => {
    const a = pseudonymTable(ids, "salt-a"), b = pseudonymTable(ids, "salt-a"), c = pseudonymTable(ids, "salt-b");
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.get(ids[0])).not.toEqual(c.get(ids[0]));
  });
  it("never carry the id, and are unique within the set", () => {
    const t = pseudonymTable(ids, "salt");
    for (const id of ids) { const p = t.get(id)!; expect(p.startsWith(PSEUDONYM_PREFIX)).toBe(true); expect(p).not.toContain(id.slice(0, 8)); expect(/^Learner [0-9A-F]{4,}$/.test(p)).toBe(true); }
    expect(new Set(t.values()).size).toBe(ids.length);
  });
  it("do not depend on the order or duplication of the input", () => {
    expect(pseudonymTable([ids[2], ids[0], ids[0], ids[1]], "s").get(ids[0])).toEqual(pseudonymTable(ids, "s").get(ids[0]));
  });
  it("resolve back, case-insensitively, and never for an unknown label", () => {
    const t = pseudonymTable(ids, "salt");
    const p = t.get(ids[1])!;
    expect(resolvePseudonym(t, p.toLowerCase())).toBe(ids[1]);
    expect(resolvePseudonym(t, "Learner ZZZZ")).toBeNull();
    expect(resolvePseudonym(t, ids[1])).toBeNull();
  });
});
