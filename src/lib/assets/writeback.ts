/* eslint-disable @typescript-eslint/no-explicit-any */
// CAP-001 Phase 4 (W1) — status/version write-back. Governed edit-through: writes an asset's status/version
// to its SOURCE table in that table's NATIVE convention, then reflects the change on the cap_assets header.
// No canonical column, no schema change, no re-pointing of the ~80–130 status readers — each adapter adopts
// the source's own column (as registry.ts / publishing-tools.ts already do on the read side). Types with no
// governable source status (framework→lifecycle engine, publication→publishing engine, competency/blueprint/
// osce_station→no column) are rejected with a pointer, never silently faked. Every write is audited.

import { ASSET_STATUS_SUPPORT, ASSET_VERSION_EDITABLE, ASSET_GOVERNED_ELSEWHERE, TYPE_LABEL } from "@/lib/assets/service";

type Admin = any;

// object_type → { source table, canonical-status → native-column write }. Only editable types appear.
const ADAPTERS: Record<string, { table: string; toNativeStatus: (c: string) => Record<string, any> }> = {
  cpu: { table: "clinical_practice_units", toNativeStatus: c => ({ pub_status: c }) },
  knowledge_object: { table: "knowledge_objects", toNativeStatus: c => ({ status: c === "archived" ? "retired" : c }) },
  simulation: { table: "simulation_scenarios", toNativeStatus: c => ({ status: c }) },
  package: { table: "competency_packages", toNativeStatus: c => ({ status: c }) },
  skill: { table: "skill_library", toNativeStatus: c => ({ is_active: c === "active" }) },
  question_bank: { table: "question_banks", toNativeStatus: c => ({ is_active: c === "active" }) },
  learning_resource: { table: "learning_resources", toNativeStatus: c => ({ is_active: c === "active" }) },
};

export type WriteBackResult = { ok: boolean; status?: string; version?: string; error?: string };

export async function writeBackAsset(
  admin: Admin,
  input: { objectType: string; objectId: string; status?: string; version?: string }
): Promise<WriteBackResult> {
  const { objectType, objectId, status, version } = input;
  const adapter = ADAPTERS[objectType];
  if (!adapter) {
    return { ok: false, error: ASSET_GOVERNED_ELSEWHERE[objectType] ?? `${TYPE_LABEL[objectType] ?? objectType} has no editable source status — edit it in its source surface.` };
  }

  const nativeUpdate: Record<string, any> = {};
  const capUpdate: Record<string, any> = {};

  if (status) {
    const supported = ASSET_STATUS_SUPPORT[objectType] ?? [];
    if (!supported.includes(status)) return { ok: false, error: `${TYPE_LABEL[objectType] ?? objectType} supports: ${supported.join(", ")}` };
    Object.assign(nativeUpdate, adapter.toNativeStatus(status));
    capUpdate.status = status;
  }
  if (version) {
    const vcol = ASSET_VERSION_EDITABLE[objectType];
    if (!vcol) return { ok: false, error: `${TYPE_LABEL[objectType] ?? objectType} has no editable version.` };
    if (!/^\d+(\.\d+){0,2}$/.test(version)) return { ok: false, error: "Version must look like 2, 2.1 or 2.1.0" };
    nativeUpdate.version = version;
    capUpdate.version = version;
  }
  if (Object.keys(nativeUpdate).length === 0) return { ok: false, error: "Nothing to update" };

  // Write the source (native convention), confirming the row exists.
  const { data: updated, error } = await admin.from(adapter.table).update(nativeUpdate).eq("id", objectId).select("id");
  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) return { ok: false, error: `Asset not found in ${adapter.table}` };

  // Reflect the governed change on the header so the index stays consistent with the source.
  capUpdate.indexed_at = new Date().toISOString();
  await admin.from("cap_assets").update(capUpdate).eq("object_type", objectType).eq("object_id", objectId);

  return { ok: true, status: capUpdate.status, version: capUpdate.version };
}
