/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { classificationProblems, professionsOf, validateBlueprint, type Blueprint } from "./blueprint";
import { resolveCasePolicy, DEFAULT_CASE_POLICY, CASE_POLICY_PATH, CASE_SCOPE } from "./policy";
import { caseMatches } from "./library";
import { saveDraft, submitCase } from "./studio";
import { MINIMAL_S4 } from "./fixtures";

// CASE CLASSIFICATION (owner, Stage 5B case classification decision): several professions, specialties, CFCA domains,
// CPUs, competencies with their recorded learning outcomes, and proficiency levels -- references to the existing
// catalogue, optional while drafting, required only as the case policy says and only at submission, and the exact
// content of each competency recorded into the version the reviewer approves.

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const COMP = U(1), PROF_A = U(11), PROF_B = U(12), SPEC = U(21), DOM = U(31), PRAC = U(32), CPU = U(41), LEVEL = U(51), FW = U(61), SCALE = U(71);
const EDU = U(91), VERSION = U(92);

const LIBRARY: Blueprint = {
  ...MINIMAL_S4,
  decisionPoints: MINIMAL_S4.decisionPoints.map(d => ({ ...d, dimension: "recognition" })),
  summary: "A deteriorating ward patient.", learnerIntro: "You are called to bay 3.",
  patient: { ageBand: "60-69", sex: "unspecified", setting: "Medical ward", presentingComplaint: "Breathless", background: [] },
  learningObjectives: [{ id: "lo", text: "Recognise deterioration", competencyIds: [COMP] }],
  feedback: { debrief: "Escalate early.", onSafetyEvent: "Never wait." },
  metadata: { ...MINIMAL_S4.metadata, provenance: { kind: "educator", rights: "educator_original" } },
};
const classified = (over: Partial<Blueprint["metadata"]> = {}, refs: any[] = []): any => ({
  ...LIBRARY,
  learningObjectives: [{ ...LIBRARY.learningObjectives[0], outcomeRefs: refs }],
  metadata: { ...LIBRARY.metadata, ...over },
});

describe("classification in the blueprint: well-formed references, optional while drafting", () => {
  it("control: the fixture is a complete library case, so every problem below is the classification's", () => {
    expect(validateBlueprint(LIBRARY, "library")).toEqual([]);
  });

  it("several of each is accepted, and nothing at all is accepted too (a draft may be incomplete)", () => {
    const full = classified({ professionTermIds: [PROF_A, PROF_B], specialtyTermIds: [SPEC], cfcaDomainIds: [DOM], cpuIds: [CPU], proficiencyLevelIds: [LEVEL] }, [{ competencyId: COMP, index: 0 }]);
    expect(validateBlueprint(full, "library")).toEqual([]);
    expect(validateBlueprint(LIBRARY, "library")).toEqual([]);
    expect(validateBlueprint(MINIMAL_S4, "private")).toEqual([]);            // Scholar's private cases are untouched
  });

  it("a reference that is not a catalogue identifier, or an outcome of a competency the objective does not name, is a problem", () => {
    expect(validateBlueprint(classified({ cpuIds: ["Oxygen safety"] as any }), "library").join(" ")).toMatch(/cpuIds must be catalogue identifiers/);
    expect(validateBlueprint(classified({ professionTermId: "nurse" as any }), "library").join(" ")).toMatch(/professionTermId must be a catalogue identifier/);
    expect(validateBlueprint(classified({}, [{ competencyId: U(2), index: 0 }]), "library").join(" ")).toMatch(/learning outcome must belong to a competency the objective names/);
    expect(validateBlueprint(classified({}, [{ competencyId: COMP, index: -1 }]), "library").join(" ")).toMatch(/learning outcome must belong/);
    expect(validateBlueprint(classified({ competencyVersions: [{ competencyId: COMP, contentHash: "typed by hand" }] }), "library").join(" ")).toMatch(/competencyVersions/);
  });

  it("every profession counts, the single legacy field folded in once", () => {
    expect(professionsOf({ professionTermIds: [PROF_A, PROF_B], professionTermId: PROF_A })).toEqual([PROF_A, PROF_B]);
    expect(professionsOf({ professionTermId: PROF_B })).toEqual([PROF_B]);
    expect(professionsOf({ professionTermIds: ["x"], professionTermId: null })).toEqual([]);
  });
});

