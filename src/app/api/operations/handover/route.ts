import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { JBI_DOMAINS, JBI_MAX, classify } from "@/lib/operations/handover";

// Handover Centre mutation API (SSW-HC-004..011) over op_handovers / op_handover_items
// / op_handover_clarifications / op_handover_audits. One action-dispatched POST powers
// the interactive modules: create a handover, save/edit SBAR, review/accept/complete a
// patient handover, raise/answer a clarification, and submit a JBI audit. Supervisor
// tier (assessor/hospital_admin/super_admin), tenant-scoped, every action audit-logged.
// 409 hint until migration 079 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 079 to enable the Handover Centre workflow" }, { status: 409 }) : null;

// Ensure an open handover exists for this tenant, returning its id.
async function ensureHandover(c: any): Promise<{ id: string } | { error: any }> {
  const scope = (q: any) => (isSuper(c) ? q : q.eq("hospital_id", c.hospitalId ?? NONE));
  const { data: existing, error: e1 } = await scope(c.admin.from("op_handovers").select("id").neq("status", "accepted").order("created_at", { ascending: false })).limit(1);
  if (e1) return { error: e1 };
  if (existing?.[0]) return { id: existing[0].id };
  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("op_handovers").insert({ hospital_id: c.hospitalId ?? (isSuper(c) ? null : NONE), from_clinician: c.userId, status: "draft", summary: null, shift_label: me?.full_name ? `Handover by ${me.full_name}` : null }).select("id").single();
  if (error) return { error };
  return { id: data.id };
}

// Ensure a per-patient item exists in a handover, returning its id.
async function ensureItem(c: any, handoverId: string, patientId: string): Promise<{ id: string } | { error: any }> {
  const { data: found, error: e1 } = await c.admin.from("op_handover_items").select("id").eq("handover_id", handoverId).eq("patient_id", patientId).limit(1);
  if (e1) return { error: e1 };
  if (found?.[0]) return { id: found[0].id };
  const { data, error } = await c.admin.from("op_handover_items").insert({ handover_id: handoverId, patient_id: patientId, note: "Handover item", item_status: "in_progress" }).select("id").single();
  if (error) return { error };
  return { id: data.id };
}

async function audit(c: any, action: string, entityId: string | null, name?: string) {
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action, entity_type: "op_handover", entity_id: entityId, entity_name: name ?? null, hospital_id: c.hospitalId ?? null });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  const action = String(b.action ?? "");

  try {
    if (action === "create") {
      const h = await ensureHandover(c);
      if ("error" in h) return migrationGate(h.error) ?? NextResponse.json({ error: h.error.message }, { status: 500 });
      await audit(c, "handover_create", h.id);
      return NextResponse.json({ ok: true, handover_id: h.id }, { status: 201 });
    }

    if (!b.patient_id) return badRequest("patient_id required");
    const h = await ensureHandover(c);
    if ("error" in h) return migrationGate(h.error) ?? NextResponse.json({ error: h.error.message }, { status: 500 });
    const it = await ensureItem(c, h.id, b.patient_id);
    if ("error" in it) return migrationGate(it.error) ?? NextResponse.json({ error: it.error.message }, { status: 500 });

    const now = new Date().toISOString();
    const patch: any = { updated_at: now };
    let act = "";

    if (action === "save_sbar") {
      if (b.situation != null) patch.sbar_situation = String(b.situation);
      if (b.background != null) patch.sbar_background = String(b.background);
      if (b.assessment != null) patch.sbar_assessment = String(b.assessment);
      if (b.recommendation != null) patch.sbar_recommendation = String(b.recommendation);
      patch.sbar_status = b.sbar_status && ["draft", "reviewed", "shared", "archived"].includes(b.sbar_status) ? b.sbar_status : "reviewed";
      act = "handover_sbar_saved";
    } else if (action === "review") {
      patch.reviewed = true; patch.reviewed_by = c.userId; patch.reviewed_at = now; patch.item_status = "reviewed"; act = "handover_reviewed";
    } else if (action === "accept") {
      patch.accepted = true; patch.accepted_by = c.userId; patch.accepted_at = now; patch.item_status = "accepted"; patch.reviewed = true; act = "handover_accepted";
    } else if (action === "complete") {
      patch.item_status = "completed"; act = "handover_completed";
    } else {
      return badRequest("unknown action");
    }

    const { error } = await c.admin.from("op_handover_items").update(patch).eq("id", it.id);
    if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
    await audit(c, act, it.id, b.patient_label);
    return NextResponse.json({ ok: true, item_id: it.id });
  } catch (e: any) {
    return migrationGate(e) ?? NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

// PATCH: clarifications (raise/answer) and JBI audit submission.
export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  const action = String(b.action ?? "");
  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();

  try {
    if (action === "clarify") {
      if (!String(b.question ?? "").trim()) return badRequest("question required");
      const h = await ensureHandover(c);
      if ("error" in h) return migrationGate(h.error) ?? NextResponse.json({ error: h.error.message }, { status: 500 });
      const { data, error } = await c.admin.from("op_handover_clarifications").insert({ hospital_id: c.hospitalId ?? null, handover_id: h.id, patient_id: b.patient_id ?? null, question: String(b.question).trim(), asked_by: c.userId, asked_by_name: me?.full_name ?? null, status: "pending" }).select("id").single();
      if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
      await audit(c, "handover_clarification_raised", data.id);
      return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
    }

    if (action === "answer") {
      if (!b.id || !String(b.answer ?? "").trim()) return badRequest("id and answer required");
      const { error } = await c.admin.from("op_handover_clarifications").update({ answer: String(b.answer).trim(), answered_by: c.userId, answered_by_name: me?.full_name ?? null, answered_at: new Date().toISOString(), status: "answered" }).eq("id", b.id);
      if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
      await audit(c, "handover_clarification_answered", b.id);
      return NextResponse.json({ ok: true });
    }

    if (action === "jbi_audit") {
      if (!b.patient_id) return badRequest("patient_id required");
      const checklist: Record<string, number> = {};
      let total = 0;
      for (const dom of JBI_DOMAINS) { const v = Math.max(0, Math.min(5, Number(b.checklist?.[dom.key] ?? 0))); checklist[dom.key] = v; total += v; }
      const pct = Math.round((total / JBI_MAX) * 100);
      const h = await ensureHandover(c);
      if ("error" in h) return migrationGate(h.error) ?? NextResponse.json({ error: h.error.message }, { status: 500 });
      const it = await ensureItem(c, h.id, b.patient_id);
      if ("error" in it) return migrationGate(it.error) ?? NextResponse.json({ error: it.error.message }, { status: 500 });
      const { data, error } = await c.admin.from("op_handover_audits").insert({ hospital_id: c.hospitalId ?? null, handover_id: h.id, item_id: it.id, patient_id: b.patient_id, auditor_id: c.userId, auditor_name: me?.full_name ?? null, checklist, total_score: total, max_score: JBI_MAX, compliance_pct: pct, classification: classify(pct), duration_seconds: b.duration_seconds ?? null, follow_up_note: b.follow_up_note ?? null }).select("id").single();
      if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
      await c.admin.from("op_handover_items").update({ jbi_score: pct, jbi_checklist: checklist, updated_at: new Date().toISOString() }).eq("id", it.id);
      await audit(c, "handover_jbi_audit", data.id, `${pct}% ${classify(pct)}`);
      return NextResponse.json({ ok: true, id: data.id, compliance_pct: pct }, { status: 201 });
    }

    return badRequest("unknown action");
  } catch (e: any) {
    return migrationGate(e) ?? NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
