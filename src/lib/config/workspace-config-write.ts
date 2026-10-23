// Workspace Configuration Engine (WCE-001, migration 076) — the WRITE lifecycle, shared.
//
// set/reset a draft override, publish (draft→published + version snapshot), rollback (restore a version
// snapshot as a new version). Every action is audited in workspace_config_audit. Runtime reads the
// PUBLISHED values (@/lib/config/workspace-config).
//
// ⚠ ONE ENGINE, TWO DOORS (COMPETEN-CONFIG-002 item 4). This logic used to live inline in
// /api/platform/workspace-config (super-admin only). It moved here unchanged so the Competen Individual
// policy route (/api/hq/individual/config, hq.individual.config.manage) writes the same tables through the
// same lifecycle instead of a parallel copy. Each door decides WHO may write and WHICH scope and paths;
// this module decides nothing about authority and must only ever be called behind a door that has.
//
// ⚠ A SCOPE IS (scope_type, scope_ref) AND PUBLISH/ROLLBACK ACT ON A WHOLE SCOPE. The super door pins
// platform scope to scope_ref 'platform'. The Individual door uses scope_ref 'individual'. So neither
// door's publish can sweep the other's drafts into a version, and rollbackVersion refuses a version
// outside the scope the caller names.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type WceActor = { userId: string; name: string | null };
export type WceScope = { scopeType: string; scopeRef: string | null };
export type WceResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const nowIso = () => new Date().toISOString();
const hospitalOf = (s: WceScope) => (s.scopeType === "hospital" ? s.scopeRef : null);

async function writeAudit(admin: any, actor: WceActor, action: string, scope: WceScope, path: string | null, oldV: any, newV: any) {
  await admin.from("workspace_config_audit").insert({
    hospital_id: hospitalOf(scope),
    actor_id: actor.userId, actor_name: actor.name, action, scope_type: scope.scopeType, scope_ref: scope.scopeRef,
    config_path: path, old_value: oldV, new_value: newV,
  });
}

/** True when migration 076's tables are absent here (the caller answers 409). */
export async function wceMissing(admin: any): Promise<boolean> {
  const probe = await admin.from("workspace_config_overrides").select("id").limit(1);
  return !!probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "");
}

/** Upsert a DRAFT override. Nothing reads a draft at runtime until it is published. */
export async function setOverride(admin: any, actor: WceActor, scope: WceScope, path: string, settings: any): Promise<WceResult> {
  const { data: prev } = await admin.from("workspace_config_overrides")
    .select("draft").eq("scope_type", scope.scopeType).eq("scope_ref", scope.scopeRef).eq("config_path", path).maybeSingle();
  const { error } = await admin.from("workspace_config_overrides").upsert({
    scope_type: scope.scopeType, scope_ref: scope.scopeRef, config_path: path,
    hospital_id: hospitalOf(scope),
    draft: settings, updated_by: actor.userId, updated_by_name: actor.name, updated_at: nowIso(),
  }, { onConflict: "scope_type,scope_ref,config_path" });
  if (error) return { ok: false, status: 500, error: error.message };
  await writeAudit(admin, actor, "set", scope, path, prev?.draft ?? null, settings);
  return { ok: true };
}

/** Delete the override: the path reverts to its inherited or default value. */
export async function resetOverride(admin: any, actor: WceActor, scope: WceScope, path: string): Promise<WceResult> {
  const { data: prev } = await admin.from("workspace_config_overrides")
    .select("draft").eq("scope_type", scope.scopeType).eq("scope_ref", scope.scopeRef).eq("config_path", path).maybeSingle();
  await admin.from("workspace_config_overrides").delete()
    .eq("scope_type", scope.scopeType).eq("scope_ref", scope.scopeRef).eq("config_path", path);
  await writeAudit(admin, actor, "reset", scope, path, prev?.draft ?? null, null);
  return { ok: true };
}

