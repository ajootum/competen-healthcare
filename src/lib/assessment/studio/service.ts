/* eslint-disable @typescript-eslint/no-explicit-any */
// Checklist Studio: server operations that combine reads, the engine validators and writes.
// Validation is run again here, on the server, before a submission and when a report is asked for. The result is
// recorded as a 'validated' definition event, so the history shows what was known and when.
import type { createAdminClient } from "@/lib/supabase/server";
import {
  revalidateTemplate, validateLayout, validateProgression, type LayoutDoc, type ProgressionDoc, type RulesDoc, type ScoringTestCase, type StageScale,
} from "../core";
import { validateInstrumentVersion, type LayoutInput } from "./validation";
import { listLayoutTemplates, loadInstrumentVersion, loadLayoutTemplateVersion, loadPolicyVersion, loadProgressionVersion, loadRuleTemplateVersion, loadScaleVersion } from "./read";
import { recordValidated, saveScoring, submitVersion, type WriteResult } from "./write";
import type { DefinitionKind, LoadedInstrumentVersion, StudioIssue, ValidationReport } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export async function validateLoaded(admin: Admin, loaded: LoadedInstrumentVersion): Promise<ValidationReport> {
  const v = loaded.version;
  const layoutIds = [...new Set([...(v.default_layout_version_id ? [v.default_layout_version_id] : []), ...loaded.allowedLayoutIds])];
  const layouts: LayoutInput[] = [];
  if (layoutIds.length) {
    const all = await listLayoutTemplates(admin);
    for (const id of layoutIds) {
      const l = all.find((x) => x.id === id);
      if (l) layouts.push({ id, name: `${l.name} v${l.version_no}`, layout: l.layout as unknown as LayoutDoc, isDefault: id === v.default_layout_version_id });
    }
  }
  const scaleIds = [...new Set([...loaded.content.items.map((i) => i.scale_version_id), ...loaded.content.items.flatMap((i) => (i.fields ?? []).map((f) => f.scale_version_id))].filter(Boolean) as string[])];
  let unpublished: string[] = [];
  if (scaleIds.length) {
    const { data } = await admin.from("asmt_response_scale_version").select("id, state").in("id", scaleIds);
    unpublished = ((data ?? []) as any[]).filter((s) => s.state !== "published").map((s) => s.id);
  }
  const { data: purpose } = await admin.from("asmt_purpose").select("publishable").eq("code", v.purpose_code).maybeSingle();
  return validateInstrumentVersion({
    def: loaded.def, scoring: v.scoring, tests: (v.scoring_tests ?? []) as ScoringTestCase[], layouts, deliveryModes: v.delivery_modes ?? [],
    unpublishedScaleIds: unpublished, purposePublishable: purpose ? Boolean(purpose.publishable) : false, hasDefaultLayout: !!v.default_layout_version_id,
  });
}

export async function validateInstrument(admin: Admin, versionId: string, actorId: string | null, record: boolean): Promise<{ report: ValidationReport; loaded: LoadedInstrumentVersion } | null> {
  const loaded = await loadInstrumentVersion(admin, versionId);
  if (!loaded) return null;
  const report = await validateLoaded(admin, loaded);
  if (record && actorId) await recordValidated(admin, "instrument", versionId, actorId, report);
  return { report, loaded };
}

/** Validation of the other four kinds, as far as each can be checked without a checklist. */
export type StageScaleLoader = (stageScaleVersionId: string) => Promise<StageScale | null>;

