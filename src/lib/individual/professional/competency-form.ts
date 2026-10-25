import type { ContextOption, ProfessionalCompetencyPolicy } from "../policy";
import { isUuid, type Parsed } from "./validate";
import { LAYER_CATEGORY, PORTFOLIO_KINDS, type PortfolioKind } from "./competency-vocabulary";

// ── COMPETENCIES, SELF-ASSESSMENT AND EVIDENCE, PURE ── COMPETEN-PROFESSIONAL-COMPETENCY-01 C1 C2 C4 ─────────────
//
// ⚠ A SELF-ASSESSMENT IS NEVER JUDGED BY ITS EVIDENCE. Nothing here lowers, rejects or questions a level because no
// evidence is linked: the owner GO forbids it. The level comes from the CFCA proficiency scale the person chose from.
// ⚠ NOTHING HERE VERIFIES. No parser accepts a verified flag, an assessor or a decision: that is C5's alone.

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return !t ? null : t.length > max ? undefined : t;
};
const pick = (opts: readonly ContextOption[], v: unknown): [string | null, string | null] | undefined => {
  if (v === undefined || v === null || v === "") return [null, null];
  const hit = typeof v === "string" ? opts.find(o => o.code === v) : undefined;
  return hit ? [hit.code, hit.label] : undefined;
};
const yes = (v: unknown) => v === true || v === "true" || v === "on" || v === "yes";

/** What the parser needs of an offered catalogue competency. */
export type OfferedLike = { competencyId: string; title: string; description: string | null; layer: string | null; catalogue: { id: string; version: string }; outcomes: string[] };

export type EntryColumns = {
  kind: "catalogue" | "personal"; framework_id: string | null; framework_competency_id: string | null; framework_version: string | null;
  title: string; description: string | null; category_code: string | null; category_label: string | null; interest: boolean; interest_note: string | null;
};

/** The framework version a link records: "v<major>.<minor>.<revision>" of the catalogue, as offered now. */
export const catalogueVersion = (c: Pick<OfferedLike, "catalogue">) => (c.catalogue.version ? `v${c.catalogue.version.replace(/^v/i, "")}` : null);

/**
 * Pure: a new entry in My Competencies. A catalogue entry must be OFFERED (published and allowlisted) and takes its
 * title, version and layer from the catalogue. A personal entry is the person's own words, where the policy allows it.
 */
export function parseEntry(b: Record<string, unknown>, policy: ProfessionalCompetencyPolicy, offered: readonly OfferedLike[]): Parsed<EntryColumns> {
  const note = text(b.interestNote, 1000);
  if (note === undefined) return { ok: false, error: "Keep the note under 1,000 characters." };
  if (isUuid(b.competencyId)) {
    const c = offered.find(o => o.competencyId === b.competencyId);
    if (!c) return { ok: false, error: "That competency is not one Competen Professional offers." };
    const cat = policy.categories.find(o => o.code === LAYER_CATEGORY[c.layer ?? ""]) ?? null;
    return { ok: true, value: {
      kind: "catalogue", framework_id: c.catalogue.id, framework_competency_id: c.competencyId, framework_version: catalogueVersion(c),
      title: c.title.slice(0, 200), description: null, category_code: cat?.code ?? null, category_label: cat?.label ?? null, interest: yes(b.interest), interest_note: note,
    } };
  }
  if (policy.personal !== "on") return { ok: false, error: "Choose a competency from an offered catalogue." };
  const title = text(b.title, 200);
  if (!title || title.length < 3) return { ok: false, error: "Name the competency in 3 to 200 characters." };
  const description = text(b.description, 2000);
  if (description === undefined) return { ok: false, error: "Keep the description under 2,000 characters." };
  const cat = pick(policy.categories, b.category);
  if (!cat) return { ok: false, error: "Choose a group from the list." };
  return { ok: true, value: {
    kind: "personal", framework_id: null, framework_competency_id: null, framework_version: null,
    title, description, category_code: cat[0], category_label: cat[1], interest: yes(b.interest), interest_note: note,
  } };
}

/** One level of a CFCA proficiency scale (scoring_levels), as the form offers it. */
export type ScaleLevel = { id: string; scaleId: string; scaleLabel: string | null; score: number; label: string };

