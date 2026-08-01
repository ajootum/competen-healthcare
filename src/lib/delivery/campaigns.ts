/* eslint-disable @typescript-eslint/no-explicit-any */
// CDP-008 — Competency Assignment & Campaign Manager. A campaign is a named, deadline-driven competency
// initiative targeting a cohort; launching it materialises a target-based cmo_assignments row (method=
// 'campaign') and emits campaign.launched. Compliance is measured LIVE against competency_decisions — who in
// the cohort has achieved the competency. Real over cdp_campaigns (144) + cmo_assignments (114) +
// competency_decisions (011) + profiles. No fabricated data.

import { emitDomainEvent, EVENT } from "@/lib/orchestration/events";

import { currentTraceId } from "@/lib/trace";
type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const ACHIEVED = ["competent", "competent_with_conditions", "provisionally_competent"];
const scoped = (q: any, hid: string | null, isSuper: boolean) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
// cmo_assignments.target_type allows individual/role/team/department/enterprise; a hospital-wide campaign maps to enterprise.
const cmoTarget = (t: string) => (t === "hospital" ? "enterprise" : t);

export async function loadCampaigns(admin: Admin, hid: string | null, isSuper: boolean) {
  const campRes = await scoped(admin.from("cdp_campaigns").select("*").order("created_at", { ascending: false }).limit(2000), hid, isSuper);
  if (campRes.error) return { provisioned: false as const };
  const camps = (campRes.data ?? []) as any[];

  const profRes = await scoped(admin.from("profiles").select("id, role, roles, hospital_id").limit(8000), hid, isSuper);
  const profs = (profRes.data ?? []) as any[];
  const roleMatch = (p: any, role: string) => p.role === role || (Array.isArray(p.roles) && p.roles.includes(role));

  const compIds = [...new Set(camps.map(c => c.competency_id).filter(Boolean))] as string[];
  const achievedByComp = new Map<string, Set<string>>();
  if (compIds.length) {
    const { data: decs } = await admin.from("competency_decisions").select("nurse_id, competency_id").in("competency_id", compIds.slice(0, 2000)).in("outcome", ACHIEVED).limit(50000);
    for (const d of (decs ?? []) as any[]) {
      const s = achievedByComp.get(d.competency_id) ?? new Set<string>();
      s.add(d.nurse_id); achievedByComp.set(d.competency_id, s);
    }
  }

  const cohortOf = (c: any) => profs.filter(p => (c.target_role ? roleMatch(p, c.target_role) : true) && (c.hospital_id ? p.hospital_id === c.hospital_id : true));
  const campaigns = camps.map(c => {
    const cohort = cohortOf(c);
    const achieved = c.competency_id ? cohort.filter(p => achievedByComp.get(c.competency_id)?.has(p.id)).length : 0;
    const cohortN = cohort.length;
    return {
      id: c.id, name: c.name, competency: c.competency_name ?? "—", target: c.target_label ?? c.target_role ?? "All staff",
      mandatory: !!c.mandatory, status: c.status as string, dueOn: c.due_on as string | null, ownerName: c.owner_name as string | null,
      cohort: cohortN, achieved, compliance: cohortN ? Math.round((achieved / cohortN) * 100) : null,
    };
  });

  const kpis = {
    total: camps.length,
    active: camps.filter(c => c.status === "active").length,
    mandatory: camps.filter(c => c.mandatory && c.status !== "closed").length,
    reach: new Set(camps.filter(c => c.status === "active").flatMap(c => cohortOf(c).map(p => p.id))).size,
  };
  return { provisioned: true as const, kpis, campaigns };
}

export async function createCampaign(admin: Admin, input: { name: string; description?: string; competency_id?: string | null; competency_name?: string | null; target_type?: string; target_role?: string | null; target_label?: string | null; mandatory?: boolean; due_on?: string | null; hospital_id?: string | null }, actor: { id: string | null; name: string | null }) {
  if (!input.name?.trim()) return { ok: false as const, error: "Campaign name is required" };
  let competencyName = input.competency_name ?? null;
  if (!competencyName && input.competency_id) {
    const { data } = await admin.from("framework_competencies").select("name").eq("id", input.competency_id).maybeSingle();
    competencyName = data?.name ?? null;
  }
  const { data, error } = await admin.from("cdp_campaigns").insert({
    hospital_id: input.hospital_id ?? null, name: input.name.trim(), description: input.description ?? null,
    competency_id: input.competency_id ?? null, competency_name: competencyName,
    target_type: input.target_type ?? "role", target_role: input.target_role ?? null, target_label: input.target_label ?? null,
    mandatory: !!input.mandatory, due_on: input.due_on ?? null, status: "draft", owner_id: actor.id, owner_name: actor.name,
  }).select("id").single();
  if (error) return { ok: false as const, error: error.message };
  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: actor.id, actor_name: actor.name, action: "campaign_create", entity_type: "cdp_campaigns", entity_id: data.id, entity_name: input.name.trim() });
  return { ok: true as const, id: data.id };
}

export async function launchCampaign(admin: Admin, id: string, actor: { id: string | null; name: string | null }) {
  const { data: c } = await admin.from("cdp_campaigns").select("*").eq("id", id).maybeSingle();
  if (!c) return { ok: false as const, error: "Campaign not found" };
  if (c.status === "closed") return { ok: false as const, error: "Campaign is closed" };

  await admin.from("cdp_campaigns").update({ status: "active", launched_at: new Date().toISOString() }).eq("id", id);
  // Materialise a target-based assignment (idempotent-ish: skip if one already exists for this campaign).
  const { data: existing } = await admin.from("cmo_assignments").select("id").eq("method", "campaign").eq("campaign", c.name).limit(1);
  if (!existing || existing.length === 0) {
    await admin.from("cmo_assignments").insert({
      hospital_id: c.hospital_id, competency: c.competency_name ?? c.name, target_type: cmoTarget(c.target_type),
      target_label: c.target_label ?? c.target_role ?? "All staff", method: "campaign", campaign: c.name, due_date: c.due_on, status: "assigned",
    });
  }
  await emitDomainEvent(admin, { event_type: EVENT.CAMPAIGN_LAUNCHED, subject_type: "cdp_campaign", subject_id: id, hospital_id: c.hospital_id, actor_id: actor.id, actor_name: actor.name, payload: { name: c.name, competency: c.competency_name, target: c.target_label ?? c.target_role, due: c.due_on, mandatory: !!c.mandatory } });
  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: actor.id, actor_name: actor.name, action: "campaign_launch", entity_type: "cdp_campaigns", entity_id: id, entity_name: c.name });
  return { ok: true as const };
}

export async function closeCampaign(admin: Admin, id: string, actor: { id: string | null; name: string | null }) {
  const { data: c } = await admin.from("cdp_campaigns").select("name").eq("id", id).maybeSingle();
  if (!c) return { ok: false as const, error: "Campaign not found" };
  await admin.from("cdp_campaigns").update({ status: "closed" }).eq("id", id);
  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: actor.id, actor_name: actor.name, action: "campaign_close", entity_type: "cdp_campaigns", entity_id: id, entity_name: c.name });
  return { ok: true as const };
}
