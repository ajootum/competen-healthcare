/* eslint-disable @typescript-eslint/no-explicit-any */
// SCHOLAR COMPETENCY ADAPTER, SCALE IMPORT (Checklist Studio S2).
// A scoring scale (and optionally its published stage mapping) becomes a DRAFT response scale version through
// asmt_scholar_import_scale (migration 893), so it goes through the normal lifecycle and somebody else publishes it.
// This file is the Studio's only knowledge of where such scales come from.
import type { createAdminClient } from "@/lib/supabase/server";
import { friendlyDbError } from "../../studio/transitions";

type Admin = ReturnType<typeof createAdminClient>;

export interface SourceScale { id: string; name: string; levels: number; mappings: { id: string; version: number }[] }

export async function listSourceScales(admin: Admin): Promise<SourceScale[]> {
  const { data: scales } = await admin.from("scoring_scales").select("id, name").order("name");
  const ids = ((scales ?? []) as any[]).map((s) => s.id);
  if (!ids.length) return [];
  const [{ data: levels }, { data: maps }] = await Promise.all([
    admin.from("scoring_levels").select("scale_id").in("scale_id", ids),
    admin.from("competency_stage_mapping").select("id, scale_id, version, status").in("scale_id", ids).eq("status", "published"),
  ]);
  return ((scales ?? []) as any[]).map((s) => ({
    id: s.id, name: s.name,
    levels: ((levels ?? []) as any[]).filter((l) => l.scale_id === s.id).length,
    mappings: ((maps ?? []) as any[]).filter((m) => m.scale_id === s.id).map((m) => ({ id: m.id, version: m.version })),
  })).filter((s) => s.levels > 0);
}

export async function importScale(admin: Admin, actorId: string, scaleId: string, mappingId: string | null): Promise<{ ok: true; versionId: string } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("asmt_scholar_import_scale", { p_scale_id: scaleId, p_mapping_id: mappingId, p_actor: actorId });
  if (error) {
    if (/could not find the function|does not exist|PGRST202/i.test(error.message)) return { ok: false, error: "Importing a scale is not available on this environment yet (migration 893)." };
    return { ok: false, error: friendlyDbError(error.message) };
  }
  return { ok: true, versionId: String(data) };
}

/** The engine stage scale of a stage scale version: { stages, bands }. Falls back to the levels with no bands. */
export async function readStageScale(admin: Admin, stageVersionId: string): Promise<{ stages: { code: string; label: string; ordinal: number }[]; bands: { stage: string; from_ordinal: number; to_ordinal: number }[] } | null> {
  const r = await admin.rpc("asmt_scholar_stage_scale", { p_stage_version: stageVersionId });
  if (!r.error && r.data) return r.data as any;
  const { data: head } = await admin.from("asmt_response_scale_version").select("scale_kind").eq("id", stageVersionId).maybeSingle();
  if (!head || head.scale_kind !== "stage") return null;
  const { data: lv } = await admin.from("asmt_response_scale_level").select("code, label, ordinal").eq("version_id", stageVersionId).order("ordinal");
  return { stages: ((lv ?? []) as any[]).map((l) => ({ code: l.code, label: l.label, ordinal: Number(l.ordinal) })), bands: [] };
}
