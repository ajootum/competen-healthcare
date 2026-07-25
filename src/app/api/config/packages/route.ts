import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { loadDependencyGraph, transitiveClosure } from "@/lib/config/dependency-graph";

// Template, Package & Marketplace Manager (NCP-011) — bundles governed configuration objects into versioned,
// installable packages. POST creates a draft; PATCH saves members + metadata and RECOMPUTES the manifest from
// the WCE-002 dependency graph (a package is dependency-complete only when every object its members transitively
// depend on is also a member); publish is gated on completeness. Super-admin. Mirrors the objects route's shape.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CATS = ["clinical", "operational", "analytics", "governance", "workforce", "learning", "general"];
const LICENSES = ["proprietary", "open", "subscription", "enterprise"];
const PRICING = ["included", "subscription", "one_time", "usage_based"];
const VIS = ["private", "enterprise", "public"];
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const notProvisioned = () => NextResponse.json({ error: "Package registry not provisioned — run migration 095" }, { status: 409 });

// Resolve the manifest for a set of member object_keys against the dependency graph. `requires` is every object
// the members transitively depend on; `missing` is the subset not bundled and not (yet) satisfiable — the gate.
async function resolveManifest(admin: any, members: string[]) {
  const uniq = [...new Set(members.filter(Boolean))];
  const g: any = await loadDependencyGraph(admin);
  if (!g.provisioned) return { members: uniq, requires: [], missing: [], complete: true };
  const req = new Set<string>();
  for (const m of uniq) for (const dep of transitiveClosure(g.dependsOn, m)) req.add(dep);
  const memberSet = new Set(uniq);
  const missingRefs = [...req].filter(k => !memberSet.has(k));
  return { members: uniq, requires: [...req], missing: missingRefs, complete: missingRefs.length === 0 };
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Package authoring is platform super-admin only");
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));

  const package_key = String(b.package_key ?? "").trim().toLowerCase();
  const package_name = String(b.package_name ?? "").trim();
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(package_key)) return badRequest("package_key must be lowercase, dot-separated (e.g. bundle.ward_quality_pack)");
  if (!package_name) return badRequest("Package name required");
  const category = CATS.includes(b.category) ? b.category : "general";

  const { data: existing, error: exErr } = await admin.from("configuration_packages").select("package_key").eq("package_key", package_key).maybeSingle();
  if (exErr && missing(exErr)) return notProvisioned();
  if (existing) return badRequest(`Package key "${package_key}" already exists`);

  const now = new Date().toISOString();
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", userId).single();
  const row = {
    package_key, package_name, description: String(b.description ?? "").trim() || null,
    publisher: me?.full_name ?? "Platform", category, version: String(b.version ?? "1.0.0").trim() || "1.0.0",
    license: "proprietary", pricing_model: "included", visibility: "private",
    members: [], manifest: { members: [], requires: [], missing: [], complete: true }, status: "draft",
    created_at: now, created_by: userId, updated_at: now, updated_by: userId,
  };
  const { data, error } = await admin.from("configuration_packages").insert(row).select("package_key, package_name, status").single();
  if (error) return missing(error) ? notProvisioned() : badRequest(error.message);
  await admin.from("configuration_package_audit").insert({ package_key, action: "created", actor_id: userId, actor_name: me?.full_name ?? null, new_value: { category } });
  return NextResponse.json({ ok: true, package: data });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Package authoring is platform super-admin only");
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));
  const package_key = String(b.package_key ?? "").trim().toLowerCase();
  if (!package_key) return badRequest("package_key required");

  const { data: pkg, error: e0 } = await admin.from("configuration_packages").select("package_key, status, members").eq("package_key", package_key).maybeSingle();
  if (e0 && missing(e0)) return notProvisioned();
  if (!pkg) return badRequest("Package not found");

  // Validate members against the registry — only real object_keys may be bundled.
  const members = Array.isArray(b.members) ? [...new Set(b.members.filter((x: any) => typeof x === "string" && x))] : (pkg.members ?? []);
  if (members.length) {
    const { data: real } = await admin.from("configuration_registry_objects").select("object_key").in("object_key", members);
    const realSet = new Set((real ?? []).map((r: any) => r.object_key));
    const bad = members.filter((m: string) => !realSet.has(m));
    if (bad.length) return badRequest(`Not in the registry: ${bad.slice(0, 5).join(", ")}`);
  }
  const manifest = await resolveManifest(admin, members as string[]);

  const patch: any = { members, manifest, updated_at: new Date().toISOString(), updated_by: userId };
  if (typeof b.package_name === "string" && b.package_name.trim()) patch.package_name = b.package_name.trim();
  if (typeof b.description === "string") patch.description = b.description.trim() || null;
  if (CATS.includes(b.category)) patch.category = b.category;
  if (typeof b.version === "string" && b.version.trim()) patch.version = b.version.trim();
  if (LICENSES.includes(b.license)) patch.license = b.license;
  if (PRICING.includes(b.pricing_model)) patch.pricing_model = b.pricing_model;
  if (VIS.includes(b.visibility)) patch.visibility = b.visibility;

  // Publish gate — a package may only be published when it is dependency-complete.
  if (b.publish === true) {
    if (!members.length) return badRequest("Cannot publish an empty package");
    if (!manifest.complete) return NextResponse.json({ error: `Package is not dependency-complete — ${manifest.missing.length} required object(s) missing`, missing: manifest.missing }, { status: 422 });
    patch.status = "published";
  } else if (pkg.status === "published") {
    patch.status = "validated"; // editing a published package drops it back for re-publish
  } else {
    patch.status = manifest.complete && members.length ? "validated" : "draft";
  }

  const { error } = await admin.from("configuration_packages").update(patch).eq("package_key", package_key);
  if (error) return missing(error) ? notProvisioned() : badRequest(error.message);
  await admin.from("configuration_package_audit").insert({ package_key, action: b.publish ? "published" : "saved", actor_id: userId, new_value: { members: members.length, status: patch.status, complete: manifest.complete } });
  return NextResponse.json({ ok: true, manifest, status: patch.status });
}
