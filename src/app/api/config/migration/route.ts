import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { loadDependencyGraph, transitiveClosure } from "@/lib/config/dependency-graph";
import { validateDefinition } from "@/lib/config/schema";
import { captureSnapshot, checksum, SNAPSHOT_FIELDS } from "@/lib/config/versioning";

// Configuration Migration Toolkit (NCP-020) — the transport layer for configuration between environments/tenants.
// POST export builds a self-contained, dependency-closed bundle (+checksum) from selected objects; dry_run
// validates a bundle against the target (schema conformance, new/update/conflict, missing prerequisites); import
// applies it in dependency order after snapshotting every touched object (checkpoint for rollback); rollback
// restores that checkpoint. Super-admin. Cross-region transfer + true cryptographic signing (§6/§12) are next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const notProvisioned = () => NextResponse.json({ error: "Migration store not provisioned — run migration 098" }, { status: 409 });
const depKeys = (o: any) => (Array.isArray(o?.dependencies) ? o.dependencies : []).map((d: any) => (typeof d === "string" ? d : d?.objectKey ?? d?.object_key)).filter(Boolean);

// Order bundle objects so each object's in-bundle dependencies come before it (best-effort; remainder appended).
function topoOrder(objs: any[]): any[] {
  const inB = new Set(objs.map(o => o.object_key));
  const placed = new Set<string>(); const out: any[] = [];
  let guard = 0;
  while (out.length < objs.length && guard++ <= objs.length + 1) {
    for (const o of objs) {
      if (placed.has(o.object_key)) continue;
      if (depKeys(o).filter((k: string) => inB.has(k)).every((k: string) => placed.has(k))) { out.push(o); placed.add(o.object_key); }
    }
  }
  for (const o of objs) if (!placed.has(o.object_key)) out.push(o);
  return out;
}

