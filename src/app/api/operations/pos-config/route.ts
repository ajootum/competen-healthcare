import { NextResponse } from "next/server";
import { getCaller, isResponse, hasRole, forbidden, badRequest } from "@/lib/api-auth";
import { configRule } from "@/lib/operations/pos-config-schema";

// Patient Operations configuration API (POS-112). Set a governed rule override — versioned,
// effective-dated, append-a-new-version (never mutate history, §14):
//   POST { domain, rule_key, value, reason? } → deactivate the current active override, insert a
//   new version (supersedes the old), audited. Only allow-listed schema keys are accepted.
// Manager-gated, tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!hasRole(c, "hospital_admin", "super_admin")) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const rule = configRule(b.domain, b.rule_key);
  if (!rule) return badRequest("unknown domain / rule_key");

  // Coerce + validate the value against the rule type.
  const n = Number(b.value);
  if (!Number.isFinite(n) || n < 0) return badRequest("value must be a non-negative number");
  if (rule.type === "score" && (n < 0 || n > 15)) return badRequest("PEWS score out of range (0–15)");
  if (rule.type === "minutes" && n > 1440) return badRequest("minutes out of range (0–1440)");
  const value = { v: rule.type === "score" || rule.type === "minutes" ? Math.round(n) : n };

  const hid = c.hospitalId ?? b.hospital_id ?? null;
  if (!hid) return badRequest("hospital scope required");

  // Deactivate current active override (if any) and version up.
  const { data: current } = await admin.from("op_config_rules")
    .select("id, version").eq("hospital_id", hid).eq("domain", b.domain).eq("rule_key", b.rule_key).eq("active", true).maybeSingle();
  const version = current ? (current.version ?? 1) + 1 : 1;
  if (current) await admin.from("op_config_rules").update({ active: false }).eq("id", current.id);

  const { data, error } = await admin.from("op_config_rules").insert({
    hospital_id: hid, domain: b.domain, rule_key: b.rule_key, label: rule.label, value, data_type: rule.type,
    active: true, version, supersedes_id: current?.id ?? null, reason: b.reason || null, created_by: c.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "set_pos_config", entity_type: "op_config_rule", entity_id: data.id, hospital_id: hid, new_value: { domain: b.domain, rule_key: b.rule_key, value, version } });
  return NextResponse.json(data, { status: 201 });
}
