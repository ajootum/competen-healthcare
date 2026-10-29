/* eslint-disable @typescript-eslint/no-explicit-any */

// ── COMPETENCY STAGES AND THE VERSIONED SCALE-TO-STAGE MAPPING ── CFCA-STUDIO-P1, migration 660 ─────────────
//
// A score on a scale (DACUM 0-6, Benner 0-6, any scale configured on the Scoring page) is mapped to an agreed
// Competen competency stage (competency_stage: Unstaged, Novice, Advanced Beginner, Competent, Proficient,
// Expert -- rows, editable). The mapping is VERSIONED per scale: a draft is edited level by level, then
// published by someone OTHER than its author, and from then on it is immutable and hashed. Publishing a new
// version retires the previous one, which is kept. All of this is enforced by the 660 triggers -- this module
// says why in words before the database refuses.
//
// ⚠ AUTHOR AND PUBLISHER ARE TWO PEOPLE. A draft is made and edited under hq.quality.competency.author. It is
// published under hq.quality.competency.publish, from the Framework Publication page, and the database refuses
// a publisher who drafted the version (migration 660). DACUM version 1 was published on the owner's recorded
// approval (CFCA-STUDIO-P1).

export type Stage = { code: string; label: string; description: string | null; sortOrder: number; active: boolean };
export type Band = { levelId: string; score: number; stageCode: string };
export type Mapping = {
  id: string; scaleId: string; version: number; status: "draft" | "published" | "retired"; note: string | null;
  contentHash: string | null; approvalReference: string | null; createdBy: string | null; createdAt: string;
  publishedBy: string | null; publishedAt: string | null; retiredAt: string | null; bands: Band[];
};
export type ScaleView = { id: string; name: string; isDefault: boolean; levels: { id: string; score: number; label: string }[]; mappings: Mapping[] };
type Refusal = { ok: false; error: string };

/** Pure: the stage a score reaches under a mapping, or null when the mapping does not place it. */
export function stageFor(score: number | null | undefined, bands: readonly Band[]): string | null {
  if (score === null || score === undefined) return null;
  return bands.find(b => b.score === score)?.stageCode ?? null;
}

/** Pure: why a draft cannot be published yet -- every level of the scale needs a stage (the 660 rule). */
export function mappingProblems(levels: readonly { id: string; score: number; label: string }[], bands: readonly Band[], stages: readonly Stage[]): string[] {
  const have = new Set(bands.map(b => b.levelId));
  const known = new Set(stages.map(s => s.code));
  const out: string[] = [];
  for (const l of levels) if (!have.has(l.id)) out.push(`Level ${l.score} (${l.label}) has no stage.`);
  for (const b of bands) if (!known.has(b.stageCode)) out.push(`Level ${b.score} maps to an unknown stage.`);
  // A higher level never maps to an earlier stage: a warning in words, not a block (the order is configuration).
  const order = new Map(stages.map(s => [s.code, s.sortOrder]));
  const sorted = [...bands].sort((a, b) => a.score - b.score);
  for (let i = 1; i < sorted.length; i++)
    if ((order.get(sorted[i].stageCode) ?? 0) < (order.get(sorted[i - 1].stageCode) ?? 0)) out.push(`Level ${sorted[i].score} maps to an earlier stage than level ${sorted[i - 1].score}.`);
  return out;
}

/** Pure: the published mapping of a scale, if any. */
export const publishedOf = (scale: ScaleView): Mapping | null => scale.mappings.find(m => m.status === "published") ?? null;

/** Pure: the database refusal, in words. */
export function mappingRefusal(message: string | undefined): string {
  const m = message ?? "";
  if (/drafted a mapping cannot publish/i.test(m)) return "You drafted this version, so you cannot publish it. Another person with publication authority must publish it.";
  if (/have no stage/i.test(m)) return "Every level of the scale needs a stage before the mapping can be published.";
  if (/frozen|cannot become|never change|kept for the record/i.test(m)) return "A published or retired mapping cannot be changed. Draft a new version.";
  if (/belong to the scale/i.test(m)) return "That level is not on this mapping's scale.";
  if (/duplicate key|unique/i.test(m)) return "A draft for this scale was created meanwhile. Look again.";
  return "The mapping could not be changed just now. Nothing has changed.";
}

const STAGE_CODE = /^[a-z][a-z0-9_]{2,40}$/;
/** Pure: a stage row from HQ, or why it is refused. Mirrors the 660 CHECK. */
export function checkStage(body: any): { ok: true; stage: Stage } | Refusal {
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!STAGE_CODE.test(code)) return { ok: false, error: "The stage code is 3 to 41 lower-case letters, digits or underscores, starting with a letter." };
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (label.length < 2 || label.length > 80) return { ok: false, error: "The stage name is 2 to 80 characters." };
  const description = typeof body?.description === "string" && body.description.trim() ? body.description.trim() : null;
  if (description && description.length > 500) return { ok: false, error: "Keep the description under 500 characters." };
  return { ok: true, stage: { code, label, description, sortOrder: Number.isInteger(body?.sortOrder) ? body.sortOrder : 0, active: body?.active !== false } };
}

const rows = async (p: PromiseLike<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };

