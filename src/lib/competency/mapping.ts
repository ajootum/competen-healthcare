import { generate, type GenerateArgs, type GenerateResult } from "@/lib/ai/client";
import { parseJsonArray, textGroundingViolations } from "@/lib/ai/grounding";
import type { CompetencyLayer } from "./foundation";

// ── THE COMPETENCY-MAPPING ENGINE ── Holdings, shared by Scholar and Professional ────────────────────────
//
// COMPETEN-HOLDINGS-SHARED-ENGINES-01: "Holdings owns the reusable engines. Scholar and Professional configure
// and consume them." First built for COMPETEN-SCHOLAR-01 S2. Professional (IND-007) maps goals, CPD and
// evidence with the same engine.
//
// WHAT IT DOES. A person's own text (study notes, a goal, a CPD entry, a piece of evidence) is given to the
// model with the competencies the caller may offer -- always S1's loadCatalogueFor(admin, scope), narrowed as
// the product decides. The model names the CONCEPTS each piece of text covers and PROPOSES the competencies it
// supports, with a confidence and a one-sentence reason. Nothing here is a judgement of competence. A proposal
// is a proposal until a person decides, and a decision is a new record, never an edit (mappingStates).
//
// WHAT IT DOES NOT DO. It stores nothing. Storage is product-owned (Scholar: migration 388) with own-row RLS,
// because each product's subject (a study section, a goal, an entry) is its own table. It reads no table.
// It decides no access: the caller has already gated the person and chosen the candidate set.
//
// ⚠ THE MODEL NEVER WRITES AN ID. Candidates are shown as [C1], [C2] ... and subjects as [S1] ... A tag
// outside the list is dropped, so a stored proposal can only name a competency the caller offered.
// ⚠ A CONCEPT MUST BE IN THE TEXT: each content word, by prefix. A concept the text does not mention is dropped.
// ⚠ A REASON ADDS NOTHING: a rationale with a number, month or clinical finding the text and the competency do
// not contain is removed (textGroundingViolations, the Holdings verifier); the proposal stays without it.
// ⚠ IDENTIFIERS: the caller's screen (for Scholar, its patient-identifier check) drops any concept or reason
// it flags.
// ⚠ ONE AI GATEWAY. The call is generate() with the caller's attribution and operation, so usage is
// recorded and the caller's quota and consent (checked BEFORE calling this) govern it.

// v2: a candidate may carry its place in the clinical structure (the caller's context line), shown to the model.
export const MAPPING_PROMPT_VERSION = "competency-map-v2";
// COMPETEN-SCHOLAR-UPLOAD-01 U3: OPT-IN outcome-level mapping. A caller that passes `outcomes: true` shows each
// competency's learning outcomes numbered under it ([C3.1], [C3.2] ...) and the model may name the ONE outcome a
// piece of text supports. Without the option the prompt and its version are exactly v2, so a consumer that has
// not opted in (Professional today) is unchanged.
export const MAPPING_PROMPT_VERSION_OUTCOMES = "competency-map-v3-outcomes";
/** Outcomes shown per competency when outcome-level mapping is on. */
export const OUTCOMES_SHOWN = 6;
/** Subjects analysed in one AI call. */
export const SUBJECTS_PER_CALL = 6;
/** Candidates shown to the model at once. A larger set is shortlisted by overlap with the text. */
export const SHORTLIST_LIMIT = 60;
export const MAX_PROPOSALS_PER_SUBJECT = 4;
export const MAX_CONCEPTS_PER_SUBJECT = 12;
/** A proposal below this confidence is not returned -- too weak to put in front of a person. */
export const MIN_CONFIDENCE = 0.3;

/** A competency the caller may offer. S1's CatalogueCompetency is one (structurally). */
export type MappingCandidate = {
  competencyId: string; layer: CompetencyLayer | null; code: string | null; title: string; outcomes: string[];
  /**
   * Where the competency sits, in the caller's words -- for clinical catalogues its practice and clinical
   * practice unit (CKCM: domain, practice, CPU), e.g. "Oxygen Therapy > CPU-OXYSAFE-001 Safe Oxygen
   * Administration". Shown to the model as context, never checked or stored by the engine. Optional.
   */
  context?: string | null;
};
/** One piece of a person's own text, with the caller's reference for it (a chunk id, a goal id ...). */
export type MappingSubject = { ref: string; text: string };
/** Who the person is and what the text is, in the caller's words. No profession is named here. */
export type MappingFraming = { person: string; subjects: string };

