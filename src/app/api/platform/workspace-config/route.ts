import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Workspace Configuration Engine (WCE-001) write API — super-admin only. Handles
// the config lifecycle: set/reset a draft override, publish (draft→published +
// version snapshot), and rollback (restore a version). Every action is audited.
// Runtime rendering reads the PUBLISHED values (see @/lib/config/workspace-config).
/* eslint-disable @typescript-eslint/no-explicit-any */

const PLATFORM = "platform";
const nowIso = () => new Date().toISOString();
const scopeRefOf = (scopeType: string, scopeRef: any) => (scopeType === "platform" ? PLATFORM : (scopeRef ?? null));

async function writeAudit(admin: any, c: any, name: string | null, action: string, scopeType: string, scopeRef: string | null, path: string | null, oldV: any, newV: any) {
  await admin.from("workspace_config_audit").insert({
    hospital_id: scopeType === "hospital" ? scopeRef : null,
    actor_id: c.userId, actor_name: name, action, scope_type: scopeType, scope_ref: scopeRef,
    config_path: path, old_value: oldV, new_value: newV,
  });
}

export async function POST(req: Request) {
  const c = await getCaller() as any;
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Super admin only");
  const admin = c.admin;

  const probe = await admin.from("workspace_config_overrides").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) {
    return NextResponse.json({ error: "Workspace Configuration Engine tables not provisioned. Run migration 076." }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;
  const scopeType = body.scope_type as string;
  const scopeRef = scopeRefOf(scopeType, body.scope_ref);
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const name = me?.full_name ?? null;

  if (!["set", "reset", "publish", "rollback"].includes(action)) return badRequest("unknown action");
  if (!scopeType) return badRequest("scope_type required");

  // ── set: upsert a draft override ───────────────────────────────────────────
  if (action === "set") {
    const path = body.config_path as string;
    const settings = body.settings ?? {};
    if (!path) return badRequest("config_path required");
    const { data: prev } = await admin.from("workspace_config_overrides")
      .select("draft").eq("scope_type", scopeType).eq("scope_ref", scopeRef).eq("config_path", path).maybeSingle();
    const { error } = await admin.from("workspace_config_overrides").upsert({
      scope_type: scopeType, scope_ref: scopeRef, config_path: path,
      hospital_id: scopeType === "hospital" ? scopeRef : null,
      draft: settings, updated_by: c.userId, updated_by_name: name, updated_at: nowIso(),
    }, { onConflict: "scope_type,scope_ref,config_path" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAudit(admin, c, name, "set", scopeType, scopeRef, path, prev?.draft ?? null, settings);
    return NextResponse.json({ ok: true });
  }

  // ── reset: delete the override (revert to inherited/default) ────────────────
  if (action === "reset") {
    const path = body.config_path as string;
    if (!path) return badRequest("config_path required");
    const { data: prev } = await admin.from("workspace_config_overrides")
      .select("draft").eq("scope_type", scopeType).eq("scope_ref", scopeRef).eq("config_path", path).maybeSingle();
    await admin.from("workspace_config_overrides").delete()
      .eq("scope_type", scopeType).eq("scope_ref", scopeRef).eq("config_path", path);
    await writeAudit(admin, c, name, "reset", scopeType, scopeRef, path, prev?.draft ?? null, null);
    return NextResponse.json({ ok: true });
  }

  // ── publish: copy draft→published for the scope + snapshot a version ────────
  if (action === "publish") {
    const { data: rows } = await admin.from("workspace_config_overrides")
      .select("config_path, draft").eq("scope_type", scopeType).eq("scope_ref", scopeRef);
    for (const r of rows ?? []) {
      await admin.from("workspace_config_overrides").update({ published: r.draft, updated_at: nowIso() })
        .eq("scope_type", scopeType).eq("scope_ref", scopeRef).eq("config_path", r.config_path);
    }
    const snapshot = (rows ?? []).map((r: any) => ({ config_path: r.config_path, settings: r.draft }));
    const { data: ver } = await admin.from("workspace_config_versions").insert({
      scope_type: scopeType, scope_ref: scopeRef, hospital_id: scopeType === "hospital" ? scopeRef : null,
      label: body.label ?? null, note: body.note ?? null, snapshot, status: "published",
      published_by: c.userId, published_by_name: name,
    }).select("id").maybeSingle();
    await writeAudit(admin, c, name, "publish", scopeType, scopeRef, null, null, { version_id: ver?.id, modules: snapshot.length });
    return NextResponse.json({ ok: true, version_id: ver?.id, modules: snapshot.length });
  }

  // ── rollback: restore a version snapshot (draft + published) ────────────────
  if (action === "rollback") {
    const versionId = body.version_id as string;
    if (!versionId) return badRequest("version_id required");
    const { data: ver } = await admin.from("workspace_config_versions").select("snapshot, scope_type, scope_ref").eq("id", versionId).maybeSingle();
    if (!ver) return badRequest("version not found");
    const snap: any[] = ver.snapshot ?? [];
    for (const e of snap) {
      await admin.from("workspace_config_overrides").upsert({
        scope_type: ver.scope_type, scope_ref: ver.scope_ref, config_path: e.config_path,
        hospital_id: ver.scope_type === "hospital" ? ver.scope_ref : null,
        draft: e.settings, published: e.settings, updated_by: c.userId, updated_by_name: name, updated_at: nowIso(),
      }, { onConflict: "scope_type,scope_ref,config_path" });
    }
    await admin.from("workspace_config_versions").insert({
      scope_type: ver.scope_type, scope_ref: ver.scope_ref, hospital_id: ver.scope_type === "hospital" ? ver.scope_ref : null,
      label: `Rollback to ${versionId.slice(0, 8)}`, snapshot: snap, status: "published",
      published_by: c.userId, published_by_name: name,
    });
    await writeAudit(admin, c, name, "rollback", ver.scope_type, ver.scope_ref, null, { from_version: versionId }, { modules: snap.length });
    return NextResponse.json({ ok: true, restored: snap.length });
  }

  return badRequest("unhandled");
}
