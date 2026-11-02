// Scholar adapter: the stage scale of a stage scale version (stages and the bands that map rating ordinals to stages), read
// through the adapter's own function (migration 893). The assessor workspace is universal and takes this as a dependency.
import type { StageScale } from "@/lib/assessment/core";
import type { createAdminClient } from "@/lib/supabase/server";

export async function stageScaleViaRpc(admin: ReturnType<typeof createAdminClient>, stageScaleVersionId: string): Promise<StageScale | null> {
  const { data, error } = await admin.rpc("asmt_scholar_stage_scale", { p_stage_version: stageScaleVersionId });
  if (error || !data || typeof data !== "object") return null;
  const d = data as { stages?: StageScale["stages"]; bands?: StageScale["bands"] };
  if (!Array.isArray(d.stages) || !Array.isArray(d.bands)) return null;
  return { stages: d.stages, bands: d.bands };
}
