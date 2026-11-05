import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ reads: [] as string[], users: [] as string[], fail: new Set<string>() }));

vi.mock("./record", () => ({
  loadProfessionalRecord: async (_a: unknown, u: string) => {
    h.reads.push("record"); h.users.push(u);
    if (h.fail.has("record")) return { provisioned: true, profile: null, needs: null, goals: null, cpd: null, evidence: null };
    return {
      provisioned: true, profile: undefined,
      needs: [{ id: "n1", title: "Sepsis recognition", detail: null, status: "open" }],
      goals: [{ id: "g1", title: "Complete an ALS course", detail: null, status: "planned", target_date: "2027-01-31" }],
      cpd: [{ id: "c1", title: "Sepsis study day", provider: "Royal College", activity_type: "course", activity_date: "2026-03-02" }],
      evidence: [
        { id: "e1", kind: "credential", title: "ALS certificate", issuing_body: "Resus Council", detail: null, document_name: null },
        { id: "e2", kind: "competency", title: "Sepsis audit", issuing_body: null, detail: "Led a ward audit", document_name: null },
      ],
    };
  },
}));
vi.mock("./competency-store", () => ({
  loadCompetencyWorkspace: async (_a: unknown, u: string) => {
    h.reads.push("competencies"); h.users.push(u);
    return h.fail.has("competencies") ? { provisioned: true, entries: null } : { provisioned: true, entries: [
      { id: "m1", title: "Recognising sepsis", description: null, category_label: "Clinical", removed_at: null },
      { id: "m2", title: "Sepsis old", description: null, category_label: null, removed_at: "2026-01-01" },
    ] };
  },
}));
vi.mock("./profile-store", () => ({
  loadProfessionalProfile: async (_a: unknown, u: string) => {
    h.reads.push("registration"); h.users.push(u);
    return { provisioned: true, items: [
      { id: "p1", section: "registration", title: "Sepsis nurse register", type_label: null, organisation: "NMC", superseded_at: null, withdrawn_at: null },
      { id: "p2", section: "qualification", title: "Sepsis diploma", type_label: null, organisation: null, superseded_at: null, withdrawn_at: null },
      { id: "p3", section: "registration", title: "Sepsis withdrawn", type_label: null, organisation: null, superseded_at: null, withdrawn_at: "2026-01-01" },
    ] };
  },
}));

import { parseProfessionalQuery, professionalGlobalSearch } from "./global-search";
import type { ProfessionalSearchKey } from "../search/registry-professional";

const ALL = new Set<ProfessionalSearchKey>(["registration", "development", "cpd", "evidence", "competencies"]);
const run = (modules: Set<ProfessionalSearchKey>, q = "sepsis") => professionalGlobalSearch({ admin: {}, userId: "u1" }, { modules }, q);
beforeEach(() => { h.reads = []; h.users = []; h.fail = new Set(); });

describe("professionalGlobalSearch", () => {
  it("parses a query", () => {
    expect(parseProfessionalQuery("a")).toBeNull();
    expect(parseProfessionalQuery("  sepsis   care ")).toBe("sepsis care");
  });
  it("covers each Professional record type, with paths below /individual/professional", async () => {
    const groups = await run(ALL);
    const labels = groups.flatMap(g => g.types.map(t => t.label)).sort();
    expect(labels).toEqual(["CPD entries", "Competencies", "Competency evidence", "Development needs", "Profile records"]);
    const paths = groups.flatMap(g => g.types.flatMap(t => t.results.map(r => r.path)));
    expect(paths).toEqual(expect.arrayContaining(["competencies?c=m1#competency", "development?need=n1#needs-h", "registration#sec-reg"]));
    expect(paths.every(p => !p.startsWith("/") && !p.startsWith("study"))).toBe(true);
  });
  it("leaves out removed, withdrawn and non-practice records", async () => {
    const groups = await run(ALL);
    const titles = groups.flatMap(g => g.types.flatMap(t => t.results.map(r => r.title)));
    expect(titles).not.toContain("Sepsis old");
    expect(titles).not.toContain("Sepsis withdrawn");
    expect(titles).not.toContain("Sepsis diploma");
  });
  it("reads only with the signed-in person's id", async () => {
    await run(ALL);
    expect(new Set(h.users)).toEqual(new Set(["u1"]));
  });
  it("never reads a module that is refused, and sends nothing about it", async () => {
    const groups = await run(new Set<ProfessionalSearchKey>(["cpd"]));
    expect(groups.map(g => g.module)).toEqual(["cpd"]);
    expect(h.reads).toEqual(["record"]);
    expect(await run(new Set())).toEqual([]);
    expect(h.reads).toEqual(["record"]);
  });
  it("says a source failed rather than showing nothing found", async () => {
    h.fail.add("competencies"); h.fail.add("record");
    const groups = await run(ALL);
    expect(groups.find(g => g.module === "competencies")).toMatchObject({ unreadable: true, types: [] });
    expect(groups.find(g => g.module === "cpd")).toMatchObject({ unreadable: true });
    expect(groups.find(g => g.module === "registration")).toMatchObject({ unreadable: false });
  });
});