describe("completeness is the case policy's, at submission only", () => {
  it("nothing is required by default beyond competencies, which the database already insists on", () => {
    expect(DEFAULT_CASE_POLICY.classificationRequired.competencies).toBe(true);
    expect(Object.entries(DEFAULT_CASE_POLICY.classificationRequired).filter(([k, v]) => v && k !== "competencies")).toEqual([]);
    expect(classificationProblems(LIBRARY, DEFAULT_CASE_POLICY.classificationRequired)).toEqual([]);
  });

  it("a published requirement names what is missing, and is met once it is there", () => {
    const req = resolveCasePolicy({ classificationRequired: { professions: true, cpus: true, learningOutcomes: true } }).classificationRequired;
    expect(classificationProblems(LIBRARY, req)).toEqual([
      "classification: at least one profession (required by the case policy)",
      "classification: at least one Competency Practice Unit (CPU) (required by the case policy)",
      "classification: at least one recorded learning outcome (required by the case policy)",
    ]);
    expect(classificationProblems(classified({ professionTermIds: [PROF_A], cpuIds: [CPU] }, [{ competencyId: COMP, index: 0 }]), req)).toEqual([]);
  });

  it("competencies cannot be switched off, and anything but true is not a requirement", () => {
    const r = resolveCasePolicy({ classificationRequired: { competencies: false, professions: "yes", specialties: 1 } }).classificationRequired;
    expect(r.competencies).toBe(true);
    expect(r.professions).toBe(false);
    expect(r.specialties).toBe(false);
  });
});

describe("library search: a case may be for several professions", () => {
  it("matches any of its professions, and a case with none matches every profession (as before)", () => {
    const v = (md: any) => ({ content: { ...LIBRARY, metadata: { ...LIBRARY.metadata, ...md } }, level: "foundation", competencyIds: [COMP] });
    expect(caseMatches(v({ professionTermIds: [PROF_A, PROF_B], professionTermId: PROF_A }), { context: { professionTermId: PROF_B } })).toBe(true);
    expect(caseMatches(v({ professionTermIds: [PROF_A], professionTermId: PROF_A }), { context: { professionTermId: PROF_B } })).toBe(false);   // control
    expect(caseMatches(v({}), { context: { professionTermId: PROF_B } })).toBe(true);
  });
});

// ── The studio against an in-memory database: what is saved, what is refused, what is recorded ─────────────────

