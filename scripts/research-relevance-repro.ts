/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-RESEARCH-RELEVANCE-02 -- ONE FOCUSED LIVE REPRODUCTION. No AI. No database write. STAGING (read only) + the real
 * public providers (PubMed E-utilities, OpenAlex) through the engine's own adapters (src/lib/holdings/research/providers).
 *
 *   npx.cmd tsx scripts/research-relevance-repro.ts        (cwd = this checkout; ENV_DIR = a folder holding the staging .env.local)
 *
 * Reads, from staging only, the "Quality Improvement Science and Methods" deck of harness-guided-browser@competen.test, finds the
 * lesson whose sections hold "Donabedian", then builds the research request exactly as the Learn route does, sends it to
 * PubMed and OpenAlex, and prints: the exact queries sent (the grounded one and the old topic-bag one), what came back, what
 * the relevance filter accepted and excluded with the reason, and where PMIDs 30113379 and 35119438 fall.
 * Refuses unless the Supabase URL is a confirmed non-production project. Nothing is written anywhere.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget, judgeTarget } from "./production-guard";
import { listLearningSessions, getLearningSession, chunksByIds, topicsOfSections } from "../src/lib/individual/scholar/store";
import { lessonOutline, sectionProfile } from "../src/lib/individual/scholar/learn";
import { contextOf, lessonQuery, relevant, withLessonScope, type LearnResearch } from "../src/lib/individual/scholar/learn-research";
import { researchQuery, mergeItems } from "../src/lib/holdings/research/service";
import { researchContact, searchOpenAlex, searchPubmed, type FetchLike, type ResearchItem } from "../src/lib/holdings/research/providers";

loadEnvConfig(process.env.ENV_DIR ?? "C:/Users/elish/Documents/Competen/competen-p2", true);
const url = process.env.STAGING_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: not a confirmed non-production Supabase project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
assertSafeTarget(url, "research-relevance-repro");
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const TARGET = ["30113379", "35119438"];
const USER = "harness-guided-browser@competen.test";
const MATERIAL = /quality improvement science/i;

async function userId(): Promise<string> {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === USER);
    if (hit) return hit.id;
    if ((data?.users ?? []).length < 200) break;
  }
  throw new Error(`${USER} not found on staging`);
}

