/**
 * Instrument import: PROPOSED scoring, deterministic, from what the sheet actually holds (owner GO 3 Nov 2026, late).
 * Pure and client-safe. No AI. The proposal is written into the draft as ordinary, editable scoring rules with saved
 * tests, every rule id carrying the PROPOSED prefix so the Studio and the pathway can say "proposed from the workbook,
 * review before submitting" until the author accepts it. Nothing is assumed silently: every default is a flag.
 *
 * Two families, chosen from the items' response types:
 *   compliance  Yes / No / Partial / N/A audits: compliance percentage = met / (met + not met), N/A excluded. Partial
 *               counts as the workbook defines it, else as NOT MET with a flag (patchPartialOptions). The workbook names
 *               no target, so the proposal is neutral (Compliant only when every applicable item is met, Partially
 *               compliant when any is met) and flagged for the author to set a percentage target.
 *   rating      rating-scale instruments: every rated item at or above a threshold level = Achieved, any at or above =
 *               Partially achieved, else Not achieved, nothing rated = Incomplete. The threshold is read from the
 *               workbook's own scoring or achievement text where it names one, else the middle level of the scale,
 *               flagged as a neutral default the author must confirm. Ordinals are never averaged.
 */
import type { InstrumentDef, RulesDoc, ScoringTestCase } from "../core";
import type { EditorContent } from "../studio/types";
import type { ImportFlag, SheetDraft } from "./types";
import { applyProfile, chooseProfile, type ProfileId } from "./profiles";

export const PROPOSED_PREFIX = "proposed_";
export type ProposalFamily = "compliance" | "rating" | "none";

export interface ScoringProposal {
  family: ProposalFamily;
  rules: RulesDoc | null;
  tests: ScoringTestCase[];
  flags: ImportFlag[];
  /** rating family: the threshold level ordinal, and where it came from */
  threshold: { ordinal: number; code: string; label: string; source: "workbook" | "default" } | null;
  /** delivery modes implied by who answers (self, assessor, auditor), for the version settings */
  deliveryModes: string[];
  /** the content as the profile patched it (option values, N/A reason, mandatory, evidence fields), or null when no profile fits */
  content: EditorContent | null;
  profileId: ProfileId | null;
}

export interface ProposalInput {
  sheets: SheetDraft[];
  /** the draft's definition, items with their frozen scales where known */
  def: InstrumentDef;
  respondentRoles: string[];
  /** the rating scale's levels when the def's items carry no scale yet (at import, before the scale version exists) */
  levels?: { code: string; label: string; ordinal: number }[] | null;
}

const flag = (code: string, message: string, severity: ImportFlag["severity"] = "warn"): ImportFlag => ({ code, message, severity });
const ROLE_MODE: Record<string, string> = { self: "self_assessment", assessor: "assessor_led", auditor: "auditor_recorded" };

/** Rules carry the proposal mark until the author accepts them. */
export const isProposedRules = (doc: unknown): boolean =>
  !!doc && typeof doc === "object" && Array.isArray((doc as RulesDoc).rules) && (doc as RulesDoc).rules.some((r) => typeof r?.id === "string" && r.id.startsWith(PROPOSED_PREFIX));

/** The same rules as the author's own: the proposal mark is removed from every rule id. */
export function acceptProposedRules(doc: RulesDoc): RulesDoc {
  return { ...doc, rules: doc.rules.map((r) => ({ ...r, id: r.id.startsWith(PROPOSED_PREFIX) ? r.id.slice(PROPOSED_PREFIX.length) : r.id })) };
}

/**
 * A choice option with no pass or fail meaning (Partial, as the workbook left it) counts as NOT MET, so the compliance
 * percentage can count it. Returns the patched content and the labels it changed, for the flag.
 */
export function patchPartialOptions(content: EditorContent): { content: EditorContent; changed: string[] } {
  const changed = new Set<string>();
  const items = content.items.map((it) => {
    if (it.response_type !== "multiple_choice" || !Array.isArray(it.config.options)) return it;
    let touched = false;
    const options = it.config.options.map((o) => {
      if (typeof o.satisfactory === "boolean") return o;
      touched = true; changed.add(o.label);
      return { ...o, satisfactory: false };
    });
    return touched ? { ...it, config: { ...it.config, options } } : it;
  });
  return { content: { ...content, items }, changed: [...changed] };
}

export function proposeScoring(i: ProposalInput): ScoringProposal {
  // ASMT-SCORING-INTEGRATION-01: the proposal IS a scoring profile applied to the content. The profile decides the option
  // values (Yes = 2, Partial = 1, No = 0), N/A with a reason, mandatory, the evidence fields, the rules and the tests.
  const profileId = chooseProfile(i.def);
  if (!profileId) {
    const deliveryModes = [...new Set(i.respondentRoles.map((r) => ROLE_MODE[r]).filter((m): m is string => !!m))];
    return { family: "none", rules: null, tests: [], flags: [flag("no_scoring_proposed", "No rating or Yes / Partial / No responses were found, so no profile fits. Start from a starter rule set in Scoring & Rules.")], threshold: null, deliveryModes, content: null, profileId: null };
  }
  const applied = applyProfile({ groups: [], sections: [], items: i.def.items as EditorContent["items"] }, profileId, { def: i.def, levels: i.levels ?? null, respondentRoles: i.respondentRoles });
  return { family: profileId === "graded_assessment" ? "rating" : "compliance", rules: applied.rules, tests: applied.tests, flags: applied.flags, threshold: null, deliveryModes: applied.deliveryModes, content: applied.content, profileId };
}

/** A short summary of a proposal for a screen: family, the threshold, the delivery modes. */
export function proposalSummary(p: ScoringProposal): string {
  if (p.family === "none" || !p.rules) return "No scoring proposed.";
  const dm = p.deliveryModes.length ? ` Delivery mode: ${p.deliveryModes.join(", ")}.` : "";
  const label = p.rules.profile?.label ?? (p.family === "compliance" ? "Weighted audit" : "Graded assessment");
  const formula = p.rules.profile?.formula ?? "";
  return `${label}. ${formula} Interpretation: Not configured until a threshold or decision rule set is approved.${dm}`;
}
