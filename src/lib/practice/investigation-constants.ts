// CPR-INV-001 + CINV-CAP-001 -- the words, the lists and the ranking, IN A MODULE THAT IMPORTS NOTHING.
//
// ⚠ WHY THIS FILE EXISTS SEPARATELY FROM investigations.ts.
//
// The picker is a client component and CPR-INV-001 s13 requires it to open without waiting for a
// network round trip and to search incrementally without one per keystroke. That means the RANKING runs
// in the browser. If the ranking lived in the engine module, a `"use client"` import of it would drag
// node:crypto and next/headers into the bundle -- the exact failure audit.ts records costing 120.7 kB
// gzip across four screens. booking-request-constants.ts and registration-condition.ts split for the
// same reason and this is the third.
//
// ⚠ AND THE HARNESS IMPORTS rankInvestigations FROM HERE, NOT A COPY OF IT. A harness that
// re-implements the rule it is testing stays green under every break to the real code.

/**
 * CPR-INV-001 s8, verbatim in the third column. Every one of these has a MUST NOT beside it because
 * every one of them is a sentence somebody could read as more than it is.
 */
export const INVESTIGATION_STATUSES: { code: string; label: string; means: string; mustNotImply: string }[] = [
  {
    code: "requested",
    label: "Requested",
    means: "The practitioner recorded that they asked for, or expected, this investigation.",
    mustNotImply: "That an external laboratory or radiology service received it, or performed it.",
  },
  {
    code: "reviewed",
    label: "Reviewed",
    means: "The practitioner recorded that they looked at the result or information.",
    mustNotImply: "That Competen Practice independently verified the result.",
  },
  {
    code: "cancelled",
    label: "Not pursued",
    means: "The practitioner recorded that this was not pursued.",
    mustNotImply: "A laboratory cancellation transaction. Nothing was sent, so nothing was cancelled.",
  },
];

export const INVESTIGATION_STATUS_CODES = INVESTIGATION_STATUSES.map(s => s.code);
export const INVESTIGATION_STATUS_LABEL: Record<string, string> =
  Object.fromEntries(INVESTIGATION_STATUSES.map(s => [s.code, s.label]));

/** Reviewed is the only settled one, so it is the only green one. Not pursued is grey, not red. */
export const INVESTIGATION_STATUS_CHIP: Record<string, string> = {
  requested: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  reviewed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
};

/**
 * CPR-INV-001 s14 and s10, as the sentence the screen actually prints.
 *
 * ⚠ THIS IS THE ONE PARAGRAPH ON THE TAB THAT MAY NOT BE SHORTENED FOR LAYOUT. It is the whole
 * difference between a record of a decision and a claim that a test happened.
 */
export const INVESTIGATION_BOUNDARY =
  "This records what you asked for and that you have looked at what came back. It is not an order "
  + "system: nothing is sent to a laboratory or radiology service, no result is stored here, and nothing "
  + "on this screen claims a test was performed. The report itself belongs in the document inbox.";

/** CPR-INV-001 s10 and CINV-CAP-001 s10, beside the Quick Add row wherever it is drawn. */
export const QUICK_ADD_NOT_A_RECOMMENDATION =
  "These are the items you use most and the ones you pinned. They are a shortcut for typing, not a "
  + "clinical recommendation, and Competen is not suggesting any of them for this patient.";

export const SETS_NOT_A_RECOMMENDATION =
  "A set is a bundle somebody in this practice made. Competen recommends no set, and adding one is a "
  + "workflow shortcut only -- every item can be removed before you confirm.";

/**
 * CINV-CAP-001 s11's transparency requirement: Quick Add "must expose WHY an item is present".
 *
 * ⚠ THE ORDER OF THIS ARRAY IS THE RANKING. s10: favourites first, then frequency, then recency.
 */
export const QUICK_ADD_REASONS: { code: string; label: string; explain: string }[] = [
  { code: "favourite", label: "Pinned", explain: "You pinned this." },
  { code: "frequent", label: "Often used", explain: "You have recorded this often. That is a count, not advice." },
  { code: "recent", label: "Recent", explain: "You recorded this recently. That is a timestamp, not advice." },
];
export const QUICK_ADD_REASON_CODES = QUICK_ADD_REASONS.map(r => r.code);
export const QUICK_ADD_REASON_LABEL: Record<string, string> =
  Object.fromEntries(QUICK_ADD_REASONS.map(r => [r.code, r.label]));

