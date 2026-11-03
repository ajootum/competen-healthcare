/* eslint-disable @typescript-eslint/no-explicit-any */
// SCHOLAR COMPETENCY ADAPTER, GROUPS FROM ASSESSMENT COMPONENTS (Checklist Studio).
// asmt_scholar_prefill_groups (migration 893) turns the active framework assessment components into item groups of a DRAFT
// version, skipping codes the version already has. It is the only competency-specific control on the Content tab.
import type { createAdminClient } from "@/lib/supabase/server";
import { friendlyDbError } from "../../studio/transitions";

type Admin = ReturnType<typeof createAdminClient>;

export interface PrefilledGroup { code: string; label: string; weight: number; position: number }

export async function prefillGroups(admin: Admin, versionId: string, actorId: string): Promise<{ ok: true; added: number; groups: PrefilledGroup[] } | { ok: false; status: number; error: string }> {
  const { data, error } = await admin.rpc("asmt_scholar_prefill_groups", { p_version: versionId, p_actor: actorId });
  if (error) {
    if (/could not find the function|does not exist|PGRST202/i.test(error.message)) return { ok: false, status: 501, error: "Pre-filling groups is not available on this environment yet (migration 893)." };
    return { ok: false, status: /not authori[sz]ed/i.test(error.message) ? 403 : /frozen/i.test(error.message) ? 409 : 422, error: friendlyDbError(error.message) };
  }
  const { data: rows } = await admin.from("asmt_group").select("code, label, weight, position").eq("version_id", versionId).order("position");
  const groups = ((rows ?? []) as any[]).map((g) => ({ code: String(g.code), label: String(g.label), weight: Number(g.weight ?? 1), position: Number(g.position ?? 0) }));
  return { ok: true, added: Number(data ?? 0), groups };
}