export async function listStages(admin: any): Promise<Stage[] | null> {
  const data = await rows(admin.from("competency_stage").select("code, label, description, sort_order, is_active").order("sort_order"));
  return data === null ? null : data.map((s: any) => ({ code: s.code, label: s.label, description: s.description ?? null, sortOrder: s.sort_order ?? 0, active: s.is_active !== false }));
}

export async function upsertStage(admin: any, s: Stage): Promise<{ ok: true } | Refusal> {
  const { error } = await admin.from("competency_stage").upsert({ code: s.code, label: s.label, description: s.description, sort_order: s.sortOrder, is_active: s.active, updated_at: new Date().toISOString() }, { onConflict: "code" });
  return error ? { ok: false, error: "The stage could not be saved just now." } : { ok: true };
}

/** Every scale with its levels and every version of its mapping, newest first. null = unreadable. */
export async function loadScalesWithMappings(admin: any): Promise<ScaleView[] | null> {
  const [scales, mappings] = await Promise.all([
    rows(admin.from("scoring_scales").select("id, name, is_default, scoring_levels(id, score, label)").order("is_default", { ascending: false })),
    rows(admin.from("competency_stage_mapping").select("id, scale_id, version, status, note, content_hash, approval_reference, created_by, created_at, published_by, published_at, retired_at").order("version", { ascending: false })),
  ]);
  if (scales === null || mappings === null) return null;
  const bands = mappings.length ? await rows(admin.from("competency_stage_mapping_band").select("mapping_id, level_id, stage_code").in("mapping_id", mappings.map((m: any) => m.id))) : [];
  if (bands === null) return null;
  const score = new Map<string, number>();
  for (const s of scales) for (const l of s.scoring_levels ?? []) score.set(l.id, l.score);
  return scales.map((s: any) => ({
    id: s.id, name: s.name, isDefault: s.is_default === true,
    levels: [...(s.scoring_levels ?? [])].sort((a: any, b: any) => a.score - b.score).map((l: any) => ({ id: l.id, score: l.score, label: l.label })),
    mappings: mappings.filter((m: any) => m.scale_id === s.id).map((m: any) => ({
      id: m.id, scaleId: m.scale_id, version: m.version, status: m.status, note: m.note ?? null, contentHash: m.content_hash ?? null,
      approvalReference: m.approval_reference ?? null, createdBy: m.created_by ?? null, createdAt: m.created_at, publishedBy: m.published_by ?? null,
      publishedAt: m.published_at ?? null, retiredAt: m.retired_at ?? null,
      bands: bands.filter((b: any) => b.mapping_id === m.id).map((b: any) => ({ levelId: b.level_id, score: score.get(b.level_id) ?? -1, stageCode: b.stage_code })).sort((a: Band, b: Band) => a.score - b.score),
    })),
  }));
}

/** A new draft version for a scale, starting from its published bands. Refused while a draft already exists. */
export async function createDraft(admin: any, scaleId: string, userId: string, note: string | null): Promise<{ ok: true; id: string } | Refusal> {
  const all = await loadScalesWithMappings(admin);
  const scale = all?.find(s => s.id === scaleId);
  if (!scale) return { ok: false, error: "That scale could not be found." };
  if (scale.mappings.some(m => m.status === "draft")) return { ok: false, error: "This scale already has a draft version. Edit or discard it first." };
  const version = Math.max(0, ...scale.mappings.map(m => m.version)) + 1;
  const ins = await admin.from("competency_stage_mapping").insert({ scale_id: scaleId, version, status: "draft", note, created_by: userId }).select("id").single();
  if (ins.error || !ins.data) return { ok: false, error: mappingRefusal(ins.error?.message) };
  const from = publishedOf(scale);
  if (from?.bands.length) {
    const b = await admin.from("competency_stage_mapping_band").insert(from.bands.map(x => ({ mapping_id: ins.data.id, level_id: x.levelId, stage_code: x.stageCode })));
    if (b.error) return { ok: false, error: mappingRefusal(b.error.message) };
  }
  return { ok: true, id: ins.data.id };
}

/** Set one level's stage on a draft. The 660 trigger refuses it on any other status. */
export async function setBand(admin: any, mappingId: string, levelId: string, stageCode: string): Promise<{ ok: true } | Refusal> {
  const { error } = await admin.from("competency_stage_mapping_band").upsert({ mapping_id: mappingId, level_id: levelId, stage_code: stageCode }, { onConflict: "mapping_id,level_id" });
  return error ? { ok: false, error: mappingRefusal(error.message) } : { ok: true };
}

/** Publish a draft as the given person. The database refuses the author, and an incomplete mapping. */
export async function publishMapping(admin: any, mappingId: string, userId: string): Promise<{ ok: true } | Refusal> {
  const { data, error } = await admin.from("competency_stage_mapping").update({ status: "published", published_by: userId }).eq("id", mappingId).eq("status", "draft").select("id");
  if (error) return { ok: false, error: mappingRefusal(error.message) };
  return data?.length ? { ok: true } : { ok: false, error: "That draft is no longer a draft. Look again." };
}

export async function discardDraft(admin: any, mappingId: string): Promise<{ ok: true } | Refusal> {
  const { data, error } = await admin.from("competency_stage_mapping").delete().eq("id", mappingId).eq("status", "draft").select("id");
  if (error) return { ok: false, error: mappingRefusal(error.message) };
  return data?.length ? { ok: true } : { ok: false, error: "That draft is no longer a draft. Look again." };
}
