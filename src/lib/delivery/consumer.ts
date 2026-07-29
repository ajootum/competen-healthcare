/* eslint-disable @typescript-eslint/no-explicit-any */
// CDP-015 — delivery event consumer. The orchestrator, campaigns and adaptive engine all EMIT to the
// domain_events outbox (102); this is the reactive side the triage found missing. It drains pending
// delivery-relevant events and acts: a FAILED assessment auto-remediates (notify + a reinforcement card);
// known events with no side-effect are acknowledged; unknown types are left pending for other consumers.
// A cron (delivery_event_consumer) drains it regularly. Real over domain_events + cdp_reinforcement_cards
// (143) + notify() (029/056). No fabricated recipients — the learner is the event's actor.

import { notify } from "@/lib/notify";
import { resolveDeliveryConfig } from "@/lib/delivery/config";

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const today = () => new Date().toISOString().slice(0, 10);

// Failed assessment → recommend remediation to the learner + seed a reinforcement card for the competency.
async function handleAssessmentCompleted(admin: Admin, ev: any): Promise<string> {
  const p = ev.payload ?? {};
  if (p.passed !== false) return "no_action";           // only react to failures
  const learner = ev.actor_id;
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

const REMEDIATE = "assessment.completed";
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