/** `outcome` (U3, opt-in): the text of the one learning outcome of that competency the model named, verified. */
export type MappingProposal = { competencyId: string; layer: CompetencyLayer | null; confidence: number; rationale: string | null; outcome?: string };
export type MappingOptions = { outcomes?: boolean };
export type SubjectAnalysis = { ref: string; concepts: string[]; proposals: MappingProposal[] };
export type MappingDrop = {
  reason: "malformed" | "unknown_subject" | "unknown_competency" | "low_confidence" | "concept_not_in_text" | "identifier" | "rationale_ungrounded" | "over_limit" | "unknown_outcome";
};
export type MappingCheck = { subjects: SubjectAnalysis[]; dropped: MappingDrop[] };
export type IdentifierScreen = (text: string) => readonly unknown[];

export const candidateTag = (i: number) => `C${i + 1}`;
export const subjectTag = (i: number) => `S${i + 1}`;

const STOP = new Set("about above after again against also among because been before being below between both could does doing during each from further have having into itself more most other over same should some such than that their them then there these they this those through under until very were what when where which while with would your".split(" "));
const terms = (s: string) => [...new Set(s.toLowerCase().normalize("NFKD").split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w)).map(w => w.slice(0, 5)))];

/** Pure. The candidates worth showing the model for these subjects: all of them, or the best-overlapping, in their own order. */
export function shortlist<C extends MappingCandidate>(subjects: MappingSubject[], candidates: C[], limit = SHORTLIST_LIMIT): C[] {
  if (candidates.length <= limit) return candidates;
  const words = new Set(subjects.flatMap(s => terms(s.text.slice(0, 4000))));
  const scored = candidates.map((c, i) => ({ c, i, hits: terms(`${c.title} ${c.outcomes.join(" ")}`).filter(t => words.has(t)).length }));
  scored.sort((a, b) => b.hits - a.hits || a.i - b.i);
  return scored.slice(0, limit).sort((a, b) => a.i - b.i).map(s => s.c);
}

export function mappingSystem(f: MappingFraming, opts: MappingOptions = {}): string {
  const outcomeRule = opts.outcomes
    ? ["   outcome is optional: if the text supports ONE particular learning outcome listed under that competency, give its tag (for example \"C3.2\"). Leave it out when no single outcome fits."]
    : [];
  const shape = opts.outcomes
    ? 'Reply with JSON ONLY, no prose and no code fence: [{"section": "S1", "concepts": ["..."], "competencies": [{"tag": "C3", "confidence": 0.8, "rationale": "...", "outcome": "C3.2"}]}]'
    : 'Reply with JSON ONLY, no prose and no code fence: [{"section": "S1", "concepts": ["..."], "competencies": [{"tag": "C3", "confidence": 0.8, "rationale": "..."}]}]';
  return [
    `You help ${f.person} organise ${f.subjects} against the competencies they are working towards.`,
    "You are given numbered competencies, tagged [C1], [C2] and so on, and numbered pieces of their own text, tagged [S1], [S2] and so on.",
    "",
    "For EACH piece of text:",
    `1. concepts: up to ${MAX_CONCEPTS_PER_SUBJECT} key concepts it actually covers, each a short noun phrase using its own words. Never a concept it does not mention.`,
    `2. competencies: up to ${MAX_PROPOSALS_PER_SUBJECT} competencies it supports, using ONLY the tags you were given. Several are fine, across layers. None is fine if nothing fits.`,
    "   confidence is a number from 0 to 1: how directly the text supports that competency.",
    "   rationale is ONE short sentence, in the text's own terms, saying why. Do not add any number, dose, value or finding the text does not contain.",
    ...outcomeRule,
    "3. Never include a name, NHS number, date of birth or anything that could identify a real person.",
    "",
    shape,
  ].join("\n");
}

