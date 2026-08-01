import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isStaff, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";
import { notify } from "@/lib/notify";

// Assessment Requests (XWI P2-5) — the supervisor -> assessor path that did not exist.
//
// A shift supervisor who finds a nurse is not competent for what the ward needs had two options: deploy
// anyway under a governed override, or step outside the system. Neither leaves a record that the gap was
// noticed, so the Competency Office never learned about the ones handled quietly.
//
// assessor_id is OPTIONAL. Null means the request is open to any assessor in the hospital; set means it is
// directed at that person. A supervisor mid-shift usually knows which nurse needs assessing and not which
// assessor is free.
/* eslint-disable @typescript-eslint/no-explicit-any */

const OPEN_STATES = ["open", "claimed"];

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const admin = c.admin as any;
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";

  let q = admin.from("assessment_requests")
    .select("*, nurse:profiles!nurse_id(full_name), requester:profiles!requested_by(full_name), competency:framework_competencies!competency_id(name)")
    .order("urgency", { ascending: false }).order("created_at", { ascending: false }).limit(200);

  // Tenant scope in code, because RLS is service-role-only on this table by design.
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  if (url.searchParams.get("status")) q = q.eq("status", url.searchParams.get("status"));
  else q = q.in("status", OPEN_STATES);
  // An assessor's own queue: directed at them, or unclaimed and open to anyone.
  if (mine) q = q.or(`assessor_id.eq.${c.userId},assessor_id.is.null,claimed_by.eq.${c.userId}`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.nurse_id) return badRequest("nurse_id required");
  const admin = c.admin as any;

  // The subject decides the tenant, never the caller — the subject-vs-caller rule this codebase closed
  // across 27 write sites.
  const scopeErr = await assertProfileScope(c, b.nurse_id);
  if (scopeErr) return scopeErr;
  const { data: subject } = await admin.from("profiles").select("hospital_id, full_name").eq("id", b.nurse_id).maybeSingle();
  if (b.assessor_id) {
    const aErr = await assertProfileScope(c, b.assessor_id);
    if (aErr) return aErr;
  }

  const { data, error } = await admin.from("assessment_requests").insert({
    hospital_id: subject?.hospital_id ?? null,
    nurse_id: b.nurse_id,
    competency_id: b.competency_id ?? null,
    cycle_id: b.cycle_id ?? null,
    requested_by: c.userId,
    requested_role: c.role ?? null,
    assessor_id: b.assessor_id ?? null,
    reason: b.reason?.trim() || null,
    urgency: b.urgency === "urgent" ? "urgent" : "routine",
  }).select("id, urgency, assessor_id").single();

  // The partial unique index refuses a second OPEN request for the same nurse+competency, so a supervisor
  // pressing twice does not queue the same work twice for whoever picks it up.
  if (error) {
    if ((error as any).code === "23505") {
      return NextResponse.json({ error: "An assessment request for this competency is already open.", duplicate: true }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("audit_log").insert({
    trace_id: c.traceId, actor_id: c.userId, action: "assessment_requested", entity_type: "assessment_requests", entity_id: data.id,
    entity_name: subject?.full_name ?? null, hospital_id: subject?.hospital_id ?? null,
    new_value: { nurse_id: b.nurse_id, competency_id: b.competency_id ?? null, urgency: data.urgency, directed: !!data.assessor_id },
  });

  // A directed request reaches its assessor. An open one is picked up from the queue, so nobody is
  // notified rather than everybody -- a request that pages every assessor in the hospital gets ignored.
  if (data.assessor_id) {
    await notify([data.assessor_id], {
      type: "assessment_request",
      title: `Assessment requested${data.urgency === "urgent" ? " (urgent)" : ""}`,
      body: `${subject?.full_name ?? "A nurse"} needs a competency assessment.${b.reason ? ` ${String(b.reason).slice(0, 160)}` : ""}`,
      href: "/assessor",
    });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));

  const { data: row } = await admin.from("assessment_requests")
    .select("id, hospital_id, status, assessor_id, claimed_by, requested_by, nurse_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const update: any = {};
  if (b.action === "claim") {
    if (!OPEN_STATES.includes(row.status)) return badRequest(`Cannot claim a ${row.status} request`);
    // A directed request is that assessor's to take. Anyone may claim an open one.
    if (row.assessor_id && row.assessor_id !== c.userId && !isSuper(c)) return forbidden("This request is directed at another assessor");
    if (row.claimed_by && row.claimed_by !== c.userId) return NextResponse.json({ error: "Already claimed by another assessor", claimed: true }, { status: 409 });
    update.status = "claimed"; update.claimed_by = c.userId; update.claimed_at = new Date().toISOString();
  } else if (b.action === "release") {
    if (row.claimed_by !== c.userId && !isSuper(c)) return forbidden("Only the assessor holding it can release it");
    update.status = "open"; update.claimed_by = null; update.claimed_at = null;
  } else if (b.action === "complete") {
    if (row.claimed_by !== c.userId && !isSuper(c)) return forbidden("Only the assessor holding it can complete it");
    update.status = "completed"; update.completed_at = new Date().toISOString();
    if (typeof b.outcome_note === "string") update.outcome_note = b.outcome_note.trim() || null;
  } else if (b.action === "decline") {
    update.status = "declined"; update.outcome_note = b.outcome_note?.trim() || null;
  } else if (b.action === "cancel") {
    // The requester withdraws it — a supervisor who solved it another way should not leave a queue item.
    if (row.requested_by !== c.userId && !isSupervisor(c)) return forbidden("Only the requester or a supervisor can cancel");
    update.status = "cancelled";
  } else return badRequest("action must be claim, release, complete, decline or cancel");

  const { data, error } = await admin.from("assessment_requests").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    trace_id: c.traceId, actor_id: c.userId, action: `assessment_request_${b.action}`, entity_type: "assessment_requests",
    entity_id: id, hospital_id: row.hospital_id, new_value: { from: row.status, to: update.status },
  });

  // Closing the loop the other way: the supervisor who asked hears what happened.
  if (["completed", "declined"].includes(update.status) && row.requested_by && row.requested_by !== c.userId) {
    await notify([row.requested_by], {
      type: "assessment_request",
      title: `Assessment request ${update.status}`,
      body: update.outcome_note ? String(update.outcome_note).slice(0, 200) : `Your assessment request was ${update.status}.`,
      href: "/supervisor",
    });
  }
  return NextResponse.json(data);
}
