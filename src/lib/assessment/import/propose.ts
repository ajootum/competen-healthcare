/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Propose scoring from the source workbook" for a draft that was imported earlier (owner GO 3 Nov 2026, late): the same
 * deterministic proposal the importer makes, run again from the stored import record (the corrected draft of the workbook
 * on asmt_import, or the workbook itself from the bucket when the record holds no sheets). Writes only to the draft:
 * the Partial-as-not-met option patch (content), the proposed rules and tests (scoring), the delivery mode when none is set
 * (settings), and a scoring_proposed event carrying the flags. Author capability is checked by the route. Server only.
 */
import type { createAdminClient } from "@/lib/supabase/server";
import { toDefinition } from "../studio/assemble";
import { loadInstrumentVersion } from "../studio/read";
import { createDefinition, saveContent, saveRuleTemplate, saveScoring, saveSettings } from "../studio/write";
import { detectSheet } from "./detect";
import { readWorkbookGrids } from "./grid";
import { proposeScoring, type ScoringProposal } from "./scoring";
import { PROFILES, PROPOSED_DECISION_TEMPLATE, applyProfile, type ProfileId } from "./profiles";
import { loadImport } from "./store";
import type { ImportFlag, SheetDraft } from "./types";

type Admin = ReturnType<typeof createAdminClient>;
export type ProposeResult = { ok: true; family: ScoringProposal["family"]; flags: ImportFlag[]; deliveryModes: string[]; patchedOptions: string[] } | { ok: false; status: number; error: string; flags?: ImportFlag[] };

export async function proposeFromWorkbook(admin: Admin, actorId: string, versionId: string): Promise<ProposeResult> {
  const loaded = await loadInstrumentVersion(admin, versionId);
  if (!loaded) return { ok: false, status: 404, error: "That version does not exist." };
  if (loaded.version.state !== "draft") return { ok: false, status: 409, error: "Scoring can be proposed only on a draft." };
  const { data: ins } = await admin.from("asmt_instrument").select("import_id, import_sheet").eq("id", loaded.instrument.id).maybeSingle();
  const importId = (ins as any)?.import_id as string | null;
  if (!importId) return { ok: false, status: 422, error: "This draft was not imported from a workbook, so there is no source to propose from. Start from a starter rule set instead." };
  const row = await loadImport(admin, importId);
  if (!row) return { ok: false, status: 422, error: "The import record of this draft is missing." };
  const names = String((ins as any)?.import_sheet ?? "").split(" + ").map((s) => s.trim()).filter(Boolean);
  let sheets: SheetDraft[] = (row.draft?.sheets ?? []).filter((s) => names.includes(s.name));
  const flags: ImportFlag[] = [];
  if (!sheets.length) {
    // the record holds no corrected draft for these sheets: read the stored workbook itself
    const file = await admin.storage.from(row.storage_bucket).download(row.storage_path);
    if (file.error || !file.data) return { ok: false, status: 502, error: "The stored workbook could not be read." };
    const grids = readWorkbookGrids(new Uint8Array(await file.data.arrayBuffer()));
    sheets = grids.filter((g) => names.includes(g.name)).map(detectSheet);
    flags.push({ code: "reparsed_workbook", message: "The import record held no corrected draft for this instrument's sheets, so the stored workbook was read again as extracted.", severity: "info" });
    if (!sheets.length) return { ok: false, status: 422, error: `The stored workbook has no sheet named ${names.join(" + ")}.` };
  }
  const def = toDefinition(loaded.content, { instrumentCode: loaded.instrument.code, versionNo: loaded.version.version_no, versionId, purposeCode: loaded.version.purpose_code, methodCodes: loaded.version.method_codes });
  const proposal = proposeScoring({ sheets, def, respondentRoles: loaded.version.respondent_roles ?? [] });
  const allFlags = [...flags, ...proposal.flags];
  if (!proposal.rules || !proposal.content) return { ok: false, status: 422, error: proposal.flags.find((f) => f.code === "no_scoring_proposed")?.message ?? "No scoring could be proposed.", flags: allFlags };
  // the profile's content changes (option values, N/A with a reason, mandatory, evidence fields) are written first
  const sc = await saveContent(admin, actorId, versionId, { ...loaded.content, items: proposal.content.items });
  if (!sc.ok) return { ok: false, status: sc.status, error: sc.error };
  const patched = { changed: proposal.flags.filter((f) => f.code === "profile_content_changes").map((f) => f.message) };
  const ss = await saveScoring(admin, actorId, versionId, proposal.rules as unknown as Record<string, unknown>, proposal.tests, null);
  if (!ss.ok) return { ok: false, status: ss.status, error: ss.error };
  if (proposal.deliveryModes.length && !(loaded.version.delivery_modes ?? []).length) {
    const st = await saveSettings(admin, actorId, versionId, { delivery_modes: proposal.deliveryModes });
    if (!st.ok) allFlags.push({ code: "delivery_mode_not_saved", message: `The delivery mode was not saved: ${st.error}`, severity: "warn" });
  }
  await recordProposal(admin, actorId, versionId, { family: proposal.family, flags: allFlags, deliveryModes: proposal.deliveryModes, patchedOptions: patched.changed, source: "workbook" });
  return { ok: true, family: proposal.family, flags: allFlags, deliveryModes: proposal.deliveryModes, patchedOptions: patched.changed };
}

