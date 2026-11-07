import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_SAFE_QUERY, learnResearch, selfSearchLinks } from "./learn-research";
import { DEFAULT_POLICY, type ScholarResearchPolicy } from "../policy";
import { DEFAULT_POLICY as DEFAULT_RESEARCH_POLICY } from "@/lib/holdings/research/engine-config";
import { SEED_REGISTRY } from "@/lib/holdings/research/registry";
import type { ResearchPlan } from "@/lib/holdings/research/service";
import type { IndividualContext } from "../guard";

// Research Search Privacy Alignment: when no subject term is left, nothing goes out, the learner is told and pointed somewhere safe, and it is counted.

const ok = { at: "2026-10-28T00:00:00Z", by: "owner", ok: true, detail: "test" };
const active = (id: "pubmed" | "google_scholar_link") => ({ ...SEED_REGISTRY[id], status: "active", checks: { connectivity: ok, approval: ok, activation: ok } });
function fakeAdmin() {
  const inserts: Record<string, unknown>[] = [];
  const tables: Record<string, unknown> = {
    workspace_config_overrides: [
      { config_path: "research.registry", published: { pubmed: active("pubmed"), google_scholar_link: active("google_scholar_link") } },
      { config_path: "research.workflows", published: { basic: { status: "active" } } },
    ],
  };
  return {
    inserts,
    from: (t: string) => {
      const data = tables[t];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "gte", "lte", "limit", "order"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: Array.isArray(data) ? data[0] ?? null : data ?? null, error: null });
      q.insert = async (row: Record<string, unknown>) => { inserts.push({ table: t, ...row }); return { error: null }; };
      q.upsert = async () => ({ error: null });
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: data ?? [], error: null }).then(res, rej);
      return q;
    },
  };
}
const P: ScholarResearchPolicy = { ...DEFAULT_POLICY.scholarResearch, modes: ["notes", "research"] };

afterEach(() => vi.unstubAllGlobals());

describe("no safe query", () => {
  it("⚠ sends nothing, says why, offers a way that carries nothing, and is counted", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const admin = fakeAdmin();
    const r = await learnResearch({ admin, userId: "u1" } as unknown as IndividualContext, P, { title: "Week 2 notes by Grace Atim", topics: ["Grace Atim"] });
    expect(f).not.toHaveBeenCalled();
    expect(r.state).toBe("refused");
    expect(r.message).toBe(NO_SAFE_QUERY);
    expect(r.codes).toEqual(["query_no_safe_terms"]);
    expect(r.query).toBeNull();
    expect(r.items).toEqual([]);
    expect(r.selfSearch?.map(s => s.label)).toEqual(["PubMed", "Google Scholar"]);
    for (const s of r.selfSearch ?? []) expect(s.url).not.toMatch(/[?#]/);
    expect(JSON.stringify(r)).not.toMatch(/grace|atim/i);
    const usage = admin.inserts.filter(x => x.table === "plat_research_requests");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ provider: "query_guard", outcome: "refused", requests: 0, results: 0, cost_usd: 0 });
    expect(JSON.stringify(usage)).not.toMatch(/grace|atim/i);
  });
  it("⚠ does not use up the learner's research allowance: nothing is written to the audit the limit counts", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const admin = fakeAdmin();
    await learnResearch({ admin, userId: "u1" } as unknown as IndividualContext, P, { title: "Slide 12", topics: [] });
    expect(admin.inserts.map(x => x.table)).toEqual(["plat_research_requests"]);
  });
  it("offers only what the published settings allow", () => {
    const plan = (rule: boolean, registry: Record<string, unknown>) => ({ product: "scholar", activity: "learn", registry, policy: { ...DEFAULT_RESEARCH_POLICY, rules: { ...DEFAULT_RESEARCH_POLICY.rules, scholarLink: rule } }, workflow: undefined }) as unknown as ResearchPlan;
    expect(selfSearchLinks(plan(true, { pubmed: active("pubmed"), google_scholar_link: active("google_scholar_link") })).map(s => s.label)).toEqual(["PubMed", "Google Scholar"]);
    expect(selfSearchLinks(plan(false, { pubmed: active("pubmed"), google_scholar_link: active("google_scholar_link") })).map(s => s.label)).toEqual(["PubMed"]);
    expect(selfSearchLinks(plan(true, { pubmed: { ...active("pubmed"), status: "configured" }, google_scholar_link: { ...active("google_scholar_link"), status: "configured" } }))).toEqual([]);
  });
});

describe("wiring", () => {
  const src = readFileSync("src/lib/individual/scholar/learn-research.ts", "utf8");
  it("⚠ the old keyword fallback is gone from the lesson query: there is no second way out", () => {
    expect(src).not.toMatch(/\bresearchQuery\(/);
    expect(src).not.toMatch(/buildResearchQuery\(/);
    expect(src).toMatch(/isSubjectQuery\(query\)/);
  });
  it("⚠ every Scholar search still passes the one query", () => {
    expect(src).toMatch(/const q = lessonQuery\(input\);/);
    expect(src).toMatch(/runResearch\(q\.query, plan,/);
  });
  it("the learner's reply carries the offer", () => {
    expect(readFileSync("src/app/api/individual/scholar/learn/act/route.ts", "utf8")).toMatch(/selfSearch: research\.selfSearch/);
  });
});
