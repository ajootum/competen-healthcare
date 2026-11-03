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
import { saveContent, saveScoring, saveSettings } from "../studio/write";
import { detectSheet } from "./detect";
import { readWorkbookGrids } from "./grid";
import { patchPartialOptions, proposeScoring, type ScoringProposal } from "./scoring";
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
  const patched = patchPartialOptions(loaded.content);
  if (patched.changed.length) {
    const sc = await saveContent(admin, actorId, versionId, patched.content);
    if (!sc.ok) return { ok: false, status: sc.status, error: sc.error };
  }
  const def = toDefinition(patched.content, { instrumentCode: loaded.instrument.code, versionNo: loaded.version.version_no, versionId, purposeCode: loaded.version.purpose_code, methodCodes: loaded.version.method_codes });
  const proposal = proposeScoring({ sheets, def, respondentRoles: loaded.version.respondent_roles ?? [] });
  const allFlags = [...flags, ...proposal.flags];
  if (!proposal.rules) return { ok: false, status: 422, error: proposal.flags.find((f) => f.code === "no_scoring_proposed")?.message ?? "No scoring could be proposed.", flags: allFlags };
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
export async function recordProposal(admin: Admin, actorId: string, versionId: string, detail: { family: string; flags: ImportFlag[]; deliveryModes: string[]; patchedOptions: string[]; source: "import" | "workbook" }): Promise<void> {
  await admin.from("asmt_definition_event").insert({ subject_table: "asmt_instrument_version", subject_id: versionId, event: "scoring_proposed", actor_id: actorId, detail });
}

export type ProposalRecord = { at: string; family: string; flags: ImportFlag[]; deliveryModes: string[]; patchedOptions: string[]; source: string };

export async function latestProposal(admin: Admin, versionId: string): Promise<ProposalRecord | null> {
  const { data } = await admin.from("asmt_definition_event").select("detail, created_at").eq("subject_table", "asmt_instrument_version").eq("subject_id", versionId).eq("event", "scoring_proposed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const d = ((data as any).detail ?? {}) as Partial<ProposalRecord>;
  return { at: (data as any).created_at, family: String(d.family ?? "none"), flags: Array.isArray(d.flags) ? (d.flags as ImportFlag[]) : [], deliveryModes: Array.isArray(d.deliveryModes) ? (d.deliveryModes as string[]) : [], patchedOptions: Array.isArray(d.patchedOptions) ? (d.patchedOptions as string[]) : [], source: String(d.source ?? "import") };
}
