// Checklist Studio: the validation report of a checklist version. Pure (no I/O): the engine validators run over the
// assembled definition, the scoring document, the saved tests and the layouts. The server runs the same function
// before it records a 'validated' event and before it accepts a submission.
import {
  runTests, validateDefinition, validateLayout, validateRules,
  type InstrumentDef, type LayoutDoc, type RulesDoc, type ScoringTestCase,
} from "../core";
import type { Issue } from "../core";
import type { StudioIssue, ValidationReport } from "./types";

export interface LayoutInput { id: string; name: string; layout: LayoutDoc; isDefault: boolean }

export interface ValidationInput {
  def: InstrumentDef;
  scoring: Record<string, unknown> | null;
  tests: ScoringTestCase[];
  layouts: LayoutInput[];
  deliveryModes: string[];
  /** scale version ids used by items or fields whose version is not published */
  unpublishedScaleIds: string[];
  /** false when the chosen purpose cannot be published */
  purposePublishable: boolean;
  hasDefaultLayout: boolean;
  now?: string;
}

const tag = (list: Issue[], source: string): StudioIssue[] => list.map((i) => ({ ...i, source }));
const hasRules = (s: Record<string, unknown> | null): s is Record<string, unknown> => !!s && Array.isArray((s as { outcomes?: unknown }).outcomes);

export function validateInstrumentVersion(i: ValidationInput): ValidationReport {
  const errors: StudioIssue[] = [];
  const warnings: StudioIssue[] = [];
  if (i.def.items.length === 0) errors.push({ code: "no_items", path: "items", message: "Add at least one item.", source: "content" });
  const d = validateDefinition(i.def);
  errors.push(...tag(d.errors, "content")); warnings.push(...tag(d.warnings, "content"));

  let testSummary: ValidationReport["tests"] = null;
  if (!hasRules(i.scoring)) {
    errors.push({ code: "no_rules", path: "scoring", message: "Scoring rules are required before this can be put forward. Start from a starter rule set, a published template, or the proposal from the source workbook, then adjust them.", source: "scoring" });
  } else {
    const r = validateRules(i.def, i.scoring as unknown as RulesDoc);
    errors.push(...tag(r.errors, "scoring")); warnings.push(...tag(r.warnings, "scoring"));
    if (r.errors.length === 0) {
      const run = runTests(i.def, i.scoring as unknown as RulesDoc, i.tests);
      testSummary = { passed: run.passed, failed: run.failed };
      for (const t of run.results) if (!t.ok) errors.push({ code: "test_failed", path: `tests.${t.id}`, message: `Saved test "${t.name}" does not pass: ${t.mismatches.join("; ")}`, source: "scoring" });
      if (i.tests.length === 0) warnings.push({ code: "no_tests", path: "tests", message: "No saved scoring tests. Add at least one so a change to the rules is caught.", source: "scoring" });
    }
  }

  for (const l of i.layouts) {
    const v = validateLayout(l.layout, i.def, { forPublication: true });
    errors.push(...tag(v.errors, `layout:${l.name}`)); warnings.push(...tag(v.warnings, `layout:${l.name}`));
  }
  if (!i.hasDefaultLayout) warnings.push({ code: "no_default_layout", path: "layout", message: "No default layout is chosen. The built-in standard checklist layout will be used.", source: "layout" });

  if (i.deliveryModes.length === 0) errors.push({ code: "no_delivery_mode", path: "settings.delivery_modes", message: "Choose at least one delivery mode.", source: "settings" });
  if (!i.purposePublishable) errors.push({ code: "purpose_not_publishable", path: "settings.purpose", message: "The chosen purpose cannot be published.", source: "settings" });
  if (i.unpublishedScaleIds.length) errors.push({ code: "scale_not_published", path: "items", message: `Every scale an item uses must be a published version (${i.unpublishedScaleIds.length} are not).`, source: "content" });
  return { ok: errors.length === 0, errors, warnings, tests: testSummary, checkedAt: i.now ?? new Date().toISOString() };
}