export function mappingUserPrompt(subjects: MappingSubject[], candidates: MappingCandidate[], opts: MappingOptions = {}): string {
  const comps = candidates.map((c, i) => {
    const where = c.context ? ` [${c.context}]` : "";
    const head = `[${candidateTag(i)}] (${c.layer ?? "unclassified"}) ${c.code ? `${c.code} ` : ""}${c.title}${where}`;
    if (opts.outcomes) return [head, ...c.outcomes.slice(0, OUTCOMES_SHOWN).map((o, k) => `    [${candidateTag(i)}.${k + 1}] ${o}`)].join("\n");
    const out = c.outcomes.length ? ` -- ${c.outcomes.slice(0, 3).join("; ")}` : "";
    return `${head}${out}`;
  });
  const subs = subjects.map((s, i) => `[${subjectTag(i)}]\n${s.text}`);
  return `COMPETENCIES:\n${comps.join("\n")}\n\nMY TEXT:\n\n${subs.join("\n\n")}`;
}

const contentWords = (s: string) => s.toLowerCase().normalize("NFKD").split(/[^a-z0-9]+/).filter(w => w.length >= 4);

/** Pure. Every content word of the concept appears (by prefix) in the text. */
export function conceptInText(concept: string, text: string): boolean {
  const have = contentWords(text);
  const need = contentWords(concept);
  if (!need.length) return false;
  return need.every(w => { const p = w.slice(0, Math.min(5, w.length)); return have.some(h => h.startsWith(p)); });
}

/** Pure. The model's reply → what may be returned, and why everything else was not. */
export function checkMappingReply(raw: string, subjects: MappingSubject[], candidates: MappingCandidate[], screen: IdentifierScreen = () => []): MappingCheck {
  const out: MappingCheck = { subjects: [], dropped: [] };
  const arr = parseJsonArray(raw);
  if (!arr) { out.dropped.push({ reason: "malformed" }); return out; }
  const seen = new Set<string>();
  for (const item of arr) {
    const r = item as Record<string, unknown>;
    const sm = typeof r?.section === "string" ? /^\[?S(\d+)\]?$/i.exec(r.section.trim()) : null;
    const si = sm ? Number(sm[1]) - 1 : -1;
    if (si < 0 || si >= subjects.length) { out.dropped.push({ reason: "unknown_subject" }); continue; }
    const subject = subjects[si];
    if (seen.has(subject.ref)) { out.dropped.push({ reason: "malformed" }); continue; }
    seen.add(subject.ref);

    const concepts: string[] = [];
    for (const c of Array.isArray(r.concepts) ? r.concepts : []) {
      const t = typeof c === "string" ? c.replace(/\s+/g, " ").trim() : "";
      if (t.length < 2 || t.length > 80) { out.dropped.push({ reason: "malformed" }); continue; }
      if (screen(t).length) { out.dropped.push({ reason: "identifier" }); continue; }
      if (!conceptInText(t, subject.text)) { out.dropped.push({ reason: "concept_not_in_text" }); continue; }
      if (concepts.some(x => x.toLowerCase() === t.toLowerCase())) continue;
      if (concepts.length >= MAX_CONCEPTS_PER_SUBJECT) { out.dropped.push({ reason: "over_limit" }); continue; }
      concepts.push(t);
    }

    const proposals: MappingProposal[] = [];
    for (const p of Array.isArray(r.competencies) ? r.competencies : []) {
      const q = p as Record<string, unknown>;
      const cm = typeof q?.tag === "string" ? /^\[?C(\d+)\]?$/i.exec(q.tag.trim()) : null;
      const ci = cm ? Number(cm[1]) - 1 : -1;
      if (ci < 0 || ci >= candidates.length) { out.dropped.push({ reason: "unknown_competency" }); continue; }
      const comp = candidates[ci];
      const conf = typeof q.confidence === "number" && Number.isFinite(q.confidence) ? Math.round(Math.min(1, Math.max(0, q.confidence)) * 100) / 100 : NaN;
      if (Number.isNaN(conf)) { out.dropped.push({ reason: "malformed" }); continue; }
      if (conf < MIN_CONFIDENCE) { out.dropped.push({ reason: "low_confidence" }); continue; }
      if (proposals.some(x => x.competencyId === comp.competencyId)) continue;
      if (proposals.length >= MAX_PROPOSALS_PER_SUBJECT) { out.dropped.push({ reason: "over_limit" }); continue; }
      let rationale = typeof q.rationale === "string" ? q.rationale.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      if (rationale && screen(rationale).length) { out.dropped.push({ reason: "identifier" }); rationale = ""; }
      if (rationale && textGroundingViolations(rationale, [subject.text, comp.title, ...comp.outcomes]).length) {
        out.dropped.push({ reason: "rationale_ungrounded" });
        rationale = "";
      }
      // U3: an outcome tag must name one of THIS competency's shown outcomes. Anything else is dropped, the proposal kept.
      let outcome: string | undefined;
      if (typeof q.outcome === "string" && q.outcome.trim()) {
        const om = /^\[?C(\d+)\.(\d+)\]?$/i.exec(q.outcome.trim());
        const oi = om && Number(om[1]) - 1 === ci ? Number(om[2]) - 1 : -1;
        if (oi >= 0 && oi < Math.min(OUTCOMES_SHOWN, comp.outcomes.length)) outcome = comp.outcomes[oi];
        else out.dropped.push({ reason: "unknown_outcome" });
      }
      proposals.push({ competencyId: comp.competencyId, layer: comp.layer, confidence: conf, rationale: rationale || null, ...(outcome ? { outcome } : {}) });
    }
    proposals.sort((a, b) => b.confidence - a.confidence);
    out.subjects.push({ ref: subject.ref, concepts, proposals });
  }
  return out;
}

