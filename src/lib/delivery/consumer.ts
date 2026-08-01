/* eslint-disable @typescript-eslint/no-explicit-any */
// CDP-015 — delivery event consumer. The orchestrator, campaigns and adaptive engine all EMIT to the
// domain_events outbox (102); this is the reactive side the triage found missing. It drains pending events and
// acts: a FAILED assessment auto-remediates (notify + a reinforcement card); a GOVERNED OVERRIDE deployment
// (shift.assignment.changed, PW-014) opens the same remediation loop — the cross-workspace reaction that carries
// a shift supervisor's override into Competency-Office remediation; known events with no side-effect are
// acknowledged; unknown types are left pending for other consumers. Both remediation paths honour the CDP-014
// auto_remediation policy. A cron (delivery_event_consumer) drains it regularly. Real over domain_events +
// cdp_reinforcement_cards (143) + notify() (029/056). No fabricated recipients — the worker is the event's subject.

import { notify } from "@/lib/notify";
import { resolveDeliveryConfig } from "@/lib/delivery/config";

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const today = () => new Date().toISOString().slice(0, 10);

// Failed assessment → recommend remediation to the learner + seed a reinforcement card for the competency.
async function handleAssessmentCompleted(admin: Admin, ev: any): Promise<string> {
  const p = ev.payload ?? {};
  if (p.passed !== false) return "no_action";           // only react to failures
  // THE LEARNER IS NOT THE ACTOR. This read actor_id, which on the only path that emits this event is the
  // EDUCATOR who returned the score -- so a failing assessment would have told the assessor to go and
  // revise, and left the nurse with nothing. The payload now names the nurse explicitly; an event that
  // does not carry one has no recipient rather than a plausible wrong one.
  const learner = p.nurse_id ?? null;
  if (!learner) return "no_recipient";
  await notify([learner], { type: "remediation", title: "Reassessment recommended", body: "You didn't pass a recent assessment — a short remediation review has been queued for you.", href: "/dashboard/reinforcement" });
  if (p.competency_id) {
    const [{ data: comp }, { data: prof }] = await Promise.all([
      admin.from("framework_competencies").select("name").eq("id", p.competency_id).maybeSingle(),
      admin.from("profiles").select("hospital_id").eq("id", learner).maybeSingle(),
    ]);
    const name = comp?.name ?? "this competency";
    await admin.from("cdp_reinforcement_cards").upsert(
      { hospital_id: prof?.hospital_id ?? null, nurse_id: learner, competency_id: p.competency_id, subject: comp?.name ?? "Competency", prompt: `Reassessment prep — recall the key steps, indications and safety checks for "${name}".`, source: "assessment_fail", next_review_at: today() },
      { onConflict: "nurse_id,competency_id", ignoreDuplicates: true },
    ).catch(() => {});
  }
  return "remediation_queued";
}

// Governed override deployment (shift.assignment.changed, PW-014) → open the Competency Office remediation loop
// for the worker: notify them + seed a reinforcement card for each unresolved critical competency. This is the
// CROSS-WORKSPACE reaction — a shift supervisor's override past the COMP-027 readiness gate now reaches
// competency remediation instead of dying in audit_log. Re-derives the criticals from the authoritative record
// (competency_decisions) rather than trusting the event payload's names.
async function handleShiftOverride(admin: Admin, ev: any): Promise<string> {
  const p = ev.payload ?? {};
  if (!p.override) return "no_action";
  const worker = p.staff_id;
  if (!worker) return "no_recipient";
  let decs: any[] = [];
  try {
    const { data } = await admin.from("competency_decisions").select("competency_id, outcome, critical_failure, framework_competencies(name)").eq("nurse_id", worker).eq("critical_failure", true).limit(500);
    decs = data ?? [];
  } catch { decs = []; }
  const critical = decs.filter(d => d.competency_id && ["requires_remediation", "not_yet_competent", "expired"].includes(String(d.outcome)));
  await notify([worker], { type: "remediation", title: "Competency remediation required", body: "You were deployed under a governed override with unresolved critical competencies — a remediation review has been queued for you.", href: "/dashboard/reinforcement" });
  const { data: prof } = await admin.from("profiles").select("hospital_id").eq("id", worker).maybeSingle();
  for (const d of critical.slice(0, 10)) {
    const name = (Array.isArray(d.framework_competencies) ? d.framework_competencies[0]?.name : d.framework_competencies?.name) ?? "Competency";
    await admin.from("cdp_reinforcement_cards").upsert(
      { hospital_id: prof?.hospital_id ?? p.hospital_id ?? null, nurse_id: worker, competency_id: d.competency_id, subject: name, prompt: `Critical competency to close out — you were deployed under override on "${name}". Recall the key steps, indications and safety checks.`, source: "shift_override", next_review_at: today() },
      { onConflict: "nurse_id,competency_id", ignoreDuplicates: true },
    ).catch(() => {});
  }
  return "remediation_queued";
}

