import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { captureSnapshot, diffState, SNAPSHOT_FIELDS } from "@/lib/config/versioning";
import { validateDefinition } from "@/lib/config/schema";

// Configuration Versioning & Audit Service (NCP-018) — the version timeline + diff + restore surface. GET lists
// an object's snapshots (newest first); POST handles capture (snapshot current state), compare (field-level diff
// between two versions) and restore (write a past version's state back to the object, then snapshot the restore).
// Super-admin. Snapshots are immutable + monotonic; restore is itself versioned so history is never rewritten.
/* eslint-disable @typescript-eslint/no-explicit-any */
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const notProvisioned = () => NextResponse.json({ error: "Version store not provisioned — run migration 096" }, { status: 409 });

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Version history is platform super-admin only");
  const admin = (c as any).admin;
  const object_key = new URL(req.url).searchParams.get("object_key");
  if (!object_key) return badRequest("object_key required");
  const { data, error } = await admin.from("configuration_version_snapshots")
    .select("version, action, change_reason, restored_from, checksum, actor_name, created_at")
    .eq("object_key", object_key).order("version", { ascending: false }).limit(200);
  if (error && missing(error)) return notProvisioned();
  return NextResponse.json({ versions: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Version operations are platform super-admin only");
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));
  const action = String(b.action ?? "");
  const object_key = String(b.object_key ?? "").trim().toLowerCase();
  if (!object_key) return badRequest("object_key required");

  if (action === "capture") {
    const snap = await captureSnapshot(admin, object_key, "captured", userId, { reason: String(b.reason ?? "").trim() || undefined });
    if (!snap) return notProvisioned();
    return NextResponse.json({ ok: true, version: snap.version });
  }

  if (action === "compare") {
    const va = Number(b.a), vb = Number(b.b);
    const { data, error } = await admin.from("configuration_version_snapshots").select("version, state").eq("object_key", object_key).in("version", [va, vb]);
    if (error && missing(error)) return notProvisioned();
    const A = (data ?? []).find((r: any) => r.version === va);
    const B = (data ?? []).find((r: any) => r.version === vb);
    if (!A || !B) return badRequest("One or both versions not found");
    return NextResponse.json({ ok: true, a: va, b: vb, diff: diffState(A.state, B.state) });
  }

  if (action === "restore") {
    const version = Number(b.version);
    const { data: snap, error } = await admin.from("configuration_version_snapshots").select("state, object_type, version").eq("object_key", object_key).eq("version", version).maybeSingle();
    if (error && missing(error)) return notProvisioned();
    if (!snap) return badRequest("Version not found");
    const state = snap.state ?? {};
    // Pre-restore contract check (NCP-018 §9) — warn but don't block; the definition came from a valid version.
    const issues = validateDefinition(snap.object_type, state.definition ?? {}).filter((i: any) => i.severity === "error");
    const patch: any = { updated_at: new Date().toISOString(), updated_by: userId };
    for (const f of SNAPSHOT_FIELDS) if (state[f] !== undefined) patch[f] = state[f];
    const { error: upErr } = await admin.from("configuration_registry_objects").update(patch).eq("object_key", object_key);
    if (upErr) return badRequest(upErr.message);
    const snapNew = await captureSnapshot(admin, object_key, "restored", userId, { reason: `Restored from v${version}`, restoredFrom: version });
    await admin.from("configuration_registry_audit").insert({ object_key, action: "restored", actor_id: userId, new_value: { restored_from: version, new_version: snapNew?.version } });
    return NextResponse.json({ ok: true, restored_from: version, new_version: snapNew?.version ?? null, warnings: issues.length });
  }

  return badRequest("Unknown action — use capture | compare | restore");
}