/** Copy draft→published for every override in the scope and snapshot the result as a version. */
export async function publishScope(admin: any, actor: WceActor, scope: WceScope, meta: { label?: string | null; note?: string | null } = {})
  : Promise<WceResult<{ version_id: string | undefined; modules: number }>> {
  const { data: rows } = await admin.from("workspace_config_overrides")
    .select("config_path, draft").eq("scope_type", scope.scopeType).eq("scope_ref", scope.scopeRef);
  for (const r of rows ?? []) {
    await admin.from("workspace_config_overrides").update({ published: r.draft, updated_at: nowIso() })
      .eq("scope_type", scope.scopeType).eq("scope_ref", scope.scopeRef).eq("config_path", r.config_path);
  }
  const snapshot = (rows ?? []).map((r: any) => ({ config_path: r.config_path, settings: r.draft }));
  const { data: ver } = await admin.from("workspace_config_versions").insert({
    scope_type: scope.scopeType, scope_ref: scope.scopeRef, hospital_id: hospitalOf(scope),
    label: meta.label ?? null, note: meta.note ?? null, snapshot, status: "published",
    published_by: actor.userId, published_by_name: actor.name,
  }).select("id").maybeSingle();
  await writeAudit(admin, actor, "publish", scope, null, null, { version_id: ver?.id, modules: snapshot.length });
  return { ok: true, version_id: ver?.id, modules: snapshot.length };
}

/**
 * Restore a version snapshot into draft AND published, recorded as a new version.
 *
 * `scope`, when given, is the only scope the caller may roll back: a version from any other scope reads as
 * not found. `prune` also resets every override in the scope that the snapshot does not name, so the scope
 * reads exactly as it did at that version. The super door passes neither (its behaviour is unchanged).
 */
export async function rollbackVersion(admin: any, actor: WceActor, versionId: string, opts: { scope?: WceScope; prune?: boolean } = {})
  : Promise<WceResult<{ restored: number; pruned: number }>> {
  const { data: ver } = await admin.from("workspace_config_versions").select("snapshot, scope_type, scope_ref").eq("id", versionId).maybeSingle();
  if (!ver) return { ok: false, status: 400, error: "version not found" };
  if (opts.scope && (ver.scope_type !== opts.scope.scopeType || (ver.scope_ref ?? null) !== (opts.scope.scopeRef ?? null)))
    return { ok: false, status: 400, error: "version not found" };
  const scope: WceScope = { scopeType: ver.scope_type, scopeRef: ver.scope_ref };
  const snap: any[] = ver.snapshot ?? [];
  for (const e of snap) {
    await admin.from("workspace_config_overrides").upsert({
      scope_type: scope.scopeType, scope_ref: scope.scopeRef, config_path: e.config_path,
      hospital_id: hospitalOf(scope),
      draft: e.settings, published: e.settings, updated_by: actor.userId, updated_by_name: actor.name, updated_at: nowIso(),
    }, { onConflict: "scope_type,scope_ref,config_path" });
  }
  let pruned = 0;
  if (opts.prune) {
    const keep = new Set(snap.map(e => e.config_path));
    const { data: rows } = await admin.from("workspace_config_overrides")
      .select("config_path").eq("scope_type", scope.scopeType).eq("scope_ref", scope.scopeRef);
    for (const r of rows ?? []) {
      if (keep.has(r.config_path)) continue;
      await admin.from("workspace_config_overrides").delete()
        .eq("scope_type", scope.scopeType).eq("scope_ref", scope.scopeRef).eq("config_path", r.config_path);
      pruned++;
    }
  }
  await admin.from("workspace_config_versions").insert({
    scope_type: scope.scopeType, scope_ref: scope.scopeRef, hospital_id: hospitalOf(scope),
    label: `Rollback to ${versionId.slice(0, 8)}`, snapshot: snap, status: "published",
    published_by: actor.userId, published_by_name: actor.name,
  });
  await writeAudit(admin, actor, "rollback", scope, null, { from_version: versionId }, opts.prune ? { modules: snap.length, pruned } : { modules: snap.length });
  return { ok: true, restored: snap.length, pruned };
}