export async function validateOther(admin: Admin, kind: Exclude<DefinitionKind, "instrument">, versionId: string, loadStageScale?: StageScaleLoader): Promise<ValidationReport> {
  const errors: StudioIssue[] = [];
  const warnings: StudioIssue[] = [];
  if (kind === "scale") {
    const s = await loadScaleVersion(admin, versionId);
    if (!s || s.levels.length === 0) errors.push({ code: "no_levels", path: "levels", message: "A scale needs at least one level.", source: "scale" });
  } else if (kind === "layout_template") {
    const l = await loadLayoutTemplateVersion(admin, versionId);
    if (l) { const r = validateLayout(l.layout as unknown as LayoutDoc, undefined, { forPublication: true }); errors.push(...r.errors); warnings.push(...r.warnings); }
  } else if (kind === "rule_template") {
    const t = await loadRuleTemplateVersion(admin, versionId);
    const rules = t?.rules as any;
    if (!rules || !Array.isArray(rules.outcomes) || rules.outcomes.length === 0) errors.push({ code: "no_rules", path: "rules", message: "A scoring template needs outcomes and rules.", source: "rules" });
    else warnings.push({ code: "template_checked_on_copy", path: "rules", message: "A template is checked against each checklist it is copied into.", source: "rules" });
  } else if (kind === "policy") {
    const p = await loadPolicyVersion(admin, versionId);
    if (!p) errors.push({ code: "missing", path: "version", message: "That policy version does not exist.", source: "policy" });
    else {
      if (p.version.title.trim().length < 3) errors.push({ code: "no_title", path: "title", message: "A policy needs a title.", source: "policy" });
      if (p.version.content.trim().length < 20) errors.push({ code: "no_content", path: "content", message: "A policy needs its text (at least a sentence).", source: "policy" });
      if (!p.version.effective_from) warnings.push({ code: "no_effective_date", path: "effective_from", message: "No effective date set: it will apply from publication.", source: "policy" });
    }
  } else if (kind === "progression") {
    const p = await loadProgressionVersion(admin, versionId);
    if (p) {
      const scale = loadStageScale ? await loadStageScale(p.stage_scale_version_id) : null;
      if (!scale) errors.push({ code: "no_stage_scale", path: "stage_scale", message: "The stage scale is missing.", source: "progression" });
      else { const r = validateProgression(p.rules as unknown as ProgressionDoc, scale); errors.push(...r.errors); warnings.push(...r.warnings); }
    }
  }
  return { ok: errors.length === 0, errors, warnings, tests: null, checkedAt: new Date().toISOString() };
}

/** Put a version forward for review. The server validates first and refuses (422) with the engine's list. */
export async function submitForReview(admin: Admin, kind: DefinitionKind, versionId: string, actorId: string, loadStageScale?: StageScaleLoader): Promise<WriteResult<{ report: ValidationReport }> | { ok: false; status: 422; error: string; report: ValidationReport }> {
  const report = kind === "instrument"
    ? (await validateInstrument(admin, versionId, actorId, true))?.report
    : await validateOther(admin, kind as Exclude<DefinitionKind, "instrument">, versionId, loadStageScale);
  if (!report) return { ok: false, status: 404, error: "That version does not exist." };
  if (!report.ok) return { ok: false, status: 422, error: "Fix the validation problems before putting this forward.", report };
  const r = await submitVersion(admin, kind, versionId, actorId);
  return r.ok ? { ok: true, report } : r;
}

/** Copy a published scoring template into a draft checklist and re-validate it against THAT checklist. */
export async function copyScoringTemplate(admin: Admin, actorId: string, versionId: string, templateVersionId: string): Promise<WriteResult<{ report: ValidationReport; scoringHash: string }>> {
  const loaded = await loadInstrumentVersion(admin, versionId);
  if (!loaded) return { ok: false, status: 404, error: "That version does not exist." };
  const t = await loadRuleTemplateVersion(admin, templateVersionId);
  if (!t) return { ok: false, status: 404, error: "That template does not exist." };
  if (t.state !== "published") return { ok: false, status: 422, error: "Only a published scoring template can be copied." };
  const rules = t.rules as unknown as RulesDoc;
  const tests = (t.tests ?? []) as ScoringTestCase[];
  const re = revalidateTemplate(loaded.def, { rules, tests });
  const saved = await saveScoring(admin, actorId, versionId, rules as unknown as Record<string, unknown>, tests, templateVersionId);
  if (!saved.ok) return saved;
  return { ok: true, scoringHash: saved.scoringHash, report: { ok: re.errors.length === 0, errors: re.errors, warnings: re.warnings, tests: null, checkedAt: new Date().toISOString() } };
}

/** Copy a published layout template into the layout choices of a draft checklist (default and/or allowed). */
export async function layoutChoices(admin: Admin) {
  const published = await listLayoutTemplates(admin, ["published"]);
  return published.map((l) => ({ id: l.id, name: `${l.name} v${l.version_no}`, presentation: l.presentation ?? "standard_checklist", layout: l.layout ?? {} }));
}
