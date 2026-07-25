import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { dependencyGate } from "@/lib/config/dependency-graph";
import { validateDefinition } from "@/lib/config/schema";
import { captureSnapshot, SNAPSHOT_FIELDS } from "@/lib/config/versioning";

// Configuration Publishing Service (NCP-019) — promotes a release of configuration objects through channels
// (dev→qa→uat→pilot→production) with a rollout strategy + optional schedule. GET lists releases (or one + events);
// POST creates or drives the lifecycle (validate → approve → publish → activate → rollback); PATCH saves the
// release. Validation reuses the schema contract + the dependency gate; activation flips objects live after
// snapshotting them (checkpoint) so a release is rollback-capable. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const notProvisioned = () => NextResponse.json({ error: "Release store not provisioned — run migration 099" }, { status: 409 });
const CHANNELS = ["dev", "qa", "uat", "pilot", "production"];
const ROLLOUTS = ["immediate", "scheduled", "phased", "canary"];

async function event(admin: any, release_key: string, ev: string, detail: any, userId: string, name?: string) {
  await admin.from("configuration_release_events").insert({ release_key, event: ev, detail, actor_id: userId, actor_name: name ?? null });
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = (c as any).admin;
  const key = new URL(req.url).searchParams.get("release_key");
  if (key) {
    const { data: rel, error } = await admin.from("configuration_releases").select("*").eq("release_key", key).maybeSingle();
    if (error && missing(error)) return notProvisioned();
    const { data: events } = await admin.from("configuration_release_events").select("event, detail, actor_name, created_at").eq("release_key", key).order("created_at", { ascending: false }).limit(20);
    return NextResponse.json({ release: rel, events: events ?? [] });
  }
  const { data, error } = await admin.from("configuration_releases").select("release_key, name, channel, rollout, scheduled_for, objects, status, validation").order("updated_at", { ascending: false }).limit(500);
  if (error && missing(error)) return notProvisioned();
  return NextResponse.json({ releases: data ?? [] });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));
  const release_key = String(b.release_key ?? "").trim().toLowerCase();
  if (!release_key) return badRequest("release_key required");
  const patch: any = { updated_at: new Date().toISOString(), updated_by: userId };
  if (Array.isArray(b.objects)) patch.objects = [...new Set(b.objects.filter((x: any) => typeof x === "string"))];
  if (CHANNELS.includes(b.channel)) patch.channel = b.channel;
  if (ROLLOUTS.includes(b.rollout)) patch.rollout = b.rollout;
  if (b.scheduled_for !== undefined) patch.scheduled_for = b.scheduled_for || null;
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
  const { error } = await admin.from("configuration_releases").update(patch).eq("release_key", release_key);
  if (error) return missing(error) ? notProvisioned() : badRequest(error.message);
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", userId).single();
  const nm = me?.full_name ?? null;

  const action = String(b.action ?? "");
  const release_key = String(b.release_key ?? "").trim().toLowerCase();

  // create
  if (!action) {
    const name = String(b.name ?? "").trim();
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(release_key)) return badRequest("release_key must be lowercase, dot-separated (e.g. release.2026_q3)");
    if (!name) return badRequest("Release name required");
    const { data: ex, error: exErr } = await admin.from("configuration_releases").select("release_key").eq("release_key", release_key).maybeSingle();
    if (exErr && missing(exErr)) return notProvisioned();
    if (ex) return badRequest(`Release "${release_key}" already exists`);
    const channel = CHANNELS.includes(b.channel) ? b.channel : "dev";
    const { data, error } = await admin.from("configuration_releases").insert({ release_key, name, channel, objects: [], status: "draft", created_by: userId, updated_by: userId }).select("release_key, name, status").single();
    if (error) return missing(error) ? notProvisioned() : badRequest(error.message);
    await event(admin, release_key, "created", { channel }, userId, nm);
    return NextResponse.json({ ok: true, release: data });
  }

  const { data: rel, error } = await admin.from("configuration_releases").select("*").eq("release_key", release_key).maybeSingle();
  if (error && missing(error)) return notProvisioned();
  if (!rel) return badRequest("Release not found");
  const objects: string[] = Array.isArray(rel.objects) ? rel.objects : [];

  if (action === "validate") {
    if (!objects.length) return badRequest("Add objects to the release first");
    const { data: rows } = await admin.from("configuration_registry_objects").select("object_key, object_type, definition").in("object_key", objects);
    const schemaErrors: string[] = [];
    for (const o of (rows ?? [])) { const errs = validateDefinition(o.object_type, o.definition ?? {}).filter((i: any) => i.severity === "error"); if (errs.length) schemaErrors.push(`${o.object_key}: ${errs.length} error(s)`); }
    const gate = await dependencyGate(admin, objects);
    const ok = schemaErrors.length === 0 && gate.ok;
    const validation = { ok, schemaErrors, depReason: gate.ok ? null : gate.reason };
    await admin.from("configuration_releases").update({ status: ok ? "validated" : "failed", validation, updated_at: new Date().toISOString() }).eq("release_key", release_key);
    await event(admin, release_key, "validated", validation, userId, nm);
    return NextResponse.json({ ok, validation });
  }

  if (action === "approve") {
    if (rel.status !== "validated") return badRequest("Release must be validated before approval");
    await admin.from("configuration_releases").update({ status: "approved", updated_at: new Date().toISOString() }).eq("release_key", release_key);
    await event(admin, release_key, "approved", {}, userId, nm);
    return NextResponse.json({ ok: true, status: "approved" });
  }

  if (action === "publish") {
    if (rel.status !== "approved") return badRequest("Release must be approved before publishing");
    const future = rel.rollout === "scheduled" && rel.scheduled_for && new Date(rel.scheduled_for).getTime() > Date.now();
    const status = future ? "scheduled" : "published";
    await admin.from("configuration_releases").update({ status, updated_at: new Date().toISOString() }).eq("release_key", release_key);
    await event(admin, release_key, "published", { status, channel: rel.channel }, userId, nm);
    return NextResponse.json({ ok: true, status });
  }

  if (action === "activate") {
    if (!["published", "scheduled", "approved"].includes(rel.status)) return badRequest("Release must be published before activation");
    const checkpoint: { object_key: string; version: number | null }[] = [];
    for (const k of objects) { const snap = await captureSnapshot(admin, k, "captured", userId, { reason: `pre-activation (${rel.release_key})` }); checkpoint.push({ object_key: k, version: snap?.version ?? null }); }
    await admin.from("configuration_registry_objects").update({ status: "active", updated_at: new Date().toISOString(), updated_by: userId }).in("object_key", objects);
    await admin.from("configuration_releases").update({ status: "activated", checkpoint, activated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("release_key", release_key);
    await event(admin, release_key, "activated", { objects: objects.length, channel: rel.channel }, userId, nm);
    return NextResponse.json({ ok: true, activated: objects.length });
  }

  if (action === "rollback") {
    if (rel.status !== "activated") return badRequest("Only an activated release can be rolled back");
    let restored = 0;
    for (const cp of (rel.checkpoint ?? [])) {
      if (cp.version) { const { data: snap } = await admin.from("configuration_version_snapshots").select("state").eq("object_key", cp.object_key).eq("version", cp.version).maybeSingle(); if (snap?.state) { const patch: any = { updated_at: new Date().toISOString(), updated_by: userId }; for (const f of SNAPSHOT_FIELDS) if (snap.state[f] !== undefined) patch[f] = snap.state[f]; await admin.from("configuration_registry_objects").update(patch).eq("object_key", cp.object_key); restored++; } }
    }
    await admin.from("configuration_releases").update({ status: "rolled_back", updated_at: new Date().toISOString() }).eq("release_key", release_key);
    await event(admin, release_key, "rolled_back", { restored }, userId, nm);
    return NextResponse.json({ ok: true, restored });
  }

  return badRequest("Unknown action — use validate | approve | publish | activate | rollback");
}
