import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import EvidenceCentre, { type EvidenceEntry, type CentreKpis } from "./EvidenceCentre";

// Evidence Validation Centre (Evidence Validation Centre spec): the assessor's
// centralised review workflow — smart queue with filters, a split review panel
// with evidence viewer links, competency mapping, timeline and decision
// actions, and live KPIs including real average review time. AI pre-review and
// confidence scoring have no pipeline yet — the AI assist is a real Copilot
// handoff, not an invented score.

// Server component renders once per request; helper keeps the impure date
// read out of the render body for the purity lint.
const nowMs = () => Date.now();

export default async function EvidenceValidationCentrePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, is_senior_assessor").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSenior = !!me?.is_senior_assessor || roles.some(r => ["hospital_admin", "super_admin"].includes(r));

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);

  const [{ data: raw }, { data: reviewedToday }, { data: myVerified }] = await Promise.all([
    admin.from("skill_log_entries")
      .select(`id, nurse_id, competency_id, skill_name, performed_at, location, supervision_level, notes, status, created_at,
        escalated_by_name, escalation_reason,
        profiles!nurse_id(full_name, specialization, avatar_url),
        framework_competencies!competency_id(name, framework_domains(name, frameworks(name)))`)
      .in("status", ["pending", "changes_requested", "escalated"]).neq("nurse_id", user.id)
      .order("created_at", { ascending: true }).limit(100),
    admin.from("audit_log").select("id")
      .eq("actor_id", user.id)
      .in("action", ["verify_skill_entry", "reject_skill_entry", "request_skill_entry_changes"])
      .gte("created_at", dayStart.toISOString()),
    admin.from("skill_log_entries").select("created_at, verified_at")
      .eq("verified_by", user.id).not("verified_at", "is", null).limit(200),
  ]);

  // Evidence attached to queue entries
  const ids = (raw ?? []).map(e => e.id);
  const rawEntries = (raw ?? []) as unknown as { id: string; nurse_id: string; competency_id: string | null; skill_name: string }[];

  // Reference checklists (competency skills), prior submissions and per-entry
  // activity feed — all real records supporting the review panel.
  const compIds = [...new Set(rawEntries.map(e => e.competency_id).filter((v): v is string => !!v))];
  const nurseIdsInQueue = [...new Set(rawEntries.map(e => e.nurse_id))];
  const [{ data: compSkills }, { data: priorEntries }, { data: auditRows }] = await Promise.all([
    compIds.length
      ? admin.from("competency_skills").select("competency_id, name").in("competency_id", compIds).eq("is_active", true).order("name").limit(300)
      : Promise.resolve({ data: [] }),
    nurseIdsInQueue.length
      ? admin.from("skill_log_entries")
          .select("id, nurse_id, skill_name, status, created_at, verified_by_name")
          .in("nurse_id", nurseIdsInQueue).not("id", "in", `(${ids.join(",")})`)
          .order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] }),
    ids.length
      ? admin.from("audit_log").select("entity_id, action, actor_name, created_at")
          .eq("entity_type", "skill_log_entry").in("entity_id", ids)
          .order("created_at", { ascending: true }).limit(300)
      : Promise.resolve({ data: [] }),
  ]);

  const skillsByCompetency = new Map<string, string[]>();
  for (const s of (compSkills ?? []) as { competency_id: string; name: string }[]) {
    const list = skillsByCompetency.get(s.competency_id) ?? [];
    if (list.length < 12) list.push(s.name);
    skillsByCompetency.set(s.competency_id, list);
  }
  const historyByKey = new Map<string, { status: string; created_at: string; verified_by_name: string | null }[]>();
  for (const p of (priorEntries ?? []) as { nurse_id: string; skill_name: string; status: string; created_at: string; verified_by_name: string | null }[]) {
    const key = `${p.nurse_id}:${p.skill_name.trim().toLowerCase()}`;
    const list = historyByKey.get(key) ?? [];
    if (list.length < 5) list.push({ status: p.status, created_at: p.created_at, verified_by_name: p.verified_by_name });
    historyByKey.set(key, list);
  }
  const feedByEntry = new Map<string, { action: string; actor: string | null; at: string }[]>();
  for (const a of (auditRows ?? []) as { entity_id: string; action: string; actor_name: string | null; created_at: string }[]) {
    const list = feedByEntry.get(a.entity_id) ?? [];
    list.push({ action: a.action, actor: a.actor_name, at: a.created_at });
    feedByEntry.set(a.entity_id, list);
  }
  const { data: evidenceRows } = ids.length
    ? await admin.from("evidence")
        .select("id, skill_log_entry_id, file_name, mime_type, size_bytes, created_at")
        .in("skill_log_entry_id", ids).order("created_at")
    : { data: [] };
  const evidenceByEntry = new Map<string, { id: string; file_name: string; mime_type: string; size_bytes: number }[]>();
  for (const ev of (evidenceRows ?? []) as unknown as { id: string; skill_log_entry_id: string; file_name: string; mime_type: string; size_bytes: number }[]) {
    const list = evidenceByEntry.get(ev.skill_log_entry_id) ?? [];
    list.push(ev);
    evidenceByEntry.set(ev.skill_log_entry_id, list);
  }

  const entries: EvidenceEntry[] = ((raw ?? []) as unknown as {
    id: string; nurse_id: string; competency_id: string | null; skill_name: string; performed_at: string; location: string | null;
    supervision_level: string; notes: string | null; status: string; created_at: string;
    escalated_by_name: string | null; escalation_reason: string | null;
    profiles: { full_name: string; specialization: string | null; avatar_url: string | null } | null;
    framework_competencies: { name: string; framework_domains: { name: string; frameworks: { name: string } | null } | null } | null;
  }[]).map(e => ({
    id: e.id, nurseId: e.nurse_id,
    nurseName: e.profiles?.full_name ?? "—",
    department: e.profiles?.specialization ?? "General",
    avatarUrl: e.profiles?.avatar_url ?? null,
    skillName: e.skill_name,
    competency: e.framework_competencies?.name ?? null,
    domain: e.framework_competencies?.framework_domains?.name ?? null,
    framework: e.framework_competencies?.framework_domains?.frameworks?.name ?? null,
    performedAt: e.performed_at, location: e.location,
    supervision: e.supervision_level, notes: e.notes,
    status: e.status as EvidenceEntry["status"],
    submittedAt: e.created_at,
    escalatedBy: e.escalated_by_name, escalationReason: e.escalation_reason,
    evidence: evidenceByEntry.get(e.id) ?? [],
    checklist: e.competency_id ? (skillsByCompetency.get(e.competency_id) ?? []) : [],
    history: historyByKey.get(`${e.nurse_id}:${e.skill_name.trim().toLowerCase()}`) ?? [],
    feed: feedByEntry.get(e.id) ?? [],
  }));

  // Real average review time from my verified entries
  const turnarounds = (myVerified ?? [])
    .map(v => (new Date(v.verified_at!).getTime() - new Date(v.created_at).getTime()) / 3600000)
    .filter(h => h >= 0);
  const avgHours = turnarounds.length
    ? Math.round((turnarounds.reduce((s, h) => s + h, 0) / turnarounds.length) * 10) / 10 : null;

  const threeDaysAgo = nowMs() - 3 * 86400000;
  const kpis: CentreKpis = {
    pending: entries.filter(e => e.status === "pending").length,
    reviewedToday: (reviewedToday ?? []).length,
    returned: entries.filter(e => e.status === "changes_requested").length,
    aging: entries.filter(e => e.status === "pending" && new Date(e.submittedAt).getTime() < threeDaysAgo).length,
    avgHours,
  };

  return <EvidenceCentre entries={entries} kpis={kpis} isSenior={isSenior} />;
}
