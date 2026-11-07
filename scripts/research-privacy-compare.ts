/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Research Search Privacy Alignment: before and after, on live sources. No AI. No database. No key.
 *
 *   npx.cmd tsx scripts/research-privacy-compare.ts <outlines.json> <out.json> [--openalex N]
 *
 * For each lesson it builds the query as main built it (buildResearchQuery, then the plain keyword fallback) and as this
 * branch builds it (lessonQuery), sends each DISTINCT query once to PubMed through the engine's own adapter, and runs what
 * comes back through the real relevance filter and source-quality gate, against the same lesson. So "accepted" and "evidence"
 * mean what they mean for a learner. `outlines.json` is a list of staging lesson outlines of test learners (title, objective,
 * focus). Everything else is the hand-written list below. --openalex N also sends the first N lessons to OpenAlex.
 * --held-out <titles.json> runs only those titles.
 */
import fs from "node:fs";
import { researchQuery } from "../src/lib/holdings/research/service";
import { researchContact, searchOpenAlex, searchPubmed, type FetchLike, type ResearchItem } from "../src/lib/holdings/research/providers";
import { findPatientIdentifiers } from "../src/lib/privacy/patient-identifiers";
import { contextOf, gated, lessonQuery, withLessonScope, type LearnResearch, type ResearchInput } from "../src/lib/individual/scholar/learn-research";
import { buildResearchQuery } from "../src/lib/individual/scholar/research-relevance";

type Lesson = { group: string; title: string; objective?: string; focus?: string[] };

/** A lesson as an outline writes it. */
const L = (group: string, title: string, ...focus: string[]): Lesson => ({ group, title, objective: `Explain ${title.toLowerCase()}${focus.length ? `, including ${focus.join(" and ").toLowerCase()}` : ""}.`, focus: [title, ...focus] });