export type SelfAssessmentColumns = {
  learning_outcome: string | null; framework_version: string | null; scale_id: string; level_id: string; scale_label: string | null;
  level_score: number; level_label: string; confidence_code: string | null; confidence_label: string | null; reflection: string | null; development_interest: boolean;
};

/**
 * Pure: a self-assessment. The level must be one of the offered scale's levels. The outcome, if given, must be one of
 * the competency's own outcomes. Evidence is not consulted: an assessment is the person's, whatever is linked.
 */
export function parseSelfAssessment(b: Record<string, unknown>, ctx: { levels: readonly ScaleLevel[]; outcomes: readonly string[]; frameworkVersion: string | null; policy: ProfessionalCompetencyPolicy }): Parsed<SelfAssessmentColumns> {
  if (!ctx.levels.length) return { ok: false, error: "No proficiency scale is configured yet, so a level cannot be chosen." };
  const level = ctx.levels.find(l => l.id === b.levelId);
  if (!level) return { ok: false, error: "Choose a level from the scale." };
  let outcome: string | null = null;
  if (ctx.policy.fields.includes("outcome") && typeof b.outcome === "string" && b.outcome) {
    if (!ctx.outcomes.includes(b.outcome)) return { ok: false, error: "Choose one of this competency's learning outcomes." };
    outcome = b.outcome;
  }
  const conf = ctx.policy.fields.includes("confidence") ? pick(ctx.policy.confidence, b.confidence) : [null, null] as [null, null];
  if (!conf) return { ok: false, error: "Choose how sure you are from the list." };
  const reflection = ctx.policy.fields.includes("reflection") ? text(b.reflection, 5000) : null;
  if (reflection === undefined) return { ok: false, error: "Keep the reflection under 5,000 characters." };
  return { ok: true, value: {
    learning_outcome: outcome, framework_version: ctx.frameworkVersion, scale_id: level.scaleId, level_id: level.id, scale_label: level.scaleLabel,
    level_score: level.score, level_label: level.label, confidence_code: conf[0], confidence_label: conf[1], reflection,
    development_interest: ctx.policy.fields.includes("interest") && yes(b.interest),
  } };
}

export type EvidenceLinkInput = { kind: PortfolioKind; sourceId: string; learning_outcome: string | null; relation_code: string; relation_label: string };

/** Pure: an evidence link. Exactly one existing record, an optional outcome of THIS competency, and a relation. */
export function parseEvidenceLink(b: Record<string, unknown>, ctx: { outcomes: readonly string[]; policy: ProfessionalCompetencyPolicy }): Parsed<EvidenceLinkInput> {
  // The portfolio picker sends one field, "<kind>:<id>". Separate fields are accepted too (AI acceptance sends them).
  if (typeof b.sourcePick === "string" && b.sourcePick.includes(":")) { const [k, id] = b.sourcePick.split(":"); b = { ...b, kind: k, sourceId: id }; }
  if (!(PORTFOLIO_KINDS as readonly string[]).includes(String(b.kind)) || !isUuid(b.sourceId)) return { ok: false, error: "Choose a record from your portfolio." };
  let outcome: string | null = null;
  if (typeof b.outcome === "string" && b.outcome) {
    if (!ctx.outcomes.includes(b.outcome)) return { ok: false, error: "Choose one of this competency's learning outcomes." };
    outcome = b.outcome;
  }
  const rel = ctx.policy.relations.find(r => r.code === b.relation);
  if (!rel) return { ok: false, error: "Say what the evidence supports, from the list." };
  return { ok: true, value: { kind: b.kind as PortfolioKind, sourceId: b.sourceId, learning_outcome: outcome, relation_code: rel.code, relation_label: rel.label } };
}

/** Pure: the evidence type fields of a 373 evidence item, from its form. Partial: absent fields are not touched. */
export function parseEvidenceType(b: Record<string, unknown>, policy: ProfessionalCompetencyPolicy): Parsed<{ evidence_type_code?: string | null; evidence_type_label?: string | null; author_name?: string | null }> {
  const out: { evidence_type_code?: string | null; evidence_type_label?: string | null; author_name?: string | null } = {};
  if (b.evidenceType !== undefined) {
    const t = pick(policy.evidenceTypes, b.evidenceType);
    if (!t) return { ok: false, error: "Choose a kind of evidence from the list." };
    out.evidence_type_code = t[0]; out.evidence_type_label = t[1];
  }
  if (b.author !== undefined) {
    const a = text(b.author, 160);
    if (a === undefined) return { ok: false, error: "Keep who it is from under 160 characters." };
    out.author_name = a;
  }
  return { ok: true, value: out };
}

