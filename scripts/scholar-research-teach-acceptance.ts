/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-RESEARCH-TEACH-001 P1 COUNTED STAGING TEST. Lesson 1 of Growth and Development (slides 1 to 4), real PubMed,
 * Crossref and PubMed Central, the real model, staging's real AI policy, risk rules and eligibility rows.
 *
 * ⚠ STAGING ONLY. It writes NO configuration: the research registry, policy and workflow are applied in memory through a
 * read proxy on the config table. Rows it causes on staging: the shared topic rows (citations only), research usage,
 * one audit row and the gateway's AI usage rows, all under a synthetic evaluation user.
 *
 * ⚠ COUNTED AND CAPPED. MAX_MODEL_CALLS and MAX_RUNS stop it. Every model call and every outgoing URL goes to the ledger.
 *
 *   TEACH_ENV_DIR=<folder holding the staging .env.local> SLIDES=<slides.json> OUT=<evidence folder> npx tsx scripts/scholar-research-teach-acceptance.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.env.TEACH_ENV_DIR ?? process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://x").host !== new URL(url).host) { console.error("REFUSING: the gateway's usage log is not the staging project."); process.exit(1); }

const EVAL_USER = "00000000-0000-0000-0000-00000000e7a1";
const MAX_MODEL_CALLS = Number(process.env.MAX_MODEL_CALLS ?? 6);
const MAX_RUNS = 2;
const OUT = process.env.OUT ?? "docs/evidence/SCHOLAR-RESEARCH-TEACH-001";
const slides: { slide: number; lines: string[] }[] = JSON.parse(readFileSync(process.env.SLIDES!, "utf8"));
const LESSON_SLIDES = [1, 2, 3, 4];

/** List prices, USD per million tokens, read from the gateway's own table where it has one. */
const ledger = { model: [] as any[], http: [] as { host: string; path: string; ms: number; ok: boolean }[] };
const leaks = /nambi|okello|mulago|gabriel|ajootum|elish/i;

