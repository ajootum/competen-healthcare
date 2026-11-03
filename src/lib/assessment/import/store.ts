/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Instrument import: the server side. Upload -> extract -> (the person corrects and confirms) -> register.
 *
 * REGISTRATION WRITES THROUGH THE EXISTING PATHS ONLY: asmt_catalogue_register (the catalogue identity, now with
 * provenance), createFirstVersion / saveSettings / saveContent / createDefinition / saveScale (the Studio writers), so the
 * 890 lifecycle guard sees an ordinary draft authored by the actor. There is no import-specific table of content, and
 * nothing here can publish: the draft goes through review and publication like any other.
 *
 * THE WORKBOOK IS THE SOURCE RECORD. It is stored unchanged in the private asmt-imports bucket, named by the import id,
 * with its sha256 on the row, and every instrument registered from it points back (asmt_instrument.import_id).
 */
import { createHash, randomUUID } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/server";
import { loadFamilies } from "../catalogue/families";
import { loadRegistries } from "../studio/read";
import { createDefinition, createFirstVersion, saveContent, saveScale, saveSettings } from "../studio/write";
import { readWorkbookGrids } from "./grid";
import { buildInstrumentPlan } from "./to-content";
import { draftWorkbook, readinessProblems } from "./workbook";
import { IMPORT_BUCKET, IMPORT_MAX_BYTES, type ImportGroup, type RegisteredInstrument, type SheetDraft, type WorkbookDraft } from "./types";

type Admin = ReturnType<typeof createAdminClient>;
export type ImportResult<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

const EXT = /\.(xlsx|xlsm|xls)$/i;
// The select lists below are literals, so the plane boundary scan can read them.

export interface ImportRow {
  id: string; file_name: string; file_sha256: string; byte_size: number; storage_bucket: string; storage_path: string;
  status: "extracted" | "registered" | "discarded"; draft: WorkbookDraft & { registered?: RegisteredInstrument[] }; extracted_at: string; registered_at: string | null; created_by: string | null; created_at: string;
}

export function fileProblem(file: { name: string; size: number }): string | null {
  if (!EXT.test(file.name)) return "Upload an Excel workbook (.xlsx, .xlsm or .xls).";
  if (file.size <= 0) return "The file is empty.";
  if (file.size > IMPORT_MAX_BYTES) return "The workbook must be 25 MB or smaller.";
  return null;
}

/** Upload, extract, store. Returns the import record with its draft. The person has not registered anything yet. */
export async function createImport(admin: Admin, actorId: string, file: File): Promise<ImportResult<{ row: ImportRow }>> {
  const problem = fileProblem(file);
  if (problem) return fail(400, problem);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let grids;
  try { grids = readWorkbookGrids(bytes); } catch { return fail(400, "The file could not be read as a workbook. Save it again as .xlsx and retry."); }
  if (!grids.length) return fail(400, "The workbook has no sheets.");
  const families = await loadFamilies(admin);
  const draft = draftWorkbook(grids, { fileName: file.name, sha256, byteSize: file.size }, families);
  const id = randomUUID();
  const safe = file.name.replace(/[^A-Za-z0-9._ -]+/g, "_").slice(0, 120);
  const path = `${id}/${safe}`;
  const up = await admin.storage.from(IMPORT_BUCKET).upload(path, Buffer.from(bytes), { contentType: file.type || "application/octet-stream", upsert: false });
  if (up.error) return fail(502, /bucket/i.test(up.error.message) ? "The import store is not available on this environment yet (migration 930)." : "The workbook could not be stored just now. Try again shortly.");
  const ins = await admin.from("asmt_import").insert({ id, file_name: file.name, file_sha256: sha256, byte_size: file.size, storage_bucket: IMPORT_BUCKET, storage_path: path, status: "extracted", draft, created_by: actorId }).select("id, file_name, file_sha256, byte_size, storage_bucket, storage_path, status, draft, extracted_at, registered_at, created_by, created_at").single();
  if (ins.error) {
    await admin.storage.from(IMPORT_BUCKET).remove([path]).catch(() => undefined);
    return fail(502, /relation .* does not exist/i.test(ins.error.message) ? "Importing is not available on this environment yet (migration 930)." : ins.error.message);
  }
  return { ok: true, row: ins.data as unknown as ImportRow };
}

export async function loadImport(admin: Admin, id: string): Promise<ImportRow | null> {
  const { data } = await admin.from("asmt_import").select("id, file_name, file_sha256, byte_size, storage_bucket, storage_path, status, draft, extracted_at, registered_at, created_by, created_at").eq("id", id).maybeSingle();
  return (data as unknown as ImportRow | null) ?? null;
}