/**
 * Propose mappings for up to SUBJECTS_PER_CALL pieces of text. The caller has ALREADY checked consent, quota
 * and configuration, chosen the candidates (S1, narrowed) and supplies its attribution and operation, which
 * the usage log records. Candidates beyond SHORTLIST_LIMIT are shortlisted here.
 */
export async function proposeMappings(args: {
  subjects: MappingSubject[]; candidates: MappingCandidate[]; framing: MappingFraming;
  context: NonNullable<GenerateArgs["context"]>; screen?: IdentifierScreen;
  /** U3, opt-in: offer each competency's learning outcomes and let the model name one. */
  outcomes?: boolean;
  /** AI-FAIR-USE-01: how the request is run. Default generate(); a product passes its metered runner. */
  run?: (a: GenerateArgs) => Promise<GenerateResult>;
}) {
  const shown = shortlist(args.subjects.slice(0, SUBJECTS_PER_CALL), args.candidates);
  const subjects = args.subjects.slice(0, SUBJECTS_PER_CALL);
  const opts: MappingOptions = { outcomes: !!args.outcomes };
  const r = await (args.run ?? generate)({
    system: mappingSystem(args.framing, opts),
    user: mappingUserPrompt(subjects, shown, opts),
    tier: "reasoning",
    maxTokens: 2000,
    context: args.context,
  });
  if (!r.ok) return { ok: false as const, error: r.error };
  return {
    ok: true as const, check: checkMappingReply(r.text, subjects, shown, args.screen), shown: shown.length,
    model: r.model, provider: r.provider, promptVersion: opts.outcomes ? MAPPING_PROMPT_VERSION_OUTCOMES : MAPPING_PROMPT_VERSION,
  };
}

// ── DECISIONS ── a proposal's state is its latest decision; a correction is a new record ───────────────

export type MappingState = "proposed" | "accepted" | "rejected";
export type MappingDecision = { mappingId: string; decision: "accepted" | "rejected"; decidedBy: string; createdAt: string };

/** Pure. The latest decision for each mapping, and how many there have been. No decision is "proposed". */
export function mappingStates(decisions: MappingDecision[]): Map<string, { state: MappingState; decidedBy: string; at: string; history: number }> {
  const out = new Map<string, { state: MappingState; decidedBy: string; at: string; history: number }>();
  for (const d of decisions) {
    const prev = out.get(d.mappingId);
    const history = (prev?.history ?? 0) + 1;
    if (!prev || d.createdAt >= prev.at) out.set(d.mappingId, { state: d.decision, decidedBy: d.decidedBy, at: d.createdAt, history });
    else out.set(d.mappingId, { ...prev, history });
  }
  return out;
}

export type LiveMapping = { competencyId: string; byPerson: boolean; confidence: number | null; state: MappingState };

/**
 * Pure. The competency a subject is chiefly about: an accepted mapping first, then a proposed one, by
 * confidence (a person's own mapping counts as certain). A rejected mapping never. Null when none.
 */
export function leadingCompetency(mappings: LiveMapping[]): string | null {
  const rank = (m: LiveMapping) => (m.state === "accepted" ? 2 : 1) * 10 + (m.byPerson ? 1 : (m.confidence ?? 0));
  const live = mappings.filter(m => m.state !== "rejected").sort((a, b) => rank(b) - rank(a));
  return live[0]?.competencyId ?? null;
}