/**
 * CPR-INV-HFE-006 s8's readiness state, and s15's "make the wrong action difficult".
 *
 * ⚠ AN ADVISORY MIRROR OF ONE SERVER RULE, AND ONLY ONE. `recordInvestigations` refuses a batch when
 * this practice requires a clinical question and neither a shared reason nor a reason on every item is
 * present. Until today that refusal arrived as a 422 AFTER the click -- the practitioner filled a
 * screen, pressed Add, and was told the whole batch was rejected. s8 wants the state visible per item
 * beforehand.
 *
 * ⚠ THE SERVER'S CONDITION IS A SET-LEVEL ONE AND THIS IS A PER-ITEM ONE, AND THEY ARE EQUIVALENT.
 * investigations.ts refuses when `!reasonShared && !items.every(i => i.reasonOverride)`. Turned around:
 * it ACCEPTS iff a shared reason exists, OR every item carries its own. Marking an item unready exactly
 * when it has neither makes "nothing is unready" mean "shared, or every item has one" -- the same
 * sentence. The screen therefore blocks precisely the batches the engine would refuse, and no others.
 *
 * ⚠ AN EARLIER VERSION TOOK AN `everyItemHasReason` FLAG AND IT WAS DEAD CODE. If every item carries a
 * reason then THIS item carries one, so the branch above it had already returned. The break-test found
 * it: deleting the branch changed no assertion, which is the signature of a rule doing no work. A
 * redundant condition in a safety mirror is worse than none -- it implies a rule is being enforced
 * somewhere it is not, and the next person to change the server rule will maintain both.
 *
 * ⚠ AND THERE IS NOTHING ELSE TO CHECK YET, WHICH IS THE HONEST ANSWER. s9's per-investigation fields --
 * specimen, body region, laterality, study subtype, contrast -- do not exist in the catalogue schema, so
 * no configured requirement can be missing. This function grows when CPR-INV-CAT-007 lands, and it
 * would be dishonest to draw readiness chips implying more is being checked than is.
 */
export function investigationReadiness(args: {
  reasonOverride: string;
  reasonShared: string;
  reasonRequired: boolean;
}): { ready: boolean; missing: string[] } {
  if (!args.reasonRequired) return { ready: true, missing: [] };
  if (args.reasonShared.trim()) return { ready: true, missing: [] };
  if (args.reasonOverride.trim()) return { ready: true, missing: [] };
  return { ready: false, missing: ["a clinical question"] };
}

// ── THE FOUR CONFIGURABLE WORKFLOW SETTINGS (migration 275, practice_capture_setting) ────────────────
//
// CPR-INV-001 s6 and s11 and CPR-TREAT-001 s5 each make one behaviour practice-configurable. The
// DEFAULTS live here rather than in the database, so a practice that has written nothing still behaves,
// and so the default is readable next to the thing it defaults.

export const DUPLICATE_RULES: { code: string; label: string; explain: string }[] = [
  { code: "warn", label: "Warn, and let me add it again", explain: "The picker says it is already in this encounter and offers Add again." },
  { code: "prevent", label: "Prevent a second one", explain: "The picker refuses a duplicate. Recording a genuine repeat means removing the first." },
  { code: "allow", label: "Say nothing", explain: "Duplicates are added without comment." },
];
export const DUPLICATE_RULE_CODES = DUPLICATE_RULES.map(r => r.code);

export const CAPTURE_SETTING_KEYS = [
  "investigation_duplicate_rule",
  "investigation_reason_required",
  "treatment_reason_required",
  "quick_add_limit",
] as const;
export type CaptureSettingKey = typeof CAPTURE_SETTING_KEYS[number];

export const CAPTURE_SETTING_DEFAULTS: Record<CaptureSettingKey, string> = {
  investigation_duplicate_rule: "warn",
  investigation_reason_required: "false",
  treatment_reason_required: "false",
  quick_add_limit: "8",
};

/**
 * CPR-INV-001 s11's last line: "Never silently merge distinct repeated investigation events."
 *
 * ⚠ THE RULE IS ENFORCED BY WHAT THE ENGINE DOES NOT DO. There is no merge path and no upsert against
 * an encounter investigation, so two repeats are two rows with two ids and two timestamps. This constant
 * exists so a screen can SAY that, and so the harness can assert the sentence is on the screen.
 */
export const REPEATS_ARE_NEVER_MERGED =
  "A repeat is a second record with its own time, never merged into the first.";

// ── SEARCH -- CINV-CAP-001 s6 ───────────────────────────────────────────────────────────────────────

/**
 * s6: "case-insensitive and tolerant of common spacing/punctuation differences".
 *
 * Punctuation is DELETED rather than turned into a space, so "U&E" and "UE" and "u & e" collapse to the
 * same key. A space would make "U E" a two-token phrase and lose the abbreviation.
 */