/** The lists the correction screen needs beside the draft. */
export async function importChoices(admin: Admin) {
  const [families, registries] = await Promise.all([loadFamilies(admin), loadRegistries(admin)]);
  return { families, purposes: registries.purposes };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ROLES = new Set(["section", "number", "criterion", "rating", "na", "option", "option_group", "text", "signoff", "ignore", "unknown"]);
const RESPONDENTS = new Set(["self", "assessor", "auditor"]);

/**
 * The corrected draft, kept to what a person may change: titles, prompts, inclusion, column roles, grouping, family,
 * purpose, respondents, classification. Detected structure (rows, keys, flags, unplaced text) stays as extracted, so the
 * record always shows what the parser saw.
 */
export function mergeCorrections(saved: WorkbookDraft, incoming: any): WorkbookDraft {
  const sheets: SheetDraft[] = saved.sheets.map((s) => {
    const inc = Array.isArray(incoming?.sheets) ? incoming.sheets.find((x: any) => x?.name === s.name) : null;
    if (!inc) return s;
    const columns = s.columns.map((c) => {
      const ic = Array.isArray(inc.columns) ? inc.columns.find((x: any) => x?.col === c.col && x?.header === c.header) : null;
      if (!ic) return c;
      const role = ROLES.has(ic.role) ? ic.role : c.role;
      const fieldLabel = role === "text" ? text(ic.fieldLabel, 120) || c.fieldLabel || c.header : c.fieldLabel;
      return { ...c, role, fieldLabel };
    });
    const sections = s.sections.map((sec) => {
      const is = Array.isArray(inc.sections) ? inc.sections.find((x: any) => x?.key === sec.key) : null;
      return is ? { ...sec, title: text(is.title, 200) || sec.title, guidance: is.guidance === null ? null : text(is.guidance, 1000) || sec.guidance, include: is.include !== false } : sec;
    });
    const items = s.items.map((it) => {
      const ii = Array.isArray(inc.items) ? inc.items.find((x: any) => x?.key === it.key) : null;
      return ii ? { ...it, prompt: text(ii.prompt, 2000) || it.prompt, number: ii.number === null ? null : text(ii.number, 20) || it.number, include: ii.include !== false } : it;
    });
    const scale = s.scale && inc.scale && Array.isArray(inc.scale.levels)
      ? { ...s.scale, levels: s.scale.levels.map((l) => { const il = inc.scale.levels.find((x: any) => x?.value === l.value); return il ? { ...l, label: il.label === null ? null : text(il.label, 120) || l.label, description: text(il.description, 2000) || l.description } : l; }) }
      : s.scale;
    return { ...s, title: text(inc.title, 200) || s.title, columns, sections, items, scale };
  });
  const names = new Set(sheets.map((s) => s.name));
  const groups: ImportGroup[] = Array.isArray(incoming?.groups) ? incoming.groups.map((g: any, i: number) => ({
    key: text(g?.key, 60) || `g-${i}`,
    title: text(g?.title, 200),
    sheets: Array.isArray(g?.sheets) ? g.sheets.filter((n: unknown): n is string => typeof n === "string" && names.has(n)) : [],
    family: /^[A-Z]{1,6}$/.test(g?.family ?? "") ? g.family : null,
    familySuggested: Boolean(g?.familySuggested),
    description: text(g?.description, 2000),
    purposeCode: /^[a-z][a-z0-9_]{1,40}$/.test(g?.purposeCode ?? "") ? g.purposeCode : null,
    respondentRoles: Array.isArray(g?.respondentRoles) ? [...new Set(g.respondentRoles.filter((r: unknown): r is string => typeof r === "string" && RESPONDENTS.has(r)))] : [],
    terms: Array.isArray(g?.terms) ? g.terms.filter((t: any) => typeof t?.termId === "string" && /^[0-9a-f-]{36}$/i.test(t.termId)).map((t: any) => ({ termId: t.termId, isPrimary: Boolean(t.isPrimary) })) : [],
    confirmed: Boolean(g?.confirmed),
  })).filter((g: ImportGroup) => g.sheets.length) : saved.groups;
  const grouped = new Set(groups.flatMap((g) => g.sheets));
  const excluded = sheets.filter((s) => !grouped.has(s.name)).map((s) => {
    const ie = Array.isArray(incoming?.excluded) ? incoming.excluded.find((x: any) => x?.sheet === s.name) : null;
    const was = saved.excluded.find((e) => e.sheet === s.name);
    return { sheet: s.name, reason: text(ie?.reason, 300) || was?.reason || "Excluded by the person importing.", confirmed: Boolean(ie?.confirmed) };
  });
  return { ...saved, sheets, groups, excluded };
}

export async function saveImportDraft(admin: Admin, id: string, incoming: unknown): Promise<ImportResult<{ draft: WorkbookDraft }>> {
  const row = await loadImport(admin, id);
  if (!row) return fail(404, "That import does not exist.");
  if (row.status !== "extracted") return fail(409, "This import has already been registered or discarded.");
  const { registered, ...saved } = row.draft;
  const draft = mergeCorrections(saved as WorkbookDraft, incoming);
  const { error } = await admin.from("asmt_import").update({ draft: registered ? { ...draft, registered } : draft }).eq("id", id).eq("status", "extracted");
  if (error) return fail(422, error.message);
  return { ok: true, draft };
}

export async function discardImport(admin: Admin, id: string): Promise<ImportResult> {
  const { data, error } = await admin.from("asmt_import").update({ status: "discarded" }).eq("id", id).eq("status", "extracted").select("id");
  if (error) return fail(422, error.message);
  return (data ?? []).length ? { ok: true } : fail(409, "Only an import that is still being corrected can be discarded.");
}

/** A five-minute signed link to the original workbook. */
export async function signImportFile(admin: Admin, row: ImportRow): Promise<string | null> {
  const { data, error } = await admin.storage.from(row.storage_bucket).createSignedUrl(row.storage_path, 300);
  return error ? null : (data?.signedUrl ?? null);
}

/**
 * Register every confirmed group as a Draft instrument. Groups already registered on an earlier attempt are skipped, so a
 * failure part way can be retried without duplicates. The import record keeps the list of what it produced.
 */
export async function registerImport(admin: Admin, actorId: string, id: string): Promise<ImportResult<{ registered: RegisteredInstrument[]; warnings: string[] }>> {
  const row = await loadImport(admin, id);
  if (!row) return fail(404, "That import does not exist.");
  if (row.status === "discarded") return fail(409, "This import was discarded.");
  const { registered: already = [], ...draft } = row.draft;
  const problems = readinessProblems(draft as WorkbookDraft);
  if (problems.length) return fail(422, problems[0]);
  const registered: RegisteredInstrument[] = [...already];
  const warnings: string[] = [];
  const now = new Date().toISOString();
  for (const g of draft.groups) {
    if (registered.some((r) => r.groupKey === g.key)) continue;
    const plan = buildInstrumentPlan(draft as WorkbookDraft, g, randomUUID, now);
    warnings.push(...plan.notes);
    const reg = await admin.rpc("asmt_catalogue_register", {
      p_family: g.family, p_name: plan.title, p_description: g.description || null, p_kind: "assessment", p_actor: actorId,
      p_terms: g.terms.map((t) => ({ term_id: t.termId, is_primary: t.isPrimary })), p_import: id, p_sheet: g.sheets.join(" + "),
    });
    if (reg.error) return await stop(`"${plan.title}" could not be registered: ${reg.error.message}`);
    const instrumentId = String(reg.data);
    const { data: ins } = await admin.from("asmt_instrument").select("code").eq("id", instrumentId).maybeSingle();
    const code = (ins as any)?.code ?? "";

    let scaleVersionId: string | null = null;
    if (plan.scale) {
      const def = await createDefinition(admin, actorId, { type: "scale", code: `${code}-SCALE`.slice(0, 41), name: plan.scale.name, description: plan.scale.description, scaleKind: "rating" });
      if (!def.ok) return await stop(`The scale of "${plan.title}" could not be created: ${def.error}`);
      scaleVersionId = def.versionId;
      const sv = await saveScale(admin, actorId, scaleVersionId, { description: plan.scale.description, levels: plan.scale.levels, states: plan.scale.states });
      if (!sv.ok) return await stop(`The scale levels of "${plan.title}" could not be saved: ${sv.error}`);
    }
    const v = await createFirstVersion(admin, actorId, instrumentId, { purpose: g.purposeCode!, methods: [], deliveryModes: [], respondentRoles: g.respondentRoles });
    if (!v.ok) return await stop(`The first draft of "${plan.title}" could not be created: ${v.error}`);
    const st = await saveSettings(admin, actorId, v.versionId, { title: plan.title, summary: plan.summary });
    if (!st.ok) warnings.push(`The summary of "${plan.title}" was not saved: ${st.error}`);
    const content = { ...plan.content, items: plan.content.items.map((it) => (it.response_type === "rating_scale" ? { ...it, scale_version_id: scaleVersionId } : it)) };
    const sc = await saveContent(admin, actorId, v.versionId, content);
    if (!sc.ok) return await stop(`The content of "${plan.title}" could not be written: ${sc.error}`);
    await admin.rpc("asmt_catalogue_event", { p_instrument: instrumentId, p_event: "catalogue_imported", p_actor: actorId, p_detail: { import_id: id, sheets: g.sheets, items: content.items.length, sections: content.sections.length, scale_version_id: scaleVersionId, flags: flagsOf(draft as WorkbookDraft, g) } });
    registered.push({ groupKey: g.key, instrumentId, code, versionId: v.versionId, scaleVersionId, title: plan.title });
    await admin.from("asmt_import").update({ draft: { ...draft, registered } }).eq("id", id);
  }
  const done = await admin.from("asmt_import").update({ status: "registered", registered_at: new Date().toISOString(), draft: { ...draft, registered } }).eq("id", id);
  if (done.error) warnings.push(`The import record could not be marked as registered: ${done.error.message}`);
  return { ok: true, registered, warnings };

  async function stop(error: string): Promise<ImportResult<never>> {
    await admin.from("asmt_import").update({ draft: { ...draft, registered } }).eq("id", id);
    return fail(422, registered.length ? `${error} ${registered.length} instrument${registered.length === 1 ? " was" : "s were"} registered before this; retry to continue with the rest.` : error);
  }
}

function flagsOf(d: WorkbookDraft, g: ImportGroup): string[] {
  return [...new Set(d.sheets.filter((s) => g.sheets.includes(s.name)).flatMap((s) => s.flags.map((f) => f.code)))];
}
