import { createHash } from "node:crypto";
import type { GenerateArgs, GenerateResult, WebSource } from "@/lib/ai/client";
import type { ExamResearchDepth, ScholarExamPolicy } from "../policy";
import { findPatientIdentifiers } from "./extract";

// ── LIVE WEB RESEARCH FOR AN EXAMINATION QUESTION ── COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570) ─────────────────
//
// ⚠ ONLY THE EXAMINATION QUESTION LEAVES. The research request is built from the printed question and its options
// -- never from the student's notes, their attempt, their name or any other upload -- and it is refused outright if
// it looks like it identifies a patient. The provider's search tool runs only on the domains HQ allowed.
//
// ⚠ THE SOURCES ARE WHAT THE SEARCH RETURNED. Addresses, titles, ages and cited text come from the provider's search
// result blocks (client.ts webSourcesOf), never from text the model wrote, and anything outside the allowed domains
// is dropped even if it came back.
//
// ⚠ CACHED AS PUBLIC DATA. A result is stored by the sha256 of the request (question + provider + domains + depth),
// with no user id and nothing of the student's, and reused until it expires (policy). A cache hit spends nothing and
// does not count towards the student's daily research allowance.
//
// Off by default: web research needs "web" among the evidence sources AND a provider (policy.ts). Turning it on is
// an owner decision -- a search processor, search cost and funding.

export const RESEARCH_PROMPT_VERSION = "exam-research-v1";
export const RESEARCH_QUERY_MAX = 1200;

export const RESEARCH_DEPTH: Record<ExamResearchDepth, { maxUses: number; maxSources: number }> = {
  quick: { maxUses: 1, maxSources: 4 },
  standard: { maxUses: 3, maxSources: 6 },
  deep: { maxUses: 5, maxSources: 10 },
};

/** Whether this environment's policy allows web research at all, and the reason when it does not. */
export function webResearchState(p: ScholarExamPolicy): { on: true } | { on: false; reason: string } {
  if (!p.sources.includes("web")) return { on: false, reason: "Live web research is not switched on for Scholar." };
  if (p.webProvider === "none") return { on: false, reason: "No web research provider is configured for Scholar." };
  if (!p.domains.length) return { on: false, reason: "No sources are approved for web research." };
  return { on: true };
}

/** Pure. The research request: the printed question only, tidied and bounded. Refused if it may identify a patient. */
export function researchRequest(questionText: string): { ok: true; query: string } | { ok: false; reason: "empty" | "identifier" } {
  const query = questionText.replace(/\s+/g, " ").trim().slice(0, RESEARCH_QUERY_MAX);
  if (!query) return { ok: false, reason: "empty" };
  if (findPatientIdentifiers(query).length) return { ok: false, reason: "identifier" };
  return { ok: true, query };
}

/** Pure. The cache key: everything that decides the result, and nothing that identifies the student. */
export function researchKey(query: string, provider: string, domains: readonly string[], depth: ExamResearchDepth): string {
  const norm = query.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(JSON.stringify([RESEARCH_PROMPT_VERSION, provider, [...domains].sort(), depth, norm])).digest("hex");
}

/** A public source, as stored and shown. */
export type ResearchSource = { url: string; title: string; publisher: string; published: string | null; retrievedAt: string; excerpt: string };

const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
export const onDomain = (host: string, domains: readonly string[]) => domains.some(d => host === d || host.endsWith(`.${d}`));

/** Pure. What the search returned → the sources kept: allowed domains only, https only, de-duplicated, bounded. */
export function keepSources(found: readonly WebSource[], domains: readonly string[], max: number, retrievedAt: string): ResearchSource[] {
  const out: ResearchSource[] = [];
  for (const s of found) {
    if (out.length >= max) break;
    if (!/^https:\/\//i.test(s.url)) continue;
    const host = hostOf(s.url);
    if (!host || !onDomain(host, domains) || out.some(o => o.url === s.url)) continue;
    out.push({
      url: s.url.slice(0, 1000), title: s.title.replace(/\s+/g, " ").trim().slice(0, 300) || host, publisher: host,
      published: s.pageAge ? s.pageAge.slice(0, 60) : null, retrievedAt, excerpt: s.citedText.join(" … ").replace(/\s+/g, " ").trim().slice(0, 600),
    });
  }
  return out;
}

export const RESEARCH_SYSTEM = [
  "You research current, authoritative sources for a healthcare student's examination question.",
  "Search for the guidance, evidence or reference material that bears on the question. Prefer the most recent guidance from the publishers you may search.",
  "Then write a short neutral summary of what the sources say, citing them. Say when sources disagree, and give each source's date where it shows one.",
  "Do NOT answer the examination question, and do not invent any source. If nothing relevant is found, say so.",
  "This is study material, not advice about any real patient.",
].join("\n");

export type ResearchResult =
  | { ok: true; sources: ResearchSource[]; searches: number; model: string; provider: string }
  | { ok: false; error: "not_configured" | "refusal" | "failed" };

/** One web research call through the metered runner. Only the question is sent. */
export async function runResearch(run: (g: GenerateArgs) => Promise<GenerateResult>, userId: string, args: {
  query: string; depth: ExamResearchDepth; domains: readonly string[]; now: string;
}): Promise<ResearchResult> {
  const d = RESEARCH_DEPTH[args.depth];
  const r = await run({
    system: RESEARCH_SYSTEM, user: `EXAMINATION QUESTION:\n${args.query}`, tier: "reasoning", maxTokens: 1500,
    webSearch: { maxUses: d.maxUses, allowedDomains: args.domains },
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_exam_research" },
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, sources: keepSources(r.sources ?? [], args.domains, d.maxSources, args.now), searches: r.searches ?? 0, model: r.model, provider: r.provider };
}