const WRITTEN: Lesson[] = [
  ...[
    ["Sepsis recognition", "qSOFA", "Lactate"], ["Neonatal jaundice", "Phototherapy", "Bilirubin"], ["Postpartum haemorrhage", "Active management of third stage"], ["Malaria in pregnancy", "Intermittent preventive treatment"],
    ["Prevention of mother to child transmission of HIV", "Antiretroviral prophylaxis"], ["Asthma inhaler technique", "Spacer"], ["Kangaroo mother care", "Preterm infants"], ["Oxygen therapy", "Hypoxaemia", "Pulse oximetry"],
    ["Fluid resuscitation in children", "Dehydration"], ["Diabetic foot", "Neuropathy"], ["Cerebral palsy", "Spasticity"], ["Autism screening", "Early intervention"], ["Hypertensive disorders of pregnancy", "Pre-eclampsia", "Magnesium sulphate"],
    ["Anticoagulant therapy", "Warfarin", "INR monitoring"], ["Antibiotic stewardship", "Resistance"], ["Tuberculosis treatment", "Directly observed therapy"], ["Sickle cell disease in children", "Vaso-occlusive crisis"], ["Pressure ulcer prevention", "Repositioning"],
    ["Delirium in intensive care", "CAM-ICU"], ["Pain assessment tools", "Numeric rating scale"], ["Wound dressing selection", "Moist wound healing"], ["Medication errors", "Barcode administration"], ["Hand hygiene", "Five moments"],
    ["Acute kidney injury", "Creatinine"], ["Heart failure self-management", "Fluid restriction"], ["Stroke rehabilitation", "Dysphagia"], ["Dementia caregiver burden", "Respite care"], ["Depression in older adults", "Screening"], ["Breastfeeding support", "Latch"],
    ["Childhood immunisation schedule", "Measles"], ["Cholera outbreak response", "Oral rehydration"], ["Snakebite envenoming", "Antivenom"], ["Burn wound care", "Parkland formula"], ["Traumatic brain injury", "Intracranial pressure"], ["Chest drain management", "Pneumothorax"],
  ].map(([t, ...f]) => L("clinical", t, ...f)),
  ...[
    ["Informed consent", "Capacity"], ["Clinical leadership", "Transformational leadership"], ["Health literacy", "Teach-back"], ["Mental health stigma"], ["Vaccine hesitancy"], ["Confidence intervals", "P values"], ["Thematic analysis", "Qualitative research"],
    ["Problem-based learning"], ["Simulation in nursing education", "Debriefing"], ["Reflective practice", "Gibbs reflective cycle"], ["Nurse staffing ratios", "Patient outcomes"], ["Breaking bad news", "SPIKES"], ["Randomised controlled trials", "Blinding"], ["Systematic reviews", "Meta-analysis"],
  ].map(([t, ...f]) => L("education, research, ethics", t, ...f)),
  ...[
    ["Parkinson's disease", "Levodopa"], ["Alzheimer's disease", "Cholinesterase inhibitors"], ["Crohn's disease", "Biologics"], ["Down syndrome", "Early intervention"], ["Turner syndrome", "Growth hormone"], ["Guillain-Barre syndrome", "Plasma exchange"], ["Kawasaki disease", "Immunoglobulin"],
    ["Cushing's syndrome", "Cortisol"], ["Graves' disease", "Thyrotoxicosis"], ["Wilson's disease", "Copper"], ["Hodgkin lymphoma"], ["Bell's palsy", "Corticosteroids"], ["Glasgow Coma Scale"], ["Apgar score"], ["Erikson's psychosocial stages"], ["Piaget's cognitive development"], ["Bowlby's attachment theory"], ["Maslow's hierarchy of needs"], ["Kohlberg's moral development"], ["Vygotsky's zone of proximal development"], ["Donabedian model"], ["Burkitt lymphoma"], ["Ebola virus disease"], ["Lassa fever"],
  ].map(([t, ...f]) => L("established names", t, ...f)),
  ...[["Scrub typhus"], ["Buruli ulcer"], ["Konzo"], ["Noma", "Necrotising gingivitis"], ["Nodding syndrome"], ["Podoconiosis"], ["Tungiasis"], ["Hansen's disease"], ["Ludwig's angina"]].map(([t, ...f]) => L("rarer subjects", t, ...f)),
  ...[
    { group: "with a name or document detail", title: "Mrs Nambi age 72 at Mulago: sepsis and qSOFA", objective: "Explain sepsis and qSOFA for Mrs Nambi.", focus: ["Mrs Nambi", "Sepsis", "qSOFA"] },
    { group: "with a name or document detail", title: "sarah okello from kampala: pressure ulcer care", objective: "Explain pressure ulcer care.", focus: ["sarah okello", "pressure ulcer care"] },
    { group: "with a name or document detail", title: "Lecture 3, BSN 2024, Makerere University: Wound healing", objective: "Explain wound healing.", focus: ["Dr Peter Mukasa", "Wound healing"] },
    { group: "with a name or document detail", title: "Baby John Mugisha neonatal resuscitation case", objective: "Explain neonatal resuscitation.", focus: ["Baby John Mugisha", "Neonatal resuscitation"] },
    { group: "with a name or document detail", title: "Ward 4B audit, Nakasero Hospital, March 2025", objective: "Explain clinical audit.", focus: ["Ward 4B audit", "Clinical audit"] },
    { group: "with a name or document detail", title: "Week 2 notes by Grace Atim", objective: "Explain week 2 notes.", focus: ["Week 2 notes by Grace Atim"] },
    { group: "with a name or document detail", title: "Mr Wilson and his family", objective: "Explain Mr Wilson and his family.", focus: ["Mr Wilson"] },
    { group: "with a name or document detail", title: "Slide 12", objective: "Explain slide 12.", focus: ["Slide 12"] },
  ],
];

const oldQuery = (input: ResearchInput) => {
  const source = [input.title, input.objective, ...(input.concepts ?? []), ...input.topics.slice(0, 8), input.question].filter(Boolean).join(" ").slice(0, 1200);
  if (findPatientIdentifiers(source).length) return null;
  const q = buildResearchQuery(contextOf(input));
  if (q) return q;
  const fallback = researchQuery(input);
  return fallback.ok ? fallback.query : null;
};

