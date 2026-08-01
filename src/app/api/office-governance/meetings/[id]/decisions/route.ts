import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, forbidden, badRequest } from "@/lib/api-auth";
import { loadMeetingInScope, meetingMigrationGate } from "@/lib/ogs/meeting-api";

// OGS-004 write-workflow — record a decision (with its vote tally) taken at a meeting, optionally spawning a
// follow-up action. Admin-tier, tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DECISION_TYPES = ["resolution", "approval", "policy", "endorsement"];
const OUTCOMES = ["carried", "rejected", "deferred", "tabled"];
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const nn = (v: any) => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden("Recording a decision requires admin authority");
  const id = (await params).id;
  const { meeting, resp } = await loadMeetingInScope(c, id);
  if (resp) return resp;

  const b = await req.json().catch(() => ({}));
  const title = clean(b.title);
  if (!title) return badRequest("Decision title required");
  const decisionType = DECISION_TYPES.includes(b.decision_type) ? b.decision_type : "resolution";
  const outcome = OUTCOMES.includes(b.outcome) ? b.outcome : "carried";

  // Roll-call (per-member votes) overrides the manual tally when present.
  const roll = (Array.isArray(b.votes) ? b.votes : []).filter((v: any) => v && typeof v.voter_id === "string" && ["for", "against", "abstain"].includes(v.vote));
  const tally = roll.length
    ? { votes_for: roll.filter((v: any) => v.vote === "for").length, votes_against: roll.filter((v: any) => v.vote === "against").length, votes_abstain: roll.filter((v: any) => v.vote === "abstain").length }
    : { votes_for: nn(b.votes_for), votes_against: nn(b.votes_against), votes_abstain: nn(b.votes_abstain) };

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data: decision, error } = await c.admin.from("ogs_decisions").insert({
    office_id: meeting.office_id, meeting_id: id, agenda_item_id: clean(b.agenda_item_id), hospital_id: meeting.hospital_id ?? null,
    title, description: clean(b.description), decision_type: decisionType, outcome,
    ...tally,
    decided_at: new Date().toISOString(), recorded_by: c.userId, recorded_by_name: me?.full_name ?? null,
  }).select("id, title, outcome").single();
  if (error) return meetingMigrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  // Record the roll-call vote of each member.
  if (roll.length) {
    const voterIds = [...new Set(roll.map((v: any) => v.voter_id))];
    const { data: profs } = await c.admin.from("profiles").select("id, full_name").in("id", voterIds);
    const nameById = new Map<string, string>(((profs ?? []) as any[]).map(p => [p.id, p.full_name]));
    await c.admin.from("ogs_votes").insert(roll.map((v: any) => ({ decision_id: decision.id, voter_id: v.voter_id, voter_name: nameById.get(v.voter_id) ?? null, vote: v.vote })));
  }

  // Optional follow-up action arising from the decision.
  const actionTitle = clean(b.action?.title);
  if (actionTitle) {
    let ownerName: string | null = null;
    const ownerId = typeof b.action?.owner_id === "string" ? b.action.owner_id : null;
    if (ownerId) { const { data: o } = await c.admin.from("profiles").select("full_name").eq("id", ownerId).maybeSingle(); ownerName = o?.full_name ?? null; }
    await c.admin.from("ogs_office_actions").insert({ office_id: meeting.office_id, meeting_id: id, decision_id: decision.id, hospital_id: meeting.hospital_id ?? null, title: actionTitle, owner_id: ownerId, owner_name: ownerName, due_date: clean(b.action?.due_date), status: "open" });
  }

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "record_decision", entity_type: "ogs_decision", entity_id: decision.id, hospital_id: meeting.hospital_id ?? null, new_value: { title, outcome, votes: { for: tally.votes_for, against: tally.votes_against, abstain: tally.votes_abstain }, roll_call: roll.length } });
  return NextResponse.json(decision, { status: 201 });
}
