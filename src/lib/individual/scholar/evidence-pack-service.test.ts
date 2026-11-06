import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_REGISTRY, resolveRegistry } from "@/lib/holdings/research/registry";
import { resolveWorkflows } from "@/lib/holdings/research/engine-config";
import { DEFAULT_QUALITY } from "./source-quality";
import { PACK_BUILDING_PROVIDER } from "./evidence-pack";
import { prepareEvidencePack } from "./evidence-pack-service";

vi.mock("./http", () => ({ audit: vi.fn(async (_c: unknown, _a: unknown, _e: unknown, _id: unknown, value: unknown) => { audits.push(value); }) }));
const audits: unknown[] = [];

/** An in-memory admin: the research documents, the shared row table and the two counters the pack reads. */
function makeAdmin(opts: { active?: string[]; workflow?: string } = {}) {
  const stamp = { at: "2026-11-06T00:00:00Z", by: "t", ok: true, detail: "t" };
  const active = opts.active ?? ["pubmed", "openalex", "crossref", "pmc"];
  const registry = Object.fromEntries(active.map(id => [id, { ...SEED_REGISTRY[id], status: "active", checks: { connectivity: stamp, approval: stamp, activation: stamp } }]));
  const docs = [
    { config_path: "research.registry", published: registry },
    { config_path: "research.workflows", published: { basic: { status: opts.workflow ?? "active" } } },
    { config_path: "research.policy", published: {} },
  ];
  const rows = new Map<string, Record<string, unknown>>();
  const usage: Record<string, unknown>[] = [];
  const from = (table: string) => {
    if (table === "workspace_config_overrides") return { select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: docs, error: null }) }) }) }) };
    if (table === "plat_research_requests") return {
      insert: async (r: Record<string, unknown>) => { usage.push(r); return { error: null }; },
      select: () => { const q = { eq: () => q, gte: () => q, limit: async () => ({ data: [], error: null }) }; return q; },
    };
    if (table === "individual_scholar_research_cache") return {
      select: () => ({ eq: (_c: string, k: string) => ({ maybeSingle: async () => ({ data: rows.get(k) ?? null, error: null }) }) }),
      upsert: (r: Record<string, unknown>, o: { ignoreDuplicates?: boolean }) => {
        const k = r.query_hash as string, had = rows.has(k);
        if (!(had && o.ignoreDuplicates)) rows.set(k, r);
        return { select: async () => ({ data: had && o.ignoreDuplicates ? [] : [{ query_hash: k }], error: null }), then: (f: (v: unknown) => unknown) => Promise.resolve(f({ error: null })) };
      },
      update: (f: Record<string, unknown>) => {
        let key = "", cut: string | null = null, prov: string | null = null;
        const apply = () => { const x = rows.get(key); if (x && (!cut || (x.expires_at as string) <= cut) && (!prov || x.provider === prov)) { rows.set(key, { ...x, ...f }); return [{ query_hash: key }]; } return []; };
        const q = { eq: (c: string, v: string) => { if (c === "query_hash") key = v; else prov = v; return q; }, lte: (_c: string, v: string) => { cut = v; return q; }, select: async () => ({ data: apply(), error: null }), then: (fn: (v: unknown) => unknown) => { apply(); return Promise.resolve(fn({ error: null })); } };
        return q;
      },
    };
    throw new Error(`unexpected table ${table}`);
  };
  return { admin: { from }, rows, usage, docs };
}

// The counters: unread by these tests except where one is set.
const counters = vi.hoisted(() => ({ count: 0 as number | null, spend: 0 as number | null }));
vi.mock("./store", async orig => ({ ...(await orig() as object), learnResearchToday: async () => counters.count, aiSpendToday: async () => counters.spend }));

const summary = (ids: string[]) => JSON.stringify({ result: Object.fromEntries(ids.map(id => [id, { uid: id, title: `Sensitive periods and critical period development in infants ${id}`, fulljournalname: "Dev Rev", pubdate: "2022", authors: [{ name: "Ng A" }], articleids: [{ idtype: "doi", value: `10.1000/${id}` }], pubtype: ["Review"] }])) });
const efetch = (ids: string[]) => `<PubmedArticleSet>${ids.map(id => `<PubmedArticle><PMID>${id}</PMID><Abstract><AbstractText>Sensitive period and critical period development in infants, abstract ${id}.</AbstractText></Abstract></PubmedArticle>`).join("")}</PubmedArticleSet>`;