const contact = researchContact();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const deps = { fetch: fetch as unknown as FetchLike, timeoutMs: 20000, contact, now: () => new Date() };
const MAX = 5;
const cache = new Map<string, ResearchItem[] | null>();
let sent = 0;
async function searched(provider: "pubmed" | "openalex", query: string): Promise<ResearchItem[] | null> {
  const k = `${provider}|${query}`;
  if (cache.has(k)) return cache.get(k)!;
  await wait(800);
  sent++;
  let r = provider === "pubmed" ? await searchPubmed(deps, query, MAX, true) : await searchOpenAlex(deps, query, MAX, true);
  if (r === null) { await wait(3000); sent++; r = provider === "pubmed" ? await searchPubmed(deps, query, MAX, true) : await searchOpenAlex(deps, query, MAX, true); }
  cache.set(k, r);
  return r;
}

function judged(query: string, items: ResearchItem[] | null, input: ResearchInput) {
  if (items === null) return { failed: true };
  const r: LearnResearch = { state: "searched", message: null, query, scholarLink: null, items, evidence: items.flatMap((x, i) => (x.abstract && x.pmid ? [i] : [])), calls: [], codes: [], sourceVersions: {}, excerptChars: 320, furtherReading: true, licensing: {} };
  const g = gated(r, undefined, { ctx: contextOf(input) });
  return { retrieved: items.length, accepted: g.items.length, evidence: g.evidence.length, shown: g.items.map(x => ({ pmid: x.pmid, doi: x.doi, year: x.year, title: x.title })), excluded: (g.excluded ?? []).map(x => x.title) };
}

(async () => {
  const [outlinesPath, outPath] = process.argv.slice(2);
  const oaAt = process.argv.indexOf("--openalex");
  const oaN = oaAt > 0 ? Number(process.argv[oaAt + 1]) : 0;
  const outlines = JSON.parse(fs.readFileSync(outlinesPath, "utf8")) as { material: string[]; outline: { title: string; objective: string; focus: string[] } }[];
  const seen = new Set<string>();
  const fromStaging: Lesson[] = outlines.flatMap(x => {
    const k = JSON.stringify(x.outline);
    if (seen.has(k)) return [];
    seen.add(k);
    return [{ group: `staging: ${x.material[0]}`, title: x.outline.title, objective: x.outline.objective, focus: x.outline.focus }];
  }).sort((a, b) => Number(!/Growth/.test(a.group)) - Number(!/Growth/.test(b.group)));
  // --held-out <file>: only these titles, as a lesson with no further detail. A list written without sight of the vocabulary.
  const heldAt = process.argv.indexOf("--held-out");
  const lessons = heldAt > 0 ? (JSON.parse(fs.readFileSync(process.argv[heldAt + 1], "utf8")) as string[]).map(t => L("held out", t)) : [...fromStaging, ...WRITTEN];
  const rows: any[] = [];
  for (const [n, l] of lessons.entries()) {
    const input = withLessonScope({ question: null, topics: l.focus ?? [], title: l.title }, { title: l.title, objective: l.objective, focus: l.focus });
    const before = oldQuery(input);
    const q = lessonQuery(input);
    const after = q.ok ? q.query : null;
    const b = before ? judged(before, await searched("pubmed", before), input) : null;
    const a = after ? (after === before ? b : judged(after, await searched("pubmed", after), input)) : null;
    const row: any = { group: l.group, title: l.title, before, after, refused: q.ok ? null : q.reason, pubmed: { before: b, after: a } };
    if (n < oaN) {
      const ob = before ? judged(before, await searched("openalex", before), input) : null;
      const oa = after ? (after === before ? ob : judged(after, await searched("openalex", after), input)) : null;
      row.openalex = { before: ob, after: oa };
    }
    rows.push(row);
    fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), maxResults: MAX, searchesSent: sent, complete: n === lessons.length - 1, rows }, null, 1));
    console.log(`${String(n + 1).padStart(3)}/${lessons.length} ${l.title.slice(0, 40).padEnd(40)} ${(b as any)?.accepted ?? "-"} -> ${(a as any)?.accepted ?? "-"}  | ${before} => ${after ?? `(${q.ok ? "" : q.reason})`}`);
  }
  process.exit(0);
})().catch(e => { console.error(e?.message ?? e); process.exit(1); });
