/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Optional, reviewed mapping of a rating scale (for example one imported from a workbook) onto a published stage scale
 * such as the Competen proficiency staging scale (owner decision 2, 3 Nov 2026).
 *
 * THE SMALLEST SAFE PATH THROUGH THE EXISTING BUILDERS. The 893 adapter already records "which rating levels sit in which
 * stage" as asmt_scholar_stage_band rows on a stage scale version, keyed by the rating scale version. This does the same
 * by hand: a NEW DRAFT stage scale (one definition per mapped rating scale, code <rating code>-STAGES) whose levels copy the
 * chosen published stage scale's stages (each level keeps source_level_id to the stage it came from), with bands built
 * ONLY from the stage the person assigned to each rating level. Nothing is inferred from numeric values: a level with no
 * assignment stays unmapped. The draft then goes through the ordinary review and publication by independent people,
 * and the original rating scale is never touched. Server only.
 */
import type { createAdminClient } from "@/lib/supabase/server";
import { friendlyDbError } from "./transitions";
import { loadScaleVersion } from "./read";

type Admin = ReturnType<typeof createAdminClient>;

export type StageAssignment = { levelCode: string; stageCode: string | null };
export type StageBand = { stageCode: string; fromOrdinal: number; toOrdinal: number };

/**
 * Pure: bands from explicit per-level assignments. Rating levels are taken in ordinal order; consecutive levels assigned
 * the same stage form one band. A level assigned nothing breaks the run and maps nowhere. Returns the bands and the
 * problems that make the mapping unusable (a stage that does not exist, a level named twice, no assignment at all).
 */
export function bandsFromAssignments(
  ratingLevels: { code: string; ordinal: number }[],
  stageCodes: string[],
  assignments: StageAssignment[],
): { bands: StageBand[]; problems: string[] } {
  const problems: string[] = [];
  const stageSet = new Set(stageCodes);
  const byLevel = new Map<string, string | null>();
  for (const a of assignments) {
    if (byLevel.has(a.levelCode)) problems.push(`Level ${a.levelCode} is assigned twice.`);
    if (!ratingLevels.some((l) => l.code === a.levelCode)) problems.push(`Level ${a.levelCode} is not on the rating scale.`);
    if (a.stageCode !== null && !stageSet.has(a.stageCode)) problems.push(`Stage ${a.stageCode} is not on the stage scale.`);
    byLevel.set(a.levelCode, a.stageCode);
  }
  const bands: StageBand[] = [];
  let current: StageBand | null = null;
  for (const l of [...ratingLevels].sort((a, b) => a.ordinal - b.ordinal)) {
    const stage = byLevel.get(l.code) ?? null;
    if (stage === null) { current = null; continue; }
    if (current && current.stageCode === stage && current.toOrdinal === l.ordinal - 1) current.toOrdinal = l.ordinal;
    else { current = { stageCode: stage, fromOrdinal: l.ordinal, toOrdinal: l.ordinal }; bands.push(current); }
  }
  if (!bands.length) problems.push("Assign at least one rating level to a stage.");
  // the same stage must not appear in two separate runs: a stage is one contiguous band of rating levels
  const seen = new Map<string, number>();
  for (const b of bands) seen.set(b.stageCode, (seen.get(b.stageCode) ?? 0) + 1);
  for (const [code, n] of seen) if (n > 1) problems.push(`Stage ${code} is given to two separate runs of levels. A stage is one contiguous band.`);
  return { bands, problems };
}

export type MappingResult = { ok: true; stageVersionId: string; code: string; created: "definition" | "version" } | { ok: false; status: number; error: string };

