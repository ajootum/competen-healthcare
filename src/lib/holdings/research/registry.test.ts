import { describe, expect, it } from "vitest";
import { ADAPTERS, SEED_REGISTRY, applyEdit, invocableProviders, notInvocable, resolveRegistry, transitionNeeds, type Registry } from "./registry";
import { DEFAULT_POLICY, resolveWorkflows, workflowNeeds, workflowOperational } from "./engine-config";
import { runResearch, type ResearchPlan } from "./service";
import { researchUsage, summariseResearchUsage } from "./load";
import { toEvidenceRecord } from "./evidence";
import type { FetchLike } from "./providers";

// COMPETEN-RESEARCH-01 ADDENDUM V2: the registry, the lifecycle and the one gate. An inactive provider must be impossible
// to invoke -- proven here by planting the violation and watching no request leave.

const ok = { at: "2026-10-28T00:00:00Z", by: "owner", ok: true, detail: "recorded for the test" };
const CTX = { product: "scholar" as const, activity: "learn" as const, capability: "search" as const };
const active = (ids: string[], patch: Record<string, unknown> = {}): Registry =>
  resolveRegistry(Object.fromEntries(ids.map(id => [id, { ...SEED_REGISTRY[id], status: "active", checks: { connectivity: ok, approval: ok, activation: ok }, ...patch }])));
const plan = (reg: Registry): ResearchPlan => ({ product: "scholar", activity: "learn", registry: reg, policy: DEFAULT_POLICY, workflow: resolveWorkflows({ basic: { status: "active" } }).basic });
const spy = () => { const log: string[] = []; const f: FetchLike = async u => { log.push(u); return { ok: true, status: 200, text: async () => "{}" }; }; return { log, f }; };

describe("seeds: Phase 1 real, Phase 2 and 3 structures only, nothing Active", () => {
  it("every seeded source is Designed or Configured, and only Phase 1 has an adapter", () => {
    const recs = Object.values(SEED_REGISTRY);
    expect(recs.every(r => r.status === "designed" || r.status === "configured")).toBe(true);
    expect(recs.filter(r => r.phase === 1).map(r => r.id).sort()).toEqual([...ADAPTERS].sort());
    expect(recs.filter(r => r.phase > 1).every(r => !(ADAPTERS as readonly string[]).includes(r.id))).toBe(true);
    for (const id of ["europe_pmc", "semantic_scholar", "scite", "elicit", "consensus", "scispace", "dimensions", "researchrabbit", "litmaps", "undermind", "brave_search", "exa", "tavily"]) expect(SEED_REGISTRY[id]).toBeDefined();
  });
  it("a secret is a derived reference, never a value", () => {
    expect(SEED_REGISTRY.semantic_scholar.secretRef).toBe("RESEARCH_KEY_SEMANTIC_SCHOLAR");
    expect(resolveRegistry({ semantic_scholar: { secretRef: "SUPABASE_SERVICE_ROLE_KEY" } }).semantic_scholar.secretRef).toBe("RESEARCH_KEY_SEMANTIC_SCHOLAR");
  });
});

