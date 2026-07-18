import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";

// Quality Engine — conduct an audit in one submission. The checklist comes
// dynamically from the competency's governed checklist items (spec: audits
// reference checklist items, they never own templates); findings store an
// immutable snapshot of each item + result. Failed CRITICAL criteria
// automatically create high-priority CAPA actions (spec: CAPA workflow).
// Body: { audit_type, competency_id, nurse_id?, area?, record_ref?, note?,
//         responses: [{ checklist_item_id, result: met|not_met|na, note? }] }

const TYPES = new Set(["concurrent", "retrospective", "clinical"]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Only assessor roles can conduct audits" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { audit_type, competency_id, nurse_id, area, record_ref, note } = body;
  const responses: { checklist_item_id?: string; result?: string; note?: string }[] =
    Array.isArray(body.responses) ? body.responses : [];

  if (!TYPES.has(audit_type)) return NextResponse.json({ error: "audit_type must be concurrent, retrospective or clinical" }, { status: 400 });
  if (!competency_id) return NextResponse.json({ error: "competency_id is required (audit criteria come from the competency's checklist)" }, { status: 400 });
  const valid = responses.filter(r => typeof r.checklist_item_id === "string" && ["met", "not_met", "na"].includes(r.result ?? ""));
  if (!valid.length) return NextResponse.json({ error: "At least one checklist response is required" }, { status: 400 });

  const { data: comp } = await admin.from("framework_competencies").select("id, name").eq("id", competency_id).single();
  if (!comp) return NextResponse.json({ error: "Competency not found" }, { status: 404 });

  // Snapshot the referenced checklist items (text + criticality at audit time).
  const itemIds = valid.map(r => r.checklist_item_id as string);
  const { data: items } = await admin.from("checklist_items").select("id, item, is_critical").in("id", itemIds);
  const itemById = new Map((items ?? []).map(i => [i.id, i]));

  const met = valid.filter(r => r.result === "met").length;
  const notMet = valid.filter(r => r.result === "not_met").length;
  const na = valid.filter(r => r.result === "na").length;
  const denom = met + notMet;
  const compliance = denom ? Math.round((met / denom) * 1000) / 10 : null;

  const title = `${comp.name} — ${audit_type} audit`;
  const { data: audit, error } = await admin.from("audits").insert({
    hospital_id: me?.hospital_id ?? null,
    audit_type, title,
    competency_id, nurse_id: nurse_id || null,
    area: (area ?? "").trim() || null,
    record_ref: (record_ref ?? "").trim() || null,
    status: "completed",
    compliance_pct: compliance,
    items_met: met, items_not_met: notMet, items_na: na,
    note: (note ?? "").trim() || null,
    conducted_by: user.id, conducted_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_findings").insert(valid.map(r => {
    const it = itemById.get(r.checklist_item_id as string);
    return {
      audit_id: audit.id,
      checklist_item_id: r.checklist_item_id,
      item_text: it?.item ?? "(item removed from checklist)",
      result: r.result,
      is_critical: !!it?.is_critical,
      note: (r.note ?? "").trim() || null,
    };
  }));

  // Auto-CAPA for failed critical criteria.
  const criticalFails = valid.filter(r => r.result === "not_met" && itemById.get(r.checklist_item_id as string)?.is_critical);
  let capaCreated = 0;
  if (criticalFails.length) {
    const due = new Date(); due.setDate(due.getDate() + 7);
    const { error: cerr } = await admin.from("capa_actions").insert(criticalFails.map(r => ({
      hospital_id: me?.hospital_id ?? null,
      audit_id: audit.id,
      title: `Critical criterion failed: ${itemById.get(r.checklist_item_id as string)?.item ?? "checklist item"}`,
      description: `Auto-created by the Quality Engine from "${title}"${area ? ` (${area})` : ""}. Verify corrective action with evidence before closure.`,
      priority: "high",
      due_date: due.toISOString().slice(0, 10),
      owner_id: user.id, owner_name: me?.full_name ?? null,
      created_by: user.id,
    })));
    if (!cerr) capaCreated = criticalFails.length;
  }

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "conduct_audit", entity_type: "audit", entity_id: audit.id, entity_name: title,
    new_value: { audit_type, compliance, met, not_met: notMet, na, capa_created: capaCreated },
  });
  if (nurse_id && notMet > 0) {
    await notify([nurse_id], {
      type: "audit_finding",
      title: "Audit findings recorded",
      body: `${me?.full_name ?? "An auditor"} completed a ${audit_type} audit on ${comp.name}: ${notMet} criterion${notMet === 1 ? "" : "s"} not met${compliance != null ? ` (${compliance}% compliant)` : ""}.`,
      href: "/dashboard/feedback",
    });
  }

  return NextResponse.json({ ok: true, id: audit.id, compliance, capa_created: capaCreated }, { status: 201 });
}