(async () => {
  const uid = await userId();
  const sessions = await listLearningSessions(admin, uid, 50);
  if (!sessions.ok) throw new Error("sessions unreadable");
  // The lesson about the Donabedian model: one whose title, objective or focus names it, else the one whose sections mention it most.
  let found: { session: any; step: any; content: string; ids: string[] } | null = null, best = 0;
  for (const s of sessions.data) {
    const g = await getLearningSession(admin, uid, s.id);
    if (!g.ok || !g.data) continue;
    for (const st of g.data.steps) {
      if (!st.sections.some(x => MATERIAL.test(x.materialTitle))) continue;
      const ids = st.sections.map(x => x.chunkId);
      const ch = await chunksByIds(admin, uid, ids);
      const text = ch.ok ? ch.data.map(c => c.content).join(" ") : "";
      const mentions = (text.match(/donabedian/gi) ?? []).length;
      if (!mentions) continue;
      const profiles = new Map((ch.ok ? ch.data : []).map(c => [c.id, sectionProfile(c.content)]));
      const o = lessonOutline(st, await topicsOfSections(admin, uid, ids), profiles);
      const score = (/donabedian/i.test(`${o.title} ${o.objective} ${o.focus.join(" ")}`) ? 1000 : 0) + mentions;
      if (score > best) { best = score; found = { session: g.data.session, step: st, content: text, ids }; }
    }
  }
  if (!found) { console.log(`No lesson of "${USER}" holds "Donabedian" in a session of the QI deck (sessions read: ${sessions.data.length}).`); process.exit(2); }

  const topicMap = await topicsOfSections(admin, uid, found.ids);
  const ch = await chunksByIds(admin, uid, found.ids);
  const profiles = new Map((ch.ok ? ch.data : []).map(c => [c.id, sectionProfile(c.content)]));
  const lesson = lessonOutline(found.step, topicMap, profiles);
  const topics = [...new Set([...topicMap.values()].flat())];
  const stepTitle = found.session.topic ?? found.session.title ?? null;
  console.log(`LESSON (session "${found.session.title}", step ${found.step.step}, ${found.step.sections.length} sections)`);
  console.log(`  title:     ${lesson.title}\n  objective: ${lesson.objective}\n  focus:     ${JSON.stringify(lesson.focus)}\n  section topics: ${JSON.stringify(topics.slice(0, 12))}\n  session title/topic: ${stepTitle}`);

  // The request exactly as the route builds it (SCHOLAR-RESEARCH-RELEVANCE-02): the lesson replaces the deck/topic bag.
  const input = withLessonScope({ question: null, topics, title: stepTitle }, { title: lesson.title, objective: lesson.objective, focus: lesson.focus });
  const q = lessonQuery(input);
  const old = researchQuery({ topics, title: stepTitle });
  const ctx = contextOf(input);

  const contact = researchContact();
  const sent: string[] = [];
  const f: FetchLike = (u, i) => { sent.push(u.replace(/&?(api_key|email|tool)=[^&]*/g, "")); return (fetch as unknown as FetchLike)(u, i); };
  const deps = { fetch: f, timeoutMs: 15000, contact, now: () => new Date() };

  async function run(label: string, query: string) {
    console.log(`\n=== ${label} ===\nQUERY SENT: ${query}`);
    sent.length = 0;
    const [pm, oa] = await Promise.all([searchPubmed(deps, query, 5, true), searchOpenAlex(deps, query, 5, true)]);
    console.log(`  requests: ${sent.map(u => new URL(u).host + new URL(u).pathname).join(", ")}`);
    console.log(`  PubMed ${pm === null ? "FAILED" : pm.length} results, OpenAlex ${oa === null ? "FAILED" : oa.length} results`);
    const items: ResearchItem[] = mergeItems([pm ?? [], oa ?? []]);
    items.forEach((x, n) => console.log(`  [${n + 1}] ${x.provider} ${x.year ?? "n.d."} PMID ${x.pmid ?? "-"} DOI ${x.doi ?? "-"} | ${x.title}`));
    const r: LearnResearch = { state: "searched", message: null, query, scholarLink: null, items, evidence: items.map((_, i) => i), calls: [], codes: [], sourceVersions: {}, excerptChars: 320, furtherReading: true, licensing: {} };
    const g = relevant(r, ctx);
    console.log(`  RELEVANCE: retrieved ${g.retrieved}, accepted ${g.accepted}, excluded ${g.excluded?.length ?? 0}`);
    for (const x of g.items) console.log(`    ACCEPT  PMID ${x.pmid ?? "-"} ${x.year ?? ""} ${x.title}`);
    for (const x of g.excluded ?? []) console.log(`    EXCLUDE PMID ${x.pmid ?? "-"} (${x.reason}) ${x.title}`);
    for (const t of TARGET) {
      const at = items.findIndex(x => x.pmid === t);
      const ex = (g.excluded ?? []).find(x => x.pmid === t);
      console.log(`  PMID ${t}: ${at < 0 ? "NOT retrieved" : `retrieved at position ${at + 1} of ${items.length}${ex ? `, EXCLUDED (${ex.reason})` : ", ACCEPTED"}`}`);
    }
  }
  if (q.ok) await run("NEW grounded query (lesson title, objective, focus)", q.query); else console.log("lessonQuery refused:", q.reason);
  if (old.ok) await run("OLD query (first topics as an unquoted bag, as at 07:41)", old.query); else console.log("old query refused:", old.reason);
  // The two records from the incident, fetched directly by PMID: whatever the search returns today, would they pass this lesson?
  await run("INCIDENT RECORDS fetched by PMID (the two ICU guidelines)", TARGET.map(t => `${t}[uid]`).join(" OR "));
  process.exit(0);
})().catch(e => { console.error(e?.message ?? e); process.exit(1); });