// Analyse a bundle against the current registry — per-object op (new/update/identical) + schema issues + missing prereqs.
async function analyzeBundle(admin: any, objects: any[]) {
  const keys = objects.map(o => o.object_key);
  const { data: existing } = await admin.from("configuration_registry_objects").select("object_key, definition, display_name").in("object_key", keys.length ? keys : ["__none__"]);
  const exMap = new Map((existing ?? []).map((e: any) => [e.object_key, e]));
  const inBundle = new Set(keys);
  const report = objects.map(o => {
    const errs = validateDefinition(o.object_type, o.definition ?? {}).filter((i: any) => i.severity === "error");
    const ex: any = exMap.get(o.object_key);
    const op = !ex ? "new" : JSON.stringify(ex.definition ?? {}) === JSON.stringify(o.definition ?? {}) ? "identical" : "update";
    return { key: o.object_key, type: o.object_type, name: o.display_name, op, issues: errs.map((e: any) => `${e.path}: ${e.message}`) };
  });
  // Missing prerequisites — deps referenced by bundle objects that are neither in the bundle nor already installed.
  const referenced = new Set<string>(); objects.forEach(o => depKeys(o).forEach((k: string) => referenced.add(k)));
  const external = [...referenced].filter(k => !inBundle.has(k));
  const { data: present } = await admin.from("configuration_registry_objects").select("object_key").in("object_key", external.length ? external : ["__none__"]);
  const presentSet = new Set((present ?? []).map((p: any) => p.object_key));
  const missingDeps = external.filter(k => !presentSet.has(k));
  const errorCount = report.filter(r => r.issues.length).length;
  return { report, missingDeps, errorCount };
}

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = (c as any).admin;
  const { data, error } = await admin.from("configuration_migration_jobs").select("id, job_type, status, object_count, summary, note, created_by_name, created_at").order("created_at", { ascending: false }).limit(50);
  if (error && missing(error)) return notProvisioned();
  return NextResponse.json({ jobs: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", userId).single();

  if (b.action === "export") {
    const selected: string[] = Array.isArray(b.objects) ? b.objects.filter((x: any) => typeof x === "string") : [];
    if (!selected.length) return badRequest("Select at least one object to export");
    const g: any = await loadDependencyGraph(admin);
    // Close over dependencies so the bundle is self-contained.
    const closure = new Set(selected);
    if (g.provisioned) for (const k of selected) for (const dep of transitiveClosure(g.dependsOn, k)) closure.add(dep);
    const cols = ["object_key", "object_type", ...SNAPSHOT_FIELDS].join(", ");
    const { data: rows } = await admin.from("configuration_registry_objects").select(cols).in("object_key", [...closure]);
    const objects = (rows ?? []) as any[];
    const sum = checksum(objects);
    const bundle = { format: "competen.config.bundle", schema_version: "1.0.0", checksum: sum, count: objects.length, manifest: objects.map(o => ({ object_key: o.object_key, object_type: o.object_type })), objects };
    await admin.from("configuration_migration_jobs").insert({ job_type: "export", status: "built", object_count: objects.length, summary: { checksum: sum, selected: selected.length, withDeps: objects.length }, manifest: bundle.manifest, created_by: userId, created_by_name: me?.full_name ?? null, note: `Exported ${objects.length} object(s)` });
    return NextResponse.json({ ok: true, bundle });
  }

  // Parse a bundle for dry_run / import.
  const parseBundle = (): any[] | null => {
    let bundle = b.bundle;
    if (typeof bundle === "string") { try { bundle = JSON.parse(bundle); } catch { return null; } }
    return Array.isArray(bundle?.objects) ? bundle.objects : null;
  };

  if (b.action === "dry_run") {
    const objects = parseBundle();
    if (!objects) return badRequest("Bundle is not valid JSON or has no objects[]");
    const a = await analyzeBundle(admin, objects);
    return NextResponse.json({ ok: a.errorCount === 0 && a.missingDeps.length === 0, ...a, counts: { total: objects.length, new: a.report.filter(r => r.op === "new").length, update: a.report.filter(r => r.op === "update").length, identical: a.report.filter(r => r.op === "identical").length } });
  }

  if (b.action === "import") {
    const objects = parseBundle();
    if (!objects) return badRequest("Bundle is not valid JSON or has no objects[]");
    const a = await analyzeBundle(admin, objects);
    if (a.errorCount > 0) return NextResponse.json({ error: `${a.errorCount} object(s) fail schema validation — resolve before importing`, report: a.report }, { status: 422 });
    if (a.missingDeps.length > 0) return NextResponse.json({ error: `${a.missingDeps.length} required prerequisite(s) are neither in the bundle nor installed`, missingDeps: a.missingDeps }, { status: 422 });

    const ordered = topoOrder(objects);
    const now = new Date().toISOString();
    const checkpoint: { object_key: string; version: number | null }[] = [];
    let created = 0, updated = 0;
    for (const o of ordered) {
      const { data: ex } = await admin.from("configuration_registry_objects").select("object_key").eq("object_key", o.object_key).maybeSingle();
      if (ex) { const snap = await captureSnapshot(admin, o.object_key, "captured", userId, { reason: "pre-import checkpoint" }); checkpoint.push({ object_key: o.object_key, version: snap?.version ?? null }); }
      else checkpoint.push({ object_key: o.object_key, version: null });
      const row: any = { object_key: o.object_key, object_type: o.object_type, source: "migration", schema_version: "1.0.0", updated_at: now, updated_by: userId };
      for (const f of SNAPSHOT_FIELDS) if (o[f] !== undefined) row[f] = o[f];
      if (!ex) { row.created_at = now; row.created_by = userId; }
      await admin.from("configuration_registry_objects").upsert(row, { onConflict: "object_key" });
      if (ex) updated++; else created++;
    }
    const { data: job } = await admin.from("configuration_migration_jobs").insert({ job_type: "import", status: "applied", object_count: ordered.length, summary: { new: created, updated, deps: a.missingDeps.length }, checkpoint, manifest: ordered.map(o => ({ object_key: o.object_key, object_type: o.object_type })), created_by: userId, created_by_name: me?.full_name ?? null, note: `Imported ${created} new + ${updated} updated` }).select("id").single();
    return NextResponse.json({ ok: true, new: created, updated, jobId: job?.id ?? null });
  }

  if (b.action === "rollback") {
    const jobId = String(b.job_id ?? "");
    const { data: job, error } = await admin.from("configuration_migration_jobs").select("id, job_type, status, checkpoint").eq("id", jobId).maybeSingle();
    if (error && missing(error)) return notProvisioned();
    if (!job || job.job_type !== "import") return badRequest("Import job not found");
    if (job.status === "rolled_back") return badRequest("This import was already rolled back");
    let restored = 0, retired = 0;
    for (const cp of (job.checkpoint ?? [])) {
      if (cp.version) {
        const { data: snap } = await admin.from("configuration_version_snapshots").select("state").eq("object_key", cp.object_key).eq("version", cp.version).maybeSingle();
        if (snap?.state) { const patch: any = { updated_at: new Date().toISOString(), updated_by: userId }; for (const f of SNAPSHOT_FIELDS) if (snap.state[f] !== undefined) patch[f] = snap.state[f]; await admin.from("configuration_registry_objects").update(patch).eq("object_key", cp.object_key); restored++; }
      } else { await admin.from("configuration_registry_objects").update({ status: "retired", updated_at: new Date().toISOString(), updated_by: userId }).eq("object_key", cp.object_key); retired++; }
    }
    await admin.from("configuration_migration_jobs").update({ status: "rolled_back" }).eq("id", jobId);
    await admin.from("configuration_migration_jobs").insert({ job_type: "rollback", status: "applied", object_count: restored + retired, summary: { restored, retired }, created_by: userId, created_by_name: me?.full_name ?? null, note: `Rolled back import ${jobId.slice(0, 8)}` });
    return NextResponse.json({ ok: true, restored, retired });
  }

  return badRequest("Unknown action — use export | dry_run | import | rollback");
}