/** The scoring_proposed event: the audit trail of a proposal and what the Scoring tab shows until the author accepts it. */
export async function recordProposal(admin: Admin, actorId: string, versionId: string, detail: { family: string; flags: ImportFlag[]; deliveryModes: string[]; patchedOptions: string[]; source: "import" | "workbook" | "profile" }): Promise<void> {
  await admin.from("asmt_definition_event").insert({ subject_table: "asmt_instrument_version", subject_id: versionId, event: "scoring_proposed", actor_id: actorId, detail });
}

export type ProposalRecord = { at: string; family: string; flags: ImportFlag[]; deliveryModes: string[]; patchedOptions: string[]; source: string };

export async function latestProposal(admin: Admin, versionId: string): Promise<ProposalRecord | null> {
  const { data } = await admin.from("asmt_definition_event").select("detail, created_at").eq("subject_table", "asmt_instrument_version").eq("subject_id", versionId).eq("event", "scoring_proposed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const d = ((data as any).detail ?? {}) as Partial<ProposalRecord>;
  return { at: (data as any).created_at, family: String(d.family ?? "none"), flags: Array.isArray(d.flags) ? (d.flags as ImportFlag[]) : [], deliveryModes: Array.isArray(d.deliveryModes) ? (d.deliveryModes as string[]) : [], patchedOptions: Array.isArray(d.patchedOptions) ? (d.patchedOptions as string[]) : [], source: String(d.source ?? "import") };
}

export type ApplyProfileResult =
  | { ok: true; profileId: ProfileId; flags: ImportFlag[]; deliveryModes: string[]; changes: string[]; decisionTemplate: { versionId: string; created: boolean } | null }
  | { ok: false; status: number; error: string };

/**
 * Apply a scoring profile to a draft that already exists (ASMT-SCORING-INTEGRATION-01, owner GO 4 Nov 2026): the same
 * configuration the importer writes, chosen explicitly by the author on the Scoring & Rules tab, so the production drafts
 * made before the profiles existed can take them. Writes only to the draft: content (option values, N/A with a reason,
 * mandatory, the evidence fields), scoring (rules + tests, marked proposed), the delivery mode when none is set, and a
 * scoring_profile_applied event. For a graded assessment it also makes sure the SEPARATE proposed competency decision
 * exists as a DRAFT rule template, which governance approves (or not) through the ordinary template lifecycle.
 */
export async function applyProfileToDraft(admin: Admin, actorId: string, versionId: string, profileId: ProfileId): Promise<ApplyProfileResult> {
  const profile = PROFILES[profileId];
  if (!profile) return { ok: false, status: 400, error: "Unknown profile." };
  const loaded = await loadInstrumentVersion(admin, versionId);
  if (!loaded) return { ok: false, status: 404, error: "That version does not exist." };
  if (loaded.version.state !== "draft") return { ok: false, status: 409, error: "A profile can be applied only to a draft." };
  const def = toDefinition(loaded.content, { instrumentCode: loaded.instrument.code, versionNo: loaded.version.version_no, versionId, purposeCode: loaded.version.purpose_code, methodCodes: loaded.version.method_codes });
  const unfit = profile.unfit(def);
  if (unfit) return { ok: false, status: 422, error: `${profile.label} does not fit this checklist: ${unfit}` };
  const applied = applyProfile(loaded.content, profileId, { def, respondentRoles: loaded.version.respondent_roles ?? [] });
  const sc = await saveContent(admin, actorId, versionId, applied.content);
  if (!sc.ok) return { ok: false, status: sc.status, error: sc.error };
  const ss = await saveScoring(admin, actorId, versionId, applied.rules as unknown as Record<string, unknown>, applied.tests, null);
  if (!ss.ok) return { ok: false, status: ss.status, error: ss.error };
  const flags: ImportFlag[] = [...applied.flags];
  if (applied.deliveryModes.length && !(loaded.version.delivery_modes ?? []).length) {
    const st = await saveSettings(admin, actorId, versionId, { delivery_modes: applied.deliveryModes });
    if (!st.ok) flags.push({ code: "delivery_mode_not_saved", message: `The delivery mode was not saved: ${st.error}`, severity: "warn" });
  }
  let decisionTemplate: { versionId: string; created: boolean } | null = null;
  if (profileId === "graded_assessment") {
    const t = await ensureDecisionTemplate(admin, actorId);
    if (t.ok) {
      decisionTemplate = { versionId: t.versionId, created: t.created };
      flags.push({ code: "decision_template", message: `${t.created ? "Created" : "Found"} the separate proposed competency decision template ${PROPOSED_DECISION_TEMPLATE.code} (draft, not active). Clinical governance approves it through the template lifecycle; once published, an author copies it into a new version of this instrument.`, severity: "info" });
    } else {
      flags.push({ code: "decision_template_failed", message: `The proposed competency decision template could not be prepared: ${t.error}`, severity: "warn" });
    }
  }
  await admin.from("asmt_definition_event").insert({ subject_table: "asmt_instrument_version", subject_id: versionId, event: "scoring_profile_applied", actor_id: actorId, detail: { profile: profileId, profileVersion: applied.rules.profile?.version ?? null, changes: applied.changes, flags, deliveryModes: applied.deliveryModes, decisionTemplate } });
  await recordProposal(admin, actorId, versionId, { family: profileId === "graded_assessment" ? "rating" : "compliance", flags, deliveryModes: applied.deliveryModes, patchedOptions: applied.changes, source: "profile" });
  return { ok: true, profileId, flags, deliveryModes: applied.deliveryModes, changes: applied.changes, decisionTemplate };
}

/** The proposed competency decision as a rule template: found by its code, else created as a draft carrying its rules. */
export async function ensureDecisionTemplate(admin: Admin, actorId: string): Promise<{ ok: true; versionId: string; created: boolean } | { ok: false; error: string }> {
  const { data: def } = await admin.from("asmt_rule_template").select("id").eq("code", PROPOSED_DECISION_TEMPLATE.code).maybeSingle();
  if (def) {
    const { data: v } = await admin.from("asmt_rule_template_version").select("id").eq("template_id", (def as any).id).order("version_no", { ascending: false }).limit(1).maybeSingle();
    if (v) return { ok: true, versionId: (v as any).id as string, created: false };
  }
  const made = await createDefinition(admin, actorId, { type: "rule_template", code: PROPOSED_DECISION_TEMPLATE.code, name: PROPOSED_DECISION_TEMPLATE.name, description: PROPOSED_DECISION_TEMPLATE.description });
  if (!made.ok) return { ok: false, error: made.error };
  const saved = await saveRuleTemplate(admin, actorId, made.versionId, PROPOSED_DECISION_TEMPLATE.rules() as unknown as Record<string, unknown>, [], PROPOSED_DECISION_TEMPLATE.description);
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, versionId: made.versionId, created: true };
}