/** Pure: is a reassessment due? Never an instruction: a suggestion in the person's own workspace. */
export function reassessDue(lastAssessedAt: string | null, today: string, days: number): boolean {
  if (!lastAssessedAt) return false;
  return new Date(Date.parse(lastAssessedAt) + days * 864e5).toISOString().slice(0, 10) <= today;
}

// ── SUGGESTIONS: DETERMINISTIC FIRST, AI ONLY WHEN ASKED ───────────────────────────────────────────────────────

const WORD = /[a-z0-9]{4,}/g;
const STOP = new Set(["with", "from", "that", "this", "your", "their", "into", "able", "when", "using", "safely", "appropriately", "course", "entry"]);
const words = (s: string) => new Set([...s.toLowerCase().matchAll(WORD)].map(m => m[0]).filter(w => !STOP.has(w)));

/** Pure: portfolio records whose titles share words with an outcome (or the competency). Deterministic, best first. */
export function suggestEvidence<T extends { title: string }>(target: string, items: readonly T[], max = 5): T[] {
  const t = words(target);
  if (!t.size) return [];
  return items.map(i => ({ i, score: [...words(i.title)].filter(w => t.has(w)).length }))
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.i.title.localeCompare(b.i.title)).slice(0, max).map(x => x.i);
}

export type AiCompetencyKind = "explore" | "reflect" | "map" | "summary";
export const AI_COMPETENCY_KINDS: readonly AiCompetencyKind[] = ["explore", "reflect", "map", "summary"];
const GUARD = "Use only what is given and my own record. Never say I am or am not competent, never invent evidence, results, roles or events, and never describe anything as verified.";

/**
 * The question for each kind. Only the competency, its outcomes and the TITLES of shareable portfolio records go in
 * (never a reflection), cut short so the whole question fits the gateway's limit.
 */
export function aiCompetencyQuestion(kind: AiCompetencyKind, c: { title: string; outcomes: readonly string[] }, items: readonly { title: string }[] = []): string {
  const comp = `Competency: "${c.title.slice(0, 120)}".`;
  const outs = c.outcomes.slice(0, 4).map((o, i) => `O${i + 1} ${o.slice(0, 50)}`).join("; ");
  switch (kind) {
    case "explore": return `${comp} In at most five sentences, explain what it involves in practice and ways to develop it. ${GUARD}`;
    case "reflect": return `${comp} Give me up to four short questions to reflect honestly on my own capability. Do not answer them. ${GUARD}`;
    case "map": {
      const list = items.slice(0, 6).map((it, i) => `E${i + 1} ${it.title.slice(0, 40)}`).join("; ");
      return `${comp} Outcomes: ${outs || "none listed"}. My records: ${list}. Suggest up to three links, one per line exactly as: - E<n> :: O<n> or none :: knowledge|application|practical|experience :: <why>. ${GUARD}`.slice(0, 640);
    }
    case "summary": return `${comp} Summarise in at most five sentences what my own record holds towards it, as preparation for an assessment. ${GUARD}`;
  }
}

export type AiMapping = { item: number; outcome: number | null; relation: string; basis: string };

/** Pure: mapping suggestions from an AI answer. Only in-range record and outcome numbers and known relations are kept. */
export function parseAiMappings(answer: string, itemCount: number, outcomeCount: number, relations: readonly string[]): AiMapping[] {
  const out: AiMapping[] = [];
  for (const line of answer.split(/\r?\n/)) {
    const m = /^\s*(?:[-*]|\d+[.)])\s*E(\d+)\s*::\s*(?:O(\d+)|none)\s*::\s*([a-z-]+)\s*::\s*(.{3,500})\s*$/i.exec(line);
    if (!m) continue;
    const item = Number(m[1]), outcome = m[2] ? Number(m[2]) : null, relation = m[3].toLowerCase();
    if (item < 1 || item > itemCount || (outcome !== null && (outcome < 1 || outcome > outcomeCount)) || !relations.includes(relation)) continue;
    out.push({ item: item - 1, outcome: outcome === null ? null : outcome - 1, relation, basis: m[4].replace(/\*\*/g, "").trim() });
    if (out.length === 3) break;
  }
  return out;
}
