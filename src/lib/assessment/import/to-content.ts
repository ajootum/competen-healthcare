/**
 * Instrument import: a confirmed group of sheets as the content of ONE draft checklist version, in the shapes Checklist
 * Studio already writes (EditorContent, ScaleSave). Pure, client-safe, deterministic given a key function.
 *
 * The existing model expresses every structure in the acceptance workbook without a new field kind:
 *   - an assessment with an achievement scale: rating_scale items on an imported scale, NA as an allowed state, and an
 *     "Evidence / Comments" free text field on each item,
 *   - a concurrent audit: a multiple_choice item (Yes / No / Partial) with documented finding, observed finding and
 *     discrepancy / action free text fields,
 *   - a retrospective chart audit: a multiple_choice item (Yes / No / Partial, NA where the sheet offers it) with a
 *     deficiency / evidence free text field. Scoring is built in the Studio's rules builder, not invented here.
 * Imported scales stay as imported: level codes are the workbook's values, satisfactory is left unset, and any mapping to
 * another scale is a separate, reviewed step in the Studio.
 */
import type { EditorContent, EditorItem } from "../studio/types";
import type { InstrumentSection, ItemField, ResponseType, StateCode } from "../core";
import type { DetectedColumn, ImportGroup, SheetDraft, WorkbookDraft } from "./types";
import { toDefinition } from "../studio/assemble";
import { patchPartialOptions, proposeScoring, type ScoringProposal } from "./scoring";

export type ScalePlan = {
  name: string;
  description: string;
  levels: { code: string; label: string; description: string | null; ordinal: number; numeric_value: number | null; satisfactory: boolean | null }[];
  states: { state: string; label: string }[];
};

export type InstrumentPlan = {
  title: string;
  summary: string;
  content: EditorContent;
  /** null when no item rates on a scale */
  scale: ScalePlan | null;
  /** how many items need the scale version id patched in before the content is saved */
  ratingItems: number;
  notes: string[];
  /** proposed scoring rules and tests, deterministic from the sheets, with every assumption as a flag */
  scoring: ScoringProposal;
};

const slugCode = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function buildInstrumentPlan(d: WorkbookDraft, g: ImportGroup, newKey: () => string, now: string): InstrumentPlan {
  const sheets = g.sheets.map((n) => d.sheets.find((s) => s.name === n)).filter((s): s is SheetDraft => !!s);
  const sections: InstrumentSection[] = [];
  const items: EditorItem[] = [];
  const notes: string[] = [];
  const multi = sheets.length > 1;
  let scale: ScalePlan | null = null;
  let ratingItems = 0;
  let pos = 0;

  for (const s of sheets) {
    const sheetKey = multi ? newKey() : null;
    if (sheetKey) sections.push({ stable_key: sheetKey, parent_section_key: null, title: s.title, guidance: s.instructions.join(" ") || null, weight: 1, position: ++pos });
    const keyOf = new Map<string, string>();
    for (const sec of s.sections) keyOf.set(sec.key, newKey());
    const included = new Set(s.sections.filter((x) => x.include).map((x) => x.key));
    for (const sec of s.sections) {
      if (!included.has(sec.key)) continue;
      const parent = sec.parentKey && included.has(sec.parentKey) ? keyOf.get(sec.parentKey)! : sheetKey;
      sections.push({ stable_key: keyOf.get(sec.key)!, parent_section_key: parent, title: sec.title, guidance: sec.guidance, weight: 1, position: ++pos });
    }
    const design = responseDesign(s);
    if (design.response_type === "rating_scale") {
      if (!scale) scale = scalePlan(s, g.title);
      else if (s.scale && scale.levels.map((l) => l.code).join() !== s.scale.levels.map((l) => l.value).join()) notes.push(`Sheet "${s.name}" has a different rating scale from the first sheet. The first sheet's scale is used for every rating item; adjust the items in Checklist Studio.`);
    }
    const fields = fieldsFor(s.columns);
    for (const it of s.items) {
      if (!it.include) continue;
      let sectionKey = it.sectionKey && included.has(it.sectionKey) ? keyOf.get(it.sectionKey)! : sheetKey;
      if (!sectionKey) {
        // an item whose section was left out, in a single-sheet import: give it a section so it is not lost
        const fallback = sections.find((x) => x.title === "Unsectioned items");
        if (fallback) sectionKey = fallback.stable_key;
        else { const k = newKey(); sections.push({ stable_key: k, parent_section_key: null, title: "Unsectioned items", guidance: null, weight: 1, position: ++pos }); sectionKey = k; }
      }
      if (design.response_type === "rating_scale") ratingItems++;
      items.push({
        stable_key: newKey(), section_key: sectionKey, code: it.number ?? "", prompt: it.prompt, guidance: null,
        expected_performance: it.subPoints.map((text) => ({ text })), response_type: design.response_type, scale_version_id: null, scale: null,
        config: design.config, fields: fields.map((f) => ({ ...f })), group_code: null, method_codes: [], method_rule: "any", mandatory: false, critical: false, critical_requirements: [],
        evidence_requirement: null, weight: 1, references_text: null, position: ++pos, mapping: null,
      });
    }
  }
  const summary = summaryFor(d, g, sheets, now);
  // an option with no met or not met meaning (Partial, as the workbook left it) counts as not met, so a percentage can count it
  const patched = patchPartialOptions({ groups: [], sections, items });
  const def = toDefinition(patched.content, { versionNo: 1 });
  const scoring = proposeScoring({ sheets, def, respondentRoles: g.respondentRoles, levels: scale?.levels ?? null });
  // the profile's content (option values, N/A reason, mandatory, evidence fields) is what the draft receives
  return { title: g.title.trim(), summary, content: scoring.content ? { ...patched.content, items: scoring.content.items } : patched.content, scale, ratingItems, notes, scoring };
}