export async function createStageMappingDraft(
  admin: Admin, actorId: string, input: { ratingVersionId: string; stageVersionId: string; assignments: StageAssignment[]; note?: string | null },
): Promise<MappingResult> {
  const rating = await loadScaleVersion(admin, input.ratingVersionId);
  if (!rating) return { ok: false, status: 404, error: "That rating scale version does not exist." };
  if (rating.scale_kind !== "rating") return { ok: false, status: 422, error: "Only a rating scale can be mapped onto a stage scale." };
  const stage = await loadScaleVersion(admin, input.stageVersionId);
  if (!stage) return { ok: false, status: 404, error: "That stage scale version does not exist." };
  if (stage.scale_kind !== "stage") return { ok: false, status: 422, error: "The target must be a stage scale." };
  if (stage.state !== "published") return { ok: false, status: 422, error: "Map onto a PUBLISHED stage scale version, so the stages are the governed ones." };
  const { bands, problems } = bandsFromAssignments(rating.levels.map((l) => ({ code: l.code, ordinal: l.ordinal })), stage.levels.map((l) => l.code), input.assignments);
  if (problems.length) return { ok: false, status: 422, error: problems[0] };

  const code = `${rating.scale_code}-STAGES`.slice(0, 41);
  const name = `${rating.scale_name} stages`.slice(0, 200);
  const description = [
    `Stages of ${stage.scale_name} (${stage.scale_code} v${stage.version_no}) mapped by hand onto ${rating.scale_name} (${rating.scale_code} v${rating.version_no}).`,
    "Each band was assigned by a person and reviewed; nothing was inferred from numeric values.",
    input.note?.trim() ? `Note: ${input.note.trim().slice(0, 500)}` : "",
  ].filter(Boolean).join(" ");

  let defId: string;
  let created: "definition" | "version" = "definition";
  const { data: existing } = await admin.from("asmt_response_scale").select("id").eq("code", code).maybeSingle();
  if (existing) { defId = (existing as any).id; created = "version"; }
  else {
    const ins = await admin.from("asmt_response_scale").insert({ code, name, created_by: actorId }).select("id").single();
    if (ins.error) return { ok: false, status: 422, error: friendlyDbError(ins.error.message) };
    defId = (ins.data as any).id;
  }
  const ver = await admin.from("asmt_response_scale_version").insert({
    scale_id: defId, authored_by: [actorId], scale_kind: "stage", source_kind: "asmt_stage_scale_version", source_ref: stage.id, description,
  }).select("id").single();
  if (ver.error) { if (created === "definition") await admin.from("asmt_response_scale").delete().eq("id", defId); return { ok: false, status: 422, error: friendlyDbError(ver.error.message) }; }
  const stageVersionId = (ver.data as any).id as string;

  const lv = await admin.from("asmt_response_scale_level").insert(stage.levels.map((l) => ({
    version_id: stageVersionId, code: l.code, label: l.label, description: l.description ?? null, ordinal: l.ordinal, numeric_value: l.numeric_value ?? null,
    satisfactory: l.satisfactory ?? null, colour_token: l.colour_token ?? null, source_level_id: l.id ?? null, updated_by: actorId,
  })));
  if (lv.error) return { ok: false, status: 422, error: friendlyDbError(lv.error.message) };
  const bd = await admin.from("asmt_scholar_stage_band").insert(bands.map((b) => ({
    scale_version_id: stageVersionId, stage_code: b.stageCode, from_ordinal: b.fromOrdinal, to_ordinal: b.toOrdinal, rating_scale_version_id: rating.id, updated_by: actorId,
  })));
  if (bd.error) return { ok: false, status: 422, error: friendlyDbError(bd.error.message) };
  await admin.from("asmt_definition_event").insert({
    subject_table: "asmt_response_scale_version", subject_id: stageVersionId, event: "stage_mapping_drafted", actor_id: actorId,
    detail: { rating_version_id: rating.id, rating_code: rating.scale_code, stage_version_id: stage.id, stage_code: stage.scale_code, bands },
  });
  return { ok: true, stageVersionId, code, created };
}

export type ExistingMapping = { stageVersionId: string; code: string; name: string; versionNo: number; state: string; bands: StageBand[] };

/** The stage scale drafts and versions that carry bands for this rating scale version. */
export async function listMappingsFor(admin: Admin, ratingVersionId: string): Promise<ExistingMapping[]> {
  const { data: bands } = await admin.from("asmt_scholar_stage_band").select("scale_version_id, stage_code, from_ordinal, to_ordinal").eq("rating_scale_version_id", ratingVersionId);
  const ids = [...new Set(((bands ?? []) as any[]).map((b) => b.scale_version_id as string))];
  if (!ids.length) return [];
  const { data: vs } = await admin.from("asmt_response_scale_version").select("id, scale_id, version_no, state").in("id", ids);
  const { data: ds } = await admin.from("asmt_response_scale").select("id, code, name").in("id", ((vs ?? []) as any[]).map((v) => v.scale_id));
  const defOf = new Map(((ds ?? []) as any[]).map((d) => [d.id, d]));
  return ((vs ?? []) as any[]).map((v) => ({
    stageVersionId: v.id, code: defOf.get(v.scale_id)?.code ?? "", name: defOf.get(v.scale_id)?.name ?? "", versionNo: v.version_no, state: v.state,
    bands: ((bands ?? []) as any[]).filter((b) => b.scale_version_id === v.id).map((b) => ({ stageCode: b.stage_code, fromOrdinal: Number(b.from_ordinal), toOrdinal: Number(b.to_ordinal) })),
  })).sort((a, b) => b.versionNo - a.versionNo);
}

/** Published stage scale versions a rating scale can be mapped onto, with their stages. */
export async function listPublishedStageScales(admin: Admin): Promise<{ id: string; code: string; name: string; versionNo: number; stages: { code: string; label: string; ordinal: number }[] }[]> {
  const { data: vs } = await admin.from("asmt_response_scale_version").select("id, scale_id, version_no").eq("state", "published").eq("scale_kind", "stage");
  const ids = ((vs ?? []) as any[]).map((v) => v.id as string);
  if (!ids.length) return [];
  const [{ data: ds }, { data: lv }] = await Promise.all([
    admin.from("asmt_response_scale").select("id, code, name").in("id", ((vs ?? []) as any[]).map((v) => v.scale_id)),
    admin.from("asmt_response_scale_level").select("version_id, code, label, ordinal").in("version_id", ids).order("ordinal"),
  ]);
  const defOf = new Map(((ds ?? []) as any[]).map((d) => [d.id, d]));
  return ((vs ?? []) as any[]).map((v) => ({
    id: v.id, code: defOf.get(v.scale_id)?.code ?? "", name: defOf.get(v.scale_id)?.name ?? "", versionNo: v.version_no,
    stages: ((lv ?? []) as any[]).filter((l) => l.version_id === v.id).map((l) => ({ code: l.code, label: l.label, ordinal: Number(l.ordinal) })),
  })).sort((a, b) => a.name.localeCompare(b.name) || b.versionNo - a.versionNo);
}