function net(over: (u: string) => string | null = () => null) {
  const urls: string[] = [];
  let id = 100;
  const fetchMock = async (url: string) => {
    urls.push(url);
    const o = over(url);
    if (o !== null) return { ok: true, status: 200, text: async () => o };
    if (url.includes("esearch")) { const ids = [String(id++), String(id++)]; return { ok: true, status: 200, text: async () => JSON.stringify({ esearchresult: { idlist: ids } }) }; }
    if (url.includes("esummary")) { const ids = /id=([\d,]+)/.exec(url)![1].split(","); return { ok: true, status: 200, text: async () => summary(ids) }; }
    if (url.includes("efetch")) { const ids = /id=([\d,]+)/.exec(url)![1].split(","); return { ok: true, status: 200, text: async () => efetch(ids) }; }
    if (url.includes("crossref")) { const doi = decodeURIComponent(/works\/([^?]+)/.exec(url)![1]); const pmid = doi.split("/")[1]; return { ok: true, status: 200, text: async () => JSON.stringify({ message: { title: [`Sensitive periods and critical period development in infants ${pmid}`], issued: { "date-parts": [[2022]] } } }) }; }
    if (url.includes("idconv")) return { ok: true, status: 200, text: async () => JSON.stringify({ records: [] }) };
    throw new Error(`unexpected ${url}`);
  };
  return { urls, fetch: fetchMock };
}

const lesson = { headings: ["Mrs Nambi: critical periods at Mulago"], body: ["A critical period begins quickly. A sensitive period begins gradually. Peter Okello, age 72."] };
const policy = { research: { dailyMax: 5, relevance: "standard" as const }, teach: { on: true, maxSearches: 4, dailyCostCents: 100 }, quality: DEFAULT_QUALITY };
const ctxOf = (admin: unknown, userId = "learner-1") => ({ admin, userId, profile: { fullName: "x" } }) as never;