const REMEDIATE = "assessment.completed";
const SHIFT_OVERRIDE = "shift.assignment.changed";
// Known delivery events with no reactive side-effect (the emitter already did the work) — acknowledge & drain.
const ACK_ONLY = new Set(["competency.assigned", "campaign.launched", "simulation.completed", "learning.course.completed", "task.completed", "credential.expiry.updated", "policy.acknowledgement.required"]);

export async function processEvents(admin: Admin, limit = 300) {
  const { data: events, error } = await admin.from("domain_events").select("id, event_type, actor_id, payload").eq("status", "pending").order("occurred_at", { ascending: true }).limit(limit);
  if (error) return { ok: false as const, error: error.message, processed: 0, remediated: 0, byAction: {} as Record<string, number> };

  const autoRemediate = (await resolveDeliveryConfig(admin)).auto_remediation; // CDP-014 policy gate
  let processed = 0, remediated = 0;
  const byAction: Record<string, number> = {};
  for (const ev of (events ?? []) as any[]) {
    let action: string;
    if (ev.event_type === REMEDIATE) {
      if (!autoRemediate) {
        action = "remediation_disabled"; // policy off — acknowledge & drain, no card/notify
      } else {
        try { action = await handleAssessmentCompleted(admin, ev); } catch { action = "error"; }
        if (action === "remediation_queued") remediated++;
      }
    } else if (ev.event_type === SHIFT_OVERRIDE) {
      if (!autoRemediate) {
        action = "remediation_disabled"; // policy off — acknowledge & drain
      } else {
        try { action = await handleShiftOverride(admin, ev); } catch { action = "error"; }
        if (action === "remediation_queued") remediated++;
      }
    } else if (ACK_ONLY.has(ev.event_type)) {
      action = "acknowledged";
    } else {
      byAction["skipped_unknown"] = (byAction["skipped_unknown"] ?? 0) + 1;
      continue; // leave unknown types pending for other consumers
    }
    await admin.from("domain_events").update({ status: "processed" }).eq("id", ev.id);
    processed++;
    byAction[action] = (byAction[action] ?? 0) + 1;
  }
  return { ok: true as const, processed, remediated, byAction };
}

export async function loadEventStream(admin: Admin, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const totalRes = await scope(admin.from("domain_events").select("id", { count: "exact", head: true }));
  if (totalRes.error) return { provisioned: false as const };
  const [pendingRes, processedRes, deadRes, recentRes] = await Promise.all([
    scope(admin.from("domain_events").select("id", { count: "exact", head: true }).eq("status", "pending")),
    scope(admin.from("domain_events").select("id", { count: "exact", head: true }).eq("status", "processed")),
    scope(admin.from("domain_events").select("id", { count: "exact", head: true }).eq("status", "dead_letter")),
    scope(admin.from("domain_events").select("event_type, subject_type, status, occurred_at, actor_name").order("occurred_at", { ascending: false }).limit(20)),
  ]);
  return {
    provisioned: true as const,
    kpis: { total: totalRes.count ?? 0, pending: pendingRes.count ?? 0, processed: processedRes.count ?? 0, dead: deadRes.count ?? 0 },
    recent: (recentRes.data ?? []) as any[],
  };
}