(async () => {
  const { resolveRegistry, SEED_REGISTRY } = await import("../src/lib/holdings/research/registry");
  const { prepareEvidencePack, packPlan } = await import("../src/lib/individual/scholar/evidence-pack-service");
  const { runIntegratedTeach } = await import("../src/lib/individual/scholar/teach-integrated");
  const { loadResearchEngine } = await import("../src/lib/holdings/research/load");
  const { DEFAULT_QUALITY } = await import("../src/lib/individual/scholar/source-quality");
  const { generate } = await import("../src/lib/ai/client") as any;
  const { aiStatus } = await import("../src/lib/ai/config");
  const { loadProductPolicy, loadModelRouting, resolveRiskSubject } = await import("../src/lib/ai/allowance");
  const { classifyRisk } = await import("../src/lib/ai/clinical-risk");
  const { routeCandidates, selectRoute, clinicalGate } = await import("../src/lib/ai/model-routing");
  const { lessonTopics, approvedQuery } = await import("../src/lib/individual/scholar/evidence-pack");
  const { estimateCost } = await import("../src/lib/ai/gateway");

  const real = createClient(url, key, { auth: { persistSession: false } }) as any;
  // In memory only: the engine as the owner would leave it (PubMed, Crossref, PubMed Central and also OpenAlex Active, to prove the pack leaves it out).
  const stamp = { at: new Date().toISOString(), by: "acceptance", ok: true, detail: "in-memory acceptance only" };
  const registry = Object.fromEntries(["pubmed", "openalex", "crossref", "pmc"].map(id => [id, { ...SEED_REGISTRY[id], status: "active", checks: { connectivity: stamp, approval: stamp, activation: stamp } }]));
  const docs = [{ config_path: "research.registry", published: registry }, { config_path: "research.workflows", published: { basic: { status: "active" } } }, { config_path: "research.policy", published: {} }];
  const admin = { from: (t: string) => (t === "workspace_config_overrides" ? { select: (cols: string) => { if (cols !== "config_path, published") return real.from(t).select(cols); return { eq: (...a: any[]) => (a[1] === "platform" ? { eq: (_c: string, ref: string) => (ref === "research" ? { in: async () => ({ data: docs, error: null }) } : real.from(t).select(cols).eq("scope_type", "platform").eq("scope_ref", ref)) } : real.from(t).select(cols).eq(...a)) }; } } : real.from(t)) };
  void resolveRegistry;

  const passages = LESSON_SLIDES.map((n, i) => { const s = slides.find(x => x.slide === n)!; return { chunkId: `c${i}`, materialId: "m", materialTitle: "Growth and Development", ordinal: i, pageFrom: n, pageTo: n, unit: "slide" as const, content: s.lines.join("\n") }; });
  const lessonText = { headings: LESSON_SLIDES.map(n => slides.find(x => x.slide === n)!.lines[0]), body: passages.map(p => p.content) };
  const brief = { title: "Principles of Growth and Development", objective: "Understand the principles of growth and development and critical and sensitive periods.", sections: [...new Set(lessonText.headings)] };

  console.log("TOPICS", lessonTopics(lessonText, 4).map((t: any) => t.id));
  for (const t of lessonTopics(lessonText, 4) as any[]) console.log("  QUERY", t.id, approvedQuery(t.id, 15));

  // Every outgoing request goes to the ledger, so what left is read, not assumed.
  const counted = async (u: string, init?: any) => {
    const started = Date.now(), parsed = new URL(u);
    const res = await fetch(u, init);
    ledger.http.push({ host: parsed.host, path: `${parsed.pathname}${parsed.search}`, ms: Date.now() - started, ok: res.ok });
    return res;
  };
  const ctx = { admin, userId: EVAL_USER, profile: { fullName: "Research teach acceptance" } } as any;
  const policy = { research: { dailyMax: 50, relevance: "standard" as const }, teach: { on: true, maxSearches: 4, dailyCostCents: 1000 }, quality: DEFAULT_QUALITY };

  const { policy: aiPolicy } = await loadProductPolicy(real, "scholar");
  const subject = { text: ["Teach me this step.", ...passages.map(p => p.content)].join("\n\n"), competencyIds: [], topicTerms: [] };
  const risk = classifyRisk(aiPolicy.risk, await resolveRiskSubject(real, subject), (aiPolicy.activities.teach?.riskFloor ?? "standard_educational") as any);
  const routing = await loadModelRouting(real);
  const rows = (await real.from("ai_model_eligibility").select("activity, provider, model_prefix, eligible, max_risk_tier").eq("product", "scholar")).data ?? [];
  const routeFor = (tier: "reasoning" | "cheap") => selectRoute(routeCandidates(routing as any, null, { product: "scholar", activity: "teach", tier }, (routing as any).registry), aiStatus().available, clinicalGate(rows, "teach", risk.tier));
  const mainRoute = routeFor("reasoning");
  console.log("RISK", risk.tier, risk.rule, "ROUTE", mainRoute?.model);

  mkdirSync(OUT, { recursive: true });
  const summary: any[] = [];
  for (let run = 1; run <= MAX_RUNS; run++) {
    const started = Date.now();
    const httpBefore = ledger.http.length;
    const pack = await prepareEvidencePack(ctx, policy, { lesson: lessonText, actionId: null, search: true }, { fetch: counted as any });
    const packMs = Date.now() - started;
    console.log(`RUN ${run} PACK`, { state: pack.state, topics: pack.topics, searched: pack.searched, reused: pack.reused, items: pack.items.length, ms: packMs, codes: pack.codes, http: ledger.http.length - httpBefore });
    if (pack.state !== "ready") { summary.push({ run, pack: { state: pack.state, codes: pack.codes } }); continue; }
    if (run === 2 || process.env.PACK_ONLY) { summary.push({ run, label: "second learner, same topics", pack: { state: pack.state, searched: pack.searched, reused: pack.reused, items: pack.items.length, ms: packMs, http: ledger.http.length - httpBefore, codes: pack.codes } }); continue; }
    const modelRun = async (g: any, part = "main") => {
      if (ledger.model.length >= MAX_MODEL_CALLS) return { ok: false, error: "failed", detail: "cap" };
      const route = mainRoute;
      const t0 = Date.now();
      const x = await generate({ ...g, route, context: { ...g.context } });
      // The measured call at its own model's price, and the same tokens at the heavier model production's routing may require at this risk tier (an estimate, said so).
      ledger.model.push({ part, model: x.model, input: x.usage?.input, output: x.usage?.output, ms: Date.now() - t0, ok: x.ok, usd: estimateCost(x.model, x.usage?.input ?? 0, x.usage?.output ?? 0), usdIfOpusEstimate: estimateCost("claude-opus-4-8", x.usage?.input ?? 0, x.usage?.output ?? 0) });
      if (x.ok) writeFileSync(join(OUT, `raw-${part}.txt`), x.text);
      return x;
    };
    const genStart = Date.now();
    const r: any = await runIntegratedTeach(EVAL_USER, { question: "Teach me this step.", passages: passages as any, references: [], depth: "standard", learnerContext: null, lesson: brief, evidence: pack.evidence }, modelRun as any);
    const genMs = Date.now() - genStart;
    if (!r.ok) { console.log("MODEL FAILED", r.error); summary.push({ run, error: r.error }); continue; }
    const text = r.check.ok ? r.check.text : `WITHHELD: ${r.check.reason}`;
    writeFileSync(join(OUT, "enhanced-lesson.md"), text);
    const refs = pack.references(r.integrated.citedEvidence);
    writeFileSync(join(OUT, "references.json"), JSON.stringify(refs.map((x: any) => ({ tag: x.tag, title: x.title, authors: x.authors, journal: x.journal, year: x.year, pmid: x.pmid, doi: x.doi, url: x.url, verified: x.verified, studyKind: x.studyKind, accessed: x.accessed, openAccess: x.openAccess })), null, 1));
    // The abstracts stay out of the evidence (publishers' text): a local copy for the citation check only.
    writeFileSync(process.env.ABSTRACTS!, JSON.stringify(pack.items.map((i: any, n: number) => ({ tag: `E${n + 1}`, pmid: i.pmid, title: i.title, abstract: i.abstract })), null, 1));
    summary.push({ run, pack: { state: pack.state, topics: pack.topics, searched: pack.searched, reused: pack.reused, items: pack.items.length, ms: packMs, http: ledger.http.length - httpBefore, codes: pack.codes }, generateMs: genMs, totalMs: Date.now() - started, shown: r.integrated.shown, relabelled: r.integrated.relabelled, droppedDetail: r.integrated.dropped.map((d: any) => ({ reason: d.reason, tokens: (d.violations ?? []).map((v: any) => v.token) })), cited: r.integrated.citedEvidence, claims: r.integrated.claims, unsupported: r.integrated.unsupported, verified: r.integrated.verified, dropped: r.integrated.dropped.map((d: any) => d.reason), checkOk: r.check.ok });
  }

  // What left Competen, read back from the ledger.
  const hosts = [...new Set(ledger.http.map(h => h.host))];
  const all = decodeURIComponent(ledger.http.map(h => h.path).join("\n"));
  const searches = ledger.http.filter(h => h.path.includes("esearch")).map(h => decodeURIComponent(new URL(`https://x${h.path}`).searchParams.get("term") ?? ""));
  const report = { risk: { tier: risk.tier, rule: risk.rule }, route: mainRoute?.model, hosts, openalexCalled: hosts.some(h => h.includes("openalex")), searches, http: { requests: ledger.http.length, failed: ledger.http.filter(h => !h.ok).length, byHost: Object.fromEntries(hosts.map(h => [h, ledger.http.filter(x => x.host === h).length])) }, leakCheck: !leaks.test(all), noteTextSent: passages.some(p => p.content.split("\n").some(l => l.length > 40 && all.includes(l))), model: ledger.model, summary };
  writeFileSync(join(OUT, "run-ledger.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  void loadResearchEngine; void packPlan;
})().catch(e => { console.error(e); process.exit(1); });