export function responseDesign(s: SheetDraft): { response_type: ResponseType; config: EditorItem["config"] } {
  const allowed: StateCode[] = s.response.allowNa ? ["not_applicable"] : [];
  if (s.response.primary === "rating_scale") return { response_type: "rating_scale", config: allowed.length ? { allowedStates: allowed } : {} };
  if (s.response.primary === "multiple_choice") {
    return {
      response_type: "multiple_choice",
      config: { select: "single", options: s.response.options.map((o) => ({ code: o.code, label: o.label, satisfactory: o.satisfactory })), ...(allowed.length ? { allowedStates: allowed } : {}) },
    };
  }
  return { response_type: "yes_no", config: allowed.length ? { allowedStates: allowed } : {} };
}

/** The free text columns of the sheet as secondary fields of every item, in column order. */
export function fieldsFor(columns: DetectedColumn[]): ItemField[] {
  const seen = new Set<string>();
  const out: ItemField[] = [];
  for (const c of columns.filter((x) => x.use === "text").sort((a, b) => a.col - b.col)) {
    let key = (c.fieldKey ?? slugCode(c.header) ?? "field").slice(0, 40);
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key) || key === "primary") key = `field_${out.length + 1}`;
    while (seen.has(key)) key = `${key.slice(0, 36)}_${out.length + 1}`;
    seen.add(key);
    out.push({ field_key: key, label: c.fieldLabel ?? c.header, response_type: "free_text", scale_version_id: null, config: {}, required: false, position: out.length + 1 });
  }
  return out;
}

export function scalePlan(s: SheetDraft, instrumentTitle: string): ScalePlan {
  const ratingCols = s.columns.filter((c) => c.use === "rating");
  const levels = s.scale
    ? s.scale.levels.map((l, i) => ({ code: slugCode(l.value) || String(i), label: l.label ?? (l.value), description: l.description, ordinal: i, numeric_value: Number.isFinite(Number(l.value)) ? Number(l.value) : null, satisfactory: null }))
    : ratingCols.map((c, i) => ({ code: slugCode(c.value ?? String(i)) || String(i), label: c.value ?? String(i), description: null, ordinal: i, numeric_value: Number.isFinite(Number(c.value)) ? Number(c.value) : null, satisfactory: null }));
  // level codes must differ: a label repeated across values (two values under one competence level) keeps the value as its code
  return {
    name: `${instrumentTitle} scale`.slice(0, 120),
    description: s.scale ? `Imported as found on sheet "${s.name}" (${s.scale.title}). Satisfactory is not set on any level: scoring decides it.` : `Imported from the rating columns of sheet "${s.name}". No level descriptions were in the workbook.`,
    levels, states: s.response.allowNa ? [{ state: "not_applicable", label: "NA" }] : [],
  };
}

function summaryFor(d: WorkbookDraft, g: ImportGroup, sheets: SheetDraft[], now: string): string {
  const parts: string[] = [`Imported from "${d.fileName}" (sheet${sheets.length === 1 ? "" : "s"} ${sheets.map((s) => `"${s.name}"`).join(", ")}) on ${now.slice(0, 10)}.`];
  if (g.description.trim()) parts.push(g.description.trim());
  const ids = [...new Set(sheets.flatMap((s) => s.identifiers))];
  if (ids.length) parts.push(`Form identifiers on the original: ${ids.join(", ")}.`);
  const signoff = sheets.flatMap((s) => s.columns.filter((c) => c.use === "signoff").map((c) => c.header));
  if (signoff.length) parts.push(`Sign-off column on the original: ${[...new Set(signoff)].join(", ")}.`);
  const ignored = sheets.flatMap((s) => s.columns.filter((c) => c.use === "ignore").map((c) => `${c.letter} ${c.header}`));
  if (ignored.length) parts.push(`Columns left out: ${ignored.join(", ")}.`);
  return parts.join(" ").slice(0, 2000);
}