export function normaliseInvestigationTerm(value: string): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The same normalisation, but keeping word boundaries, for token matching. */
export function investigationTokens(value: string): string[] {
  return String(value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** The minimum shape rankInvestigations needs. The engine's CatalogueItem is a superset of it. */
export type RankableInvestigation = {
  id: string;
  canonicalName: string;
  shortName: string | null;
  displayName: string;
  category: string;
  aliases: string[];
};

/**
 * CINV-CAP-001 s6's ranking, in its own order: exact short name, exact alias, prefix, broader token.
 *
 * ⚠ THE SCORE IS RETURNED, NOT JUST THE ORDER. A caller that wants to show why something matched can,
 * and the harness asserts on the score rather than on a position that a tie-break could move.
 *
 * ⚠ A LOCAL DISPLAY NAME IS SEARCHED TOO. s5 lets a practice rename an item, and a rename that made the
 * item unfindable by the name on its own screen would be worse than no rename at all.
 */
export const INVESTIGATION_MATCH_SCORE = {
  exactShortName: 100,
  exactAlias: 90,
  exactName: 85,
  prefixShortName: 70,
  prefixName: 60,
  prefixAlias: 55,
  token: 30,
} as const;

export function scoreInvestigation(item: RankableInvestigation, query: string): number {
  const q = normaliseInvestigationTerm(query);
  if (!q) return 0;

  const short = normaliseInvestigationTerm(item.shortName ?? "");
  const canonical = normaliseInvestigationTerm(item.canonicalName);
  const display = normaliseInvestigationTerm(item.displayName);
  const aliases = (item.aliases ?? []).map(normaliseInvestigationTerm);

  if (short && short === q) return INVESTIGATION_MATCH_SCORE.exactShortName;
  if (aliases.some(a => a === q)) return INVESTIGATION_MATCH_SCORE.exactAlias;
  if (canonical === q || display === q) return INVESTIGATION_MATCH_SCORE.exactName;
  if (short && short.startsWith(q)) return INVESTIGATION_MATCH_SCORE.prefixShortName;
  if (canonical.startsWith(q) || display.startsWith(q)) return INVESTIGATION_MATCH_SCORE.prefixName;
  if (aliases.some(a => a.startsWith(q))) return INVESTIGATION_MATCH_SCORE.prefixAlias;

  // The broader token match, last. Every token of the query has to appear somewhere in the item, so
  // "ct head" reaches CT Brain through its alias while "ct" alone does not outrank an exact hit.
  const haystack = [item.canonicalName, item.displayName, item.shortName ?? "", ...(item.aliases ?? [])]
    .join(" ").toLowerCase();
  const terms = investigationTokens(query);
  if (terms.length > 0 && terms.every(t => haystack.includes(t))) return INVESTIGATION_MATCH_SCORE.token;
  return 0;
}

export function rankInvestigations<T extends RankableInvestigation>(items: T[], query: string): T[] {
  if (!String(query ?? "").trim()) return items;
  return items
    .map(item => ({ item, score: scoreInvestigation(item, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.displayName.localeCompare(b.item.displayName))
    .map(x => x.item);
}

// ── STORE PRESENCE -- the sentence a surface prints when migration 275 has not been applied ──────────

export const INVESTIGATION_CATALOGUE_MIGRATION =
  "275-investigation-catalogue-and-treatment-configuration";

export const INVESTIGATION_STORE_ABSENT_NOTICE =
  `The investigation catalogue has no store in this deployment. Migration "${INVESTIGATION_CATALOGUE_MIGRATION}" `
  + "has not been applied, so there is nothing to search and no favourite can be saved. This is NOT an "
  + "empty catalogue. Recording an investigation by typing its name still works.";

/**
 * What this capability declines to do, stated on the screen rather than in a document.
 *
 * ⚠ AN UNWARNED SCREEN READS AS A CLEARED SCREEN. The same argument medication-constants.ts makes for
 * the nine deferred drug checks applies here for a different reason: somebody who has used a hospital
 * order-entry system will assume this one behaves the same way unless told otherwise.
 */
export const INVESTIGATION_REFUSALS: { key: string; what: string; why: string }[] = [
  {
    key: "no_transmission",
    what: "Nothing is sent to a laboratory or radiology service.",
    why: "There is no integration. Recording a request here does not ask anybody for anything.",
  },
  {
    key: "no_result",
    what: "No result is stored on an investigation.",
    why: "There is no result column, deliberately. A half populated one would read as normal where it is blank.",
  },
  {
    key: "no_performed_state",
    what: "There is no performed or completed status.",
    why: "This product cannot observe whether a test happened, so it must not offer a word that says it did.",
  },
  {
    key: "no_clinical_advice",
    what: "Nothing here suggests which investigation to record.",
    why: "Favourites are counts and pins. Sets are bundles somebody made. Neither is decision support.",
  },
];
