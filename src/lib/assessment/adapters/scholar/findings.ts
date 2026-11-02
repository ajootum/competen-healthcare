import { PRIMARY, evalField, orderedItems, type InstrumentDef, type InstrumentItem, type Responses, type Treatment } from "../../core";
import { GAP_KIND_LABEL, type FindingKind } from "./vocab";

// ── A SELF-ASSESSMENT'S STRENGTHS AND GAPS ── Checklist Studio S3 ────────────────────────────────────────────────────
//
// Pure. Each item the learner answered is read against the level their programme EXPECTS for the competency it assesses:
//   rated at or above the expected level           a strength (the learner's own view)
//   rated below it                                 a gap
//   "Unable to judge" / unable to demonstrate      a gap, said as such, never a zero
//   not answered                                   a gap, said as such, never a zero
//   not observed / not applicable                  neither
// With no expected level (the programme sets none) a rated item is a strength when the scale calls that level satisfactory and a
// gap when it calls it not satisfactory. Nothing is averaged and nothing is inferred: this is the learner's own rating re-read.

export type Finding = {
  itemKey: string; code: string; prompt: string; kind: FindingKind; label: string;
  /** The level the learner gave (ordinal on the scale) and the level expected, when there are both. */
  ordinal: number | null; expected: number | null;
  competencyId: string | null;
};

export type ItemContext = { competencyId: string | null; expected: number | null };

/** Classifies one item. Null: the item says nothing about strengths or gaps (not observed, not applicable, no pass or fail meaning). */
export function classifyItem(item: InstrumentItem, responses: Responses, ctx: ItemContext, defaults?: Treatment): Finding | null {
  const ev = evalField(item, PRIMARY, responses, defaults);
  const base = { itemKey: item.stable_key, code: item.code, prompt: item.prompt, ordinal: ev.ordinal, expected: ctx.expected, competencyId: ctx.competencyId };
  const f = (kind: FindingKind): Finding => ({ ...base, kind, label: GAP_KIND_LABEL[kind] });
  if (ev.state === "unable_to_determine") return f("unable_to_judge");
  if (ev.state === "unable_to_demonstrate") return f("unable_to_demonstrate");
  if (ev.state === "not_observed" || ev.state === "not_applicable") return null;
  if (!ev.hasResponse || ev.state === "not_assessed") return f("not_answered");
  if (ev.ordinal !== null) {
    if (ctx.expected !== null) return ev.ordinal >= ctx.expected ? f("met") : f("below_expected");
    return ev.satisfactory === true ? f("met") : ev.satisfactory === false ? f("not_satisfactory") : null;
  }
  return ev.satisfactory === true ? f("met") : ev.satisfactory === false ? f("not_satisfactory") : null;
}

export function findStrengthsAndGaps(def: InstrumentDef, responses: Responses, contexts: ReadonlyMap<string, ItemContext>, defaults?: Treatment): { strengths: Finding[]; gaps: Finding[] } {
  const strengths: Finding[] = [], gaps: Finding[] = [];
  for (const item of orderedItems(def)) {
    const r = classifyItem(item, responses, contexts.get(item.stable_key) ?? { competencyId: null, expected: null }, defaults);
    if (!r) continue;
    (r.kind === "met" ? strengths : gaps).push(r);
  }
  return { strengths, gaps };
}

/** Wording of one finding for the report's lists. */
export function findingText(f: Finding): string {
  const level = f.ordinal !== null ? ` (you rated ${f.ordinal}${f.expected !== null ? `, expected ${f.expected}` : ""})` : "";
  return `${f.code ? `${f.code} ` : ""}${f.prompt}: ${f.label}${level}`;
}