describe("⚠ PLANTED: an inactive provider cannot be invoked", () => {
  it("the seeded registry: no source is invocable, the workflow is not operational, and NO request leaves", async () => {
    const reg = resolveRegistry(null);
    expect(invocableProviders(reg, CTX)).toEqual([]);
    const s = spy();
    await runResearch("oxygen therapy", plan(reg), { fetch: s.f });
    expect(s.log).toEqual([]);
  });
  it("a status typed into the document by hand (no server checks, no owner acts) is not activation", async () => {
    const reg = resolveRegistry({ pubmed: { status: "active" }, openalex: { status: "active" } });
    expect(notInvocable(reg.pubmed, CTX)).toBe("not_integrated");
    const forged = resolveRegistry({ pubmed: { status: "active", checks: { connectivity: ok } } });
    expect(notInvocable(forged.pubmed, CTX)).toBe("not_approved");
    const s = spy();
    await runResearch("oxygen therapy", plan(forged), { fetch: s.f });
    expect(s.log).toEqual([]);
  });
  it("a Phase 2 source forced to Active with every check still has no adapter: never called", async () => {
    const reg = active(["europe_pmc", "semantic_scholar"], { products: ["scholar"], activities: ["learn"] });
    expect(notInvocable(reg.europe_pmc, CTX)).toBe("no_adapter");
    const s = spy();
    await runResearch("oxygen therapy", plan(reg), { fetch: s.f });
    expect(s.log).toEqual([]);
  });
  it("Approved, Paused, Retired, out of dates, wrong product or activity: not invocable", () => {
    for (const status of ["approved", "paused", "retired", "evaluated"]) expect(notInvocable(active(["pubmed"], { status }).pubmed, CTX)).toMatch(/^not_active_/);
    expect(notInvocable(active(["pubmed"], { effectiveFrom: "2999-01-01" }).pubmed, CTX)).toBe("not_yet_effective");
    expect(notInvocable(active(["pubmed"], { effectiveTo: "2001-01-01" }).pubmed, CTX)).toBe("no_longer_effective");
    expect(notInvocable(active(["pubmed"]).pubmed, { ...CTX, product: "practice" })).toBe("product_not_permitted");
    expect(notInvocable(active(["pubmed"]).pubmed, { ...CTX, activity: "exam" })).toBe("activity_not_permitted");
    expect(notInvocable(active(["pubmed"]).pubmed, { ...CTX, capability: "synthesis" })).toBe("capability_not_implemented");
  });
  it("Active and everything in place: invocable, in priority order", () => {
    expect(invocableProviders(active(["openalex", "pubmed"]), CTX).map(r => r.id)).toEqual(["pubmed", "openalex"]);
  });
});

describe("lifecycle: each step names what it needs; owner-only steps are the owner's", () => {
  const r = SEED_REGISTRY.pubmed;
  it("Configured -> Integrated needs the server's connectivity check", () => {
    expect(transitionNeeds(r, "integrated", { isOwner: true })).toEqual(["a passing connectivity check, run by the server"]);
    expect(transitionNeeds({ ...r, checks: { connectivity: ok } }, "integrated", { isOwner: false })).toEqual([]);
  });
  it("a source with no adapter can never be integrated, whatever is recorded", () => {
    const e = { ...SEED_REGISTRY.elicit, status: "configured" as const, checks: { connectivity: ok } };
    expect(transitionNeeds(e, "integrated", { isOwner: true })).toContain("an adapter in code (none exists for this source)");
  });
  it("Approved needs the four checks and the owner; a paid source also needs spend approval", () => {
    const ev = { ...r, status: "evaluated" as const };
    expect(transitionNeeds(ev, "approved", { isOwner: false })).toEqual(expect.arrayContaining(["a platform owner", "the access check recorded", "the licensing check recorded", "the governance check recorded", "the cost check recorded"]));
    const checked = { ...ev, checks: { access: ok, licensing: ok, governance: ok, cost: ok } };
    expect(transitionNeeds(checked, "approved", { isOwner: true })).toEqual([]);
    expect(transitionNeeds({ ...checked, costPerRequestUsd: 0.01 }, "approved", { isOwner: true })).toContain("owner approval of spend for a paid source");
  });
  it("Active only from Approved or Paused, by the owner", () => {
    expect(transitionNeeds({ ...r, status: "evaluated" }, "active", { isOwner: true })).toContain("to be Approved (or Paused) first");
    expect(transitionNeeds({ ...r, status: "approved" }, "active", { isOwner: false })).toContain("a platform owner");
    expect(transitionNeeds({ ...r, status: "approved" }, "active", { isOwner: true })).toEqual([]);
  });
  it("an edit to what was checked sends it back to Configured and clears the checks; a soft edit does not", () => {
    const live = { ...r, status: "active" as const, checks: { connectivity: ok, approval: ok, activation: ok } };
    expect(applyEdit(live, { priority: 3 })).toMatchObject({ demoted: false, record: { status: "active", priority: 3, version: 1 } });
    expect(applyEdit(live, { licensing: "New terms." })).toMatchObject({ demoted: true, record: { status: "configured", checks: {} } });
    expect(applyEdit(live, { status: "active", checks: { approval: ok } } as never).record.status).toBe("active"); // status and checks are not editable
    expect(applyEdit({ ...r, status: "designed" }, { status: "active" } as never).record.status).toBe("designed");
  });
});

