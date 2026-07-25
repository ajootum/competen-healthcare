// Configuration Versioning & Audit Service (NCP-018) — snapshot capture + diff engine over the registry.
// captureSnapshot records the full mutable state of an object as the next monotonic version (append-only);
// diffState produces a field-level, dependency-aware change list between two states. Consumed by the versions
// API (timeline / compare / restore) and by the objects PATCH (best-effort auto-capture on every define).
/* eslint-disable @typescript-eslint/no-explicit-any */

// The mutable object fields worth versioning (identity + governance + the type-specific definition).
export const SNAPSHOT_FIELDS = [
  "display_name", "description", "status", "parent_object_key", "configurability_class", "safety_classification",
  "override_policy", "default_enabled", "mandatory", "allowed_config_levels", "dependencies", "data_source_key", "tags", "definition",
];

const isObj = (v: any) => v !== null && typeof v === "object";
// Small, dependency-free integrity hash (djb2) over canonical JSON — enough for a visible checksum.
export function checksum(state: any): string {
  const s = JSON.stringify(state);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export type DiffEntry = { path: string; kind: "added" | "removed" | "changed"; before?: any; after?: any };
// Recursive field-level diff between two snapshot states (arrays compared by index — adequate for config).
export function diffState(a: any, b: any, base = ""): DiffEntry[] {
  const out: DiffEntry[] = [];
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
  for (const k of keys) {
    const path = base ? `${base}.${k}` : k;
    const av = a?.[k], bv = b?.[k];
    if (av === undefined) out.push({ path, kind: "added", after: bv });
    else if (bv === undefined) out.push({ path, kind: "removed", before: av });
    else if (isObj(av) && isObj(bv)) out.push(...diffState(av, bv, path));
    else if (JSON.stringify(av) !== JSON.stringify(bv)) out.push({ path, kind: "changed", before: av, after: bv });
  }
  return out;
}

const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

// Capture the current registry state of an object as its next version. Best-effort by design: returns null if
// the object is gone or the snapshots table is not provisioned (so callers like the objects PATCH never break).
export async function captureSnapshot(admin: any, objectKey: string, action: string, actorId: string | null, opts: { reason?: string; restoredFrom?: number; actorName?: string } = {}): Promise<{ version: number } | null> {
  const { data: obj, error } = await admin.from("configuration_registry_objects")
    .select(["object_key", "object_type", ...SNAPSHOT_FIELDS].join(", ")).eq("object_key", objectKey).maybeSingle();
  if (error || !obj) return null;
  const state: any = {};
  for (const f of SNAPSHOT_FIELDS) state[f] = (obj as any)[f];
  const { data: last, error: e2 } = await admin.from("configuration_version_snapshots")
    .select("version").eq("object_key", objectKey).order("version", { ascending: false }).limit(1).maybeSingle();
  if (e2 && missing(e2)) return null;
  const version = (last?.version ?? 0) + 1;
  let actorName = opts.actorName ?? null;
  if (!actorName && actorId) { const { data: me } = await admin.from("profiles").select("full_name").eq("id", actorId).single(); actorName = me?.full_name ?? null; }
  const { error: insErr } = await admin.from("configuration_version_snapshots").insert({
    object_key: objectKey, version, object_type: (obj as any).object_type, display_name: (obj as any).display_name,
    state, definition: (obj as any).definition ?? {}, checksum: checksum(state), action,
    change_reason: opts.reason ?? null, restored_from: opts.restoredFrom ?? null, actor_id: actorId, actor_name: actorName,
  });
  if (insErr) return null;
  return { version };
}