function fakeAdmin(draft: any, policy: any = null) {
  const tables: Record<string, any[]> = {
    case_library_version: [{ id: VERSION, state: "draft", authored_by: [EDU], origin_kind: null, risk: "standard", content: draft }],
    case_library_version_competency: [],
    workspace_config_overrides: policy ? [{ scope_type: CASE_SCOPE.scopeType, scope_ref: CASE_SCOPE.scopeRef, config_path: CASE_POLICY_PATH, published: policy }] : [],
    taxonomies: [{ id: U(81), kind: "profession" }, { id: U(82), kind: "specialty" }],
    taxonomy_terms: [{ id: PROF_A, taxonomy_id: U(81), value: "Nursing", code: null }, { id: PROF_B, taxonomy_id: U(81), value: "Midwifery", code: null }, { id: SPEC, taxonomy_id: U(82), value: "Acute care", code: null }],
    frameworks: [{ id: FW, code: "CFCA", name: "CFCA", hospital_id: null }],
    framework_domains: [{ id: DOM, framework_id: FW, code: "D1", name: "Deterioration" }],
    practices: [{ id: PRAC, domain_id: DOM }],
    clinical_practice_units: [{ id: CPU, practice_id: PRAC, code: "CPU-1", name: "Early warning" }],
    framework_scoring: [], scoring_scales: [{ id: SCALE, name: "Default", is_default: true }],
    scoring_levels: [{ id: LEVEL, scale_id: SCALE, score: 3, label: "Competent" }],
    framework_competencies: [{ id: COMP, learning_outcomes: ["Explains early warning signs"] }],
  };
  const rpcs: { fn: string; args: any }[] = [];
  const from = (t: string) => {
    let op: "select" | "update" | "insert" | "delete" = "select"; let payload: any = null; const where: ((r: any) => boolean)[] = [];
    const run = async () => {
      const rows = (tables[t] ?? []).filter(r => where.every(f => f(r)));
      if (op === "update") rows.forEach(r => Object.assign(r, payload));
      if (op === "insert") (tables[t] ??= []).push(...[].concat(payload));
      if (op === "delete") tables[t] = (tables[t] ?? []).filter(r => !rows.includes(r));
      return { data: op === "insert" ? [].concat(payload) : rows, error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (c: string, v: any) => (where.push(r => r[c] === v), q),
      in: (c: string, vs: any[]) => (where.push(r => vs.includes(r[c])), q),
      is: (c: string, v: any) => (where.push(r => (r[c] ?? null) === v), q),
      update: (p: any) => ((op = "update"), (payload = p), q), insert: (p: any) => ((op = "insert"), (payload = p), q), delete: () => ((op = "delete"), q),
      maybeSingle: async () => { const r = await run(); return { data: r.data[0] ?? null, error: null }; },
      then: (ok: any, bad: any) => run().then(ok, bad),
    };
    return q;
  };
  const rpc = async (fn: string, args: any) => {
    rpcs.push({ fn, args });
    if (fn === "competency_content_hashes") return { data: args.p_ids.map((id: string) => ({ competency_id: id, content_hash: "0123456789abcdef0123456789abcdef" })), error: null };
    if (fn === "case_library_submit") return { data: U(99), error: null };
    return { data: null, error: null };
  };
  return { admin: { from, rpc } as any, tables, rpcs, row: () => tables.case_library_version[0] };
}

describe("the studio: optional while drafting, checked and recorded at submission", () => {
  it("a draft saves with no classification at all, and keeps the single profession field the first of the list", async () => {
    const f = fakeAdmin(LIBRARY);
    expect((await saveDraft(f.admin, EDU, VERSION, LIBRARY)).ok).toBe(true);
    const r = await saveDraft(f.admin, EDU, VERSION, classified({ professionTermIds: [PROF_B, PROF_A], professionTermId: null }));
    expect(r.ok).toBe(true);
    expect(f.row().content.metadata.professionTermIds).toEqual([PROF_B, PROF_A]);
    expect(f.row().content.metadata.professionTermId).toBe(PROF_B);
  });

  it("an editor can never write the competency-content record, and an unknown reference is reported, not refused, while drafting", async () => {
    const f = fakeAdmin(LIBRARY);
    const r: any = await saveDraft(f.admin, EDU, VERSION, classified({ cpuIds: [U(404)], competencyVersions: [{ competencyId: COMP, contentHash: "ffffffffffffffffffffffffffffffff" }] }));
    expect(r.ok).toBe(true);
    expect(f.row().content.metadata.competencyVersions).toBeUndefined();
    expect(r.problems.join(" ")).toMatch(/1 cpus reference is not in the catalogue/);
  });

  it("control: a fully classified draft from the catalogue has no reference problems", async () => {
    const f = fakeAdmin(LIBRARY);
    const r: any = await saveDraft(f.admin, EDU, VERSION, classified({ professionTermIds: [PROF_A], specialtyTermIds: [SPEC], cfcaDomainIds: [DOM], cpuIds: [CPU], proficiencyLevelIds: [LEVEL] }, [{ competencyId: COMP, index: 0 }]));
    expect(r.problems).toEqual([]);
  });

  it("submission refuses what the published policy requires and the draft lacks, and submits nothing", async () => {
    const f = fakeAdmin(LIBRARY, { classificationRequired: { professions: true } });
    const r: any = await submitCase(f.admin, EDU, VERSION);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain("classification: at least one profession (required by the case policy)");
    expect(f.rpcs.some(x => x.fn === "case_library_submit")).toBe(false);
  });

  it("submission refuses an outcome its competency does not record, and a reference outside the catalogue", async () => {
    const f = fakeAdmin(classified({ specialtyTermIds: [U(405)] }, [{ competencyId: COMP, index: 3 }]));
    const r: any = await submitCase(f.admin, EDU, VERSION);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/specialties reference is not in the catalogue/);
    expect(r.problems.join(" ")).toMatch(/a learning outcome its competency does not record/);
    expect(f.rpcs.some(x => x.fn === "case_library_submit")).toBe(false);
  });

  it("a submitted case carries the exact content of each competency it teaches, written before 422 freezes and hashes it", async () => {
    const f = fakeAdmin(classified({ professionTermIds: [PROF_A] }), { classificationRequired: { professions: true } });
    const r: any = await submitCase(f.admin, EDU, VERSION);
    expect(r.ok).toBe(true);
    expect(f.row().content.metadata.competencyVersions).toEqual([{ competencyId: COMP, contentHash: "0123456789abcdef0123456789abcdef" }]);
    const order = f.rpcs.map(x => x.fn);
    expect(order.indexOf("competency_content_hashes")).toBeLessThan(order.indexOf("case_library_submit"));
  });
});