describe("workflows: only Basic can be operational, and only once Phase 1 is Active", () => {
  const wfs = resolveWorkflows(null);
  it("nothing is Active by default", () => {
    expect(Object.values(wfs).map(w => w.status)).toEqual(["configured", "designed", "designed", "designed"]);
    expect(workflowOperational(wfs.basic, resolveRegistry(null), { product: "scholar", activity: "learn" })).toBe(false);
  });
  it("Basic needs an Active search source; Comparison, Clinical evidence and Advanced need steps with no code", () => {
    const owner = { product: "scholar" as const, activity: "learn" as const, isOwner: true };
    expect(workflowNeeds(wfs.basic, resolveRegistry(null), owner)).toEqual(expect.arrayContaining(["an Active source providing Literature search"]));
    expect(workflowNeeds(wfs.basic, active(["pubmed"]), owner)).toEqual([]);
    for (const id of ["comparison", "clinical", "advanced"]) expect(workflowNeeds(wfs[id], active(["pubmed", "openalex", "crossref"]), owner).some(n => /no code yet/.test(n))).toBe(true);
  });
  it("a workflow edited to Active in the document is still not operational without what it needs", () => {
    const forged = resolveWorkflows({ advanced: { status: "active" } }).advanced;
    expect(workflowOperational(forged, active(["pubmed"]), { product: "scholar", activity: "learn" })).toBe(false);
  });
});

describe("research usage and cost, apart from AI", () => {
  it("budgets fail closed when usage cannot be read (630 absent)", async () => {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ error: { message: "relation does not exist" } }) }) }), gte: () => ({ limit: async () => ({ error: { message: "x" } }) }) }), insert: async () => ({}) }) };
    const u = researchUsage(admin, { actionId: null, product: "scholar", operation: "individual_scholar_learn_research", workflow: "basic", policy: DEFAULT_POLICY });
    expect(await u.allow(active(["pubmed"]).pubmed)).toBe(false);
    expect(await u.allow({ ...active(["pubmed"]).pubmed, dailyRequestBudget: 0 })).toBe(false);
  });
  it("a budget refusal sends nothing and is recorded as usage", async () => {
    const rows: unknown[] = [];
    const s = spy();
    const r = await runResearch("oxygen therapy", plan(active(["pubmed"])), { fetch: s.f, usage: { record: async row => { rows.push(row); }, allow: async () => false } });
    expect(s.log).toEqual([]);
    expect(r.codes).toContain("pubmed_budget");
    expect(rows).toEqual([expect.objectContaining({ provider: "pubmed", outcome: "budget", requests: 0, costUsd: 0 })]);
  });
  it("each call records its real request count and cost", async () => {
    const rows: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const s = spy();
    await runResearch("oxygen therapy", plan(active(["pubmed"], { costPerRequestUsd: 0.002 })), { fetch: s.f, usage: { record: async row => { rows.push(row); }, allow: async () => true } });
    expect(rows[0]).toMatchObject({ provider: "pubmed", requests: s.log.length, costUsd: +(s.log.length * 0.002).toFixed(4) });
    expect(summariseResearchUsage(rows.map(x => ({ provider: x.provider, requests: x.requests, outcome: x.outcome, latency_ms: x.latencyMs, cost_usd: x.costUsd })))[0]).toMatchObject({ provider: "pubmed", calls: 1 });
  });
});

describe("the common evidence model keeps verified metadata apart from AI interpretation", () => {
  it("Phase 1 records carry no interpretation, and an abstract is never full text", () => {
    const e = toEvidenceRecord({ provider: "pubmed", sourceId: "1", pmid: "1", doi: null, title: "T", journal: "J", year: 2022, authors: [], url: "https://pubmed.ncbi.nlm.nih.gov/1/", abstract: "A", verified: { pmid: true, doi: null }, retrievedAt: "" },
      { question: null, query: "q", strategy: "basic", sourceVersion: "pubmed@v3", licensing: "L" });
    expect(e.interpretation).toBeNull();
    expect(e.verified).toMatchObject({ abstract: "A", fullTextRefs: [], reuse: "private_evidence_excerpt_only", sourceVersion: "pubmed@v3" });
  });
});