describe("prepareEvidencePack", () => {
  beforeEach(() => { counters.count = 0; counters.spend = 0; audits.length = 0; });
  const load = async () => prepareEvidencePack;

  it("is off when the engine is not operational, and sends nothing", async () => {
    const { admin } = makeAdmin({ workflow: "configured" }), n = net();
    const p = await (await load())(ctxOf(admin), policy, { lesson, actionId: null, search: true }, { fetch: n.fetch as never });
    expect(p.state).toBe("off");
    expect(n.urls).toEqual([]);
  });

  it("a first Teach Me searches: only constants leave, never a word of the lesson", async () => {
    const { admin } = makeAdmin(), n = net();
    const p = await (await load())(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: n.fetch as never });
    expect(p.state).toBe("ready");
    expect(p.items.length).toBeGreaterThan(0);
    expect(p.searched).toBe(1);
    const all = decodeURIComponent(n.urls.join(" "));
    expect(all).not.toMatch(/nambi|mulago|okello|peter|\b72\b|learner-1/i);
    expect(all).toContain('"Critical Period, Psychological"[mh]');
  });

  it("OpenAlex is not called, even Active: the pack uses the free sources only", async () => {
    const { admin } = makeAdmin(), n = net();
    await (await load())(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: n.fetch as never });
    expect(n.urls.some(u => u.includes("openalex"))).toBe(false);
  });

  it("the shared row holds citations and no abstract text", async () => {
    const { admin, rows } = makeAdmin(), n = net();
    await (await load())(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: n.fetch as never });
    const stored = JSON.stringify([...rows.values()]);
    expect(stored).toContain("10.1000/");
    expect(stored).not.toContain("abstract 10");
    expect(stored).not.toContain("learner-1");
    expect(stored).not.toMatch(/nambi|mulago|okello/i);
  });

  it("a second learner on the same topic makes no search: only the abstracts are read, by PMID", async () => {
    const { admin } = makeAdmin(), first = net(), second = net();
    const prepare = await load();
    await prepare(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: first.fetch as never });
    const p = await prepare(ctxOf(admin, "learner-2"), policy, { lesson: { headings: ["Critical periods"], body: ["A sensitive period and a critical period."] }, actionId: "b", search: true }, { fetch: second.fetch as never });
    expect(p.searched).toBe(0);
    expect(p.reused).toBe(1);
    expect(second.urls.every(u => u.includes("efetch"))).toBe(true);
    expect(second.urls).toHaveLength(1);
    expect(p.items.every(i => !!i.abstract)).toBe(true);
    expect(p.complete).toBe(true);
  });

  it("two learners at the same moment make one search", async () => {
    const { admin } = makeAdmin(), a = net(), b = net();
    const prepare = await load();
    const [x, y] = await Promise.all([
      prepare(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: a.fetch as never }),
      prepare(ctxOf(admin, "learner-2"), policy, { lesson, actionId: "b", search: true }, { fetch: b.fetch as never }),
    ]);
    const esearches = [...a.urls, ...b.urls].filter(u => u.includes("esearch"));
    expect(esearches).toHaveLength(1);
    expect(x.searched + y.searched).toBe(1);
    // The one who waited gets the result too, rather than a lesson without research.
    expect(x.items.length).toBeGreaterThan(0);
    expect(y.items.length).toBeGreaterThan(0);
  });

  it("a prepared lesson never searches", async () => {
    const { admin } = makeAdmin(), n = net();
    const p = await (await load())(ctxOf(admin), policy, { lesson, actionId: null, search: false }, { fetch: n.fetch as never });
    expect(n.urls).toEqual([]);
    expect(p.complete).toBe(false);
  });

  it("a source that fails costs the research, never the lesson: no throw, and the topic is free to try again", async () => {
    const { admin, rows } = makeAdmin(), n = { urls: [] as string[], fetch: async () => { throw new Error("down"); } };
    const p = await (await load())(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: n.fetch as never });
    expect(p.state).toBe("failed");
    expect(p.items).toEqual([]);
    const row = [...rows.values()][0];
    expect(row.provider).toBe(PACK_BUILDING_PROVIDER);
    expect((row.sources as unknown[]).length).toBe(0);
    expect(new Date(row.expires_at as string).getTime()).toBeLessThan(Date.now() + 5000);
  });

  it("records with no abstract mean PubMed's abstract read failed: not remembered as nothing, so the next learner may try", async () => {
    const { admin, rows } = makeAdmin(), n = net(u => (u.includes("efetch") ? "<bad/>" : null));
    const p = await prepareEvidencePack(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: n.fetch as never });
    expect(p.state).toBe("failed");
    const row = [...rows.values()][0];
    expect(row.provider).toBe(PACK_BUILDING_PROVIDER);
    expect(new Date(row.expires_at as string).getTime()).toBeLessThan(Date.now() + 5000);
  });

  it("a lesson the closed list does not know makes no search", async () => {
    const { admin } = makeAdmin(), n = net();
    const p = await (await load())(ctxOf(admin), policy, { lesson: { headings: ["Mrs Nambi's favourite song"], body: ["la la la"] }, actionId: "a", search: true }, { fetch: n.fetch as never });
    expect(p.state).toBe("no_topic");
    expect(n.urls).toEqual([]);
  });

  it("at the learner's daily count, what is already shared is used and nothing new is searched", async () => {
    counters.count = 5;
    const { admin } = makeAdmin(), n = net();
    const p = await (await load())(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: n.fetch as never });
    expect(n.urls).toEqual([]);
    expect(p.codes).toContain("limit_count");
  });

  it("at the learner's spend limit there is no pack, and an unreadable limit fails closed", async () => {
    counters.spend = 2;
    const { admin } = makeAdmin(), n = net();
    expect((await (await load())(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: n.fetch as never })).state).toBe("limit");
    counters.spend = null;
    expect((await (await load())(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: n.fetch as never })).state).toBe("failed");
    expect(n.urls).toEqual([]);
  });

  it("each reference says what was read, and only cited ones are given", async () => {
    const { admin } = makeAdmin(), n = net();
    const p = await (await load())(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: n.fetch as never });
    const refs = p.references([1]);
    expect(refs).toHaveLength(1);
    expect(refs[0].tag).toBe("E1");
    expect(refs[0].accessed).toBe("abstract");
    expect(refs[0].studyKind).toBe("narrative review");
    expect(refs[0].pmid).toBeTruthy();
  });

  it("the audit row holds counts, codes and list entries, never words of the lesson", async () => {
    const { admin } = makeAdmin(), n = net();
    await (await load())(ctxOf(admin), policy, { lesson, actionId: "a", search: true }, { fetch: n.fetch as never });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toMatch(/nambi|mulago|okello/i);
    expect(audits[0]).toMatchObject({ surface: "teach", searched: 1 });
  });

  it("the registry's seed is untouched by the workflow's resolve", () => {
    expect(resolveRegistry(null).pubmed.status).toBe("configured");
    expect(resolveWorkflows(null).basic.status).toBe("configured");
  });
});
