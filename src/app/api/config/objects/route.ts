import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Configuration Studio — no-code authoring of a governed configuration object. POST creates a DRAFT object in
// the WCE-002 registry (source:"studio"); the client then raises a WCE-004 change request for it, so it flows
// through governance + the dependency gate before going active. Super-admin gated. Mirrors the proven
// syncRegistryFromCatalog insert shape.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPES = ["MODULE", "WIDGET", "PAGE", "DASHBOARD", "REPORT", "METRIC", "FORM", "WORKFLOW", "BUSINESS_RULE", "NAVIGATION_SECTION", "PERMISSION", "DATA_SOURCE"];
const CLASSES = ["mandatory_configurable", "optional", "conditional", "user_personalisable"];
const SAFETY = ["non_clinical", "administrative", "operational", "clinical_support", "clinical_safety_relevant", "clinical_safety_critical", "security_critical", "regulatory_critical", "financial_control_critical"];

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Configuration authoring is platform super-admin only");
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));

  const object_type = String(b.object_type ?? "");
  const object_key = String(b.object_key ?? "").trim().toLowerCase();
  const display_name = String(b.display_name ?? "").trim();
  if (!TYPES.includes(object_type)) return badRequest("Invalid object type");
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(object_key)) return badRequest("object_key must be lowercase, dot-separated (e.g. workspace.ward.my_metric)");
  if (!display_name) return badRequest("Display name required");
  const parent = String(b.parent_object_key ?? "").trim() || null;
  const configurability_class = CLASSES.includes(b.configurability_class) ? b.configurability_class : "optional";
  const safety_classification = SAFETY.includes(b.safety_classification) ? b.safety_classification : "operational";

  const { data: existing, error: exErr } = await admin.from("configuration_registry_objects").select("object_key").eq("object_key", object_key).maybeSingle();
  if (exErr && /does not exist|schema cache/i.test(exErr.message ?? "")) return NextResponse.json({ error: "Registry not provisioned — run migration 092" }, { status: 409 });
  if (existing) return badRequest(`Object key "${object_key}" already exists`);
  if (parent) {
    const { data: p } = await admin.from("configuration_registry_objects").select("object_key").eq("object_key", parent).maybeSingle();
    if (!p) return badRequest(`Parent "${parent}" is not in the registry`);
  }

  const now = new Date().toISOString();
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", userId).single();
  const row = {
    object_key, object_type, display_name, description: String(b.description ?? "").trim() || null,
    parent_object_key: parent, configurability_class, safety_classification, override_policy: "restricted",
    default_enabled: true, mandatory: false, configuration_owner: "TENANT", owner_team: "Platform",
    route: null, data_source_key: String(b.data_source_key ?? "").trim() || null,
    allowed_config_levels: ["PLATFORM", "ENTERPRISE", "TENANT", "UNIT", "USER"],
    dependencies: parent ? [{ type: "PARENT", objectKey: parent }] : [],
    tags: ["studio"], display_order: 0, source: "studio", schema_version: "1.0.0", status: "draft",
    created_at: now, created_by: userId, updated_at: now, updated_by: userId,
  };
  const { data, error } = await admin.from("configuration_registry_objects").insert(row).select("object_key, object_type, display_name, status").single();
  if (error) return badRequest(error.message);
  await admin.from("configuration_registry_audit").insert({ object_key, action: "authored", actor_id: userId, actor_name: me?.full_name ?? null, new_value: { object_type, source: "studio" } });
  return NextResponse.json({ ok: true, object: data });
}
