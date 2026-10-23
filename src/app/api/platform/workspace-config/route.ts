import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { publishScope, resetOverride, rollbackVersion, setOverride, wceMissing, type WceScope } from "@/lib/config/workspace-config-write";

// Workspace Configuration Engine (WCE-001) write API — super-admin only. Handles
// the config lifecycle: set/reset a draft override, publish (draft→published +
// version snapshot), and rollback (restore a version). Every action is audited.
// Runtime rendering reads the PUBLISHED values (see @/lib/config/workspace-config).
// The lifecycle itself lives in @/lib/config/workspace-config-write (shared with the
// Competen Individual policy route, COMPETEN-CONFIG-002); this door decides who and where.
/* eslint-disable @typescript-eslint/no-explicit-any */

const PLATFORM = "platform";
const scopeRefOf = (scopeType: string, scopeRef: any) => (scopeType === "platform" ? PLATFORM : (scopeRef ?? null));

export async function POST(req: Request) {
  const c = await getCaller() as any;
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Super admin only");
  const admin = c.admin;

  if (await wceMissing(admin)) {
    return NextResponse.json({ error: "Workspace Configuration Engine tables not provisioned. Run migration 076." }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;
  const scopeType = body.scope_type as string;
  const scope: WceScope = { scopeType, scopeRef: scopeRefOf(scopeType, body.scope_ref) };
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const actor = { userId: c.userId, name: me?.full_name ?? null };

  if (!["set", "reset", "publish", "rollback"].includes(action)) return badRequest("unknown action");
  if (!scopeType) return badRequest("scope_type required");

  // ── set: upsert a draft override ───────────────────────────────────────────
  if (action === "set") {
    const path = body.config_path as string;
    if (!path) return badRequest("config_path required");
    const r = await setOverride(admin, actor, scope, path, body.settings ?? {});
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true });
  }

  // ── reset: delete the override (revert to inherited/default) ────────────────
  if (action === "reset") {
    const path = body.config_path as string;
    if (!path) return badRequest("config_path required");
    await resetOverride(admin, actor, scope, path);
    return NextResponse.json({ ok: true });
  }

  // ── publish: copy draft→published for the scope + snapshot a version ────────
  if (action === "publish") {
    const r = await publishScope(admin, actor, scope, { label: body.label ?? null, note: body.note ?? null });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, version_id: r.version_id, modules: r.modules });
  }

  // ── rollback: restore a version snapshot (draft + published) ────────────────
  if (action === "rollback") {
    const versionId = body.version_id as string;
    if (!versionId) return badRequest("version_id required");
    const r = await rollbackVersion(admin, actor, versionId);
    if (!r.ok) return badRequest(r.error);
    return NextResponse.json({ ok: true, restored: r.restored });
  }

  return badRequest("unhandled");
}
