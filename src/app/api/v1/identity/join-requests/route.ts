import { NextRequest, NextResponse } from "next/server";
import { getCaller, hasRole } from "@/lib/api-auth";
import {
  createJoinRequest, myJoinRequests, withdrawJoinRequest, listJoinRequests, decideJoinRequest,
} from "@/lib/org-join";

// /api/v1/identity/join-requests -- the organisation join-request lifecycle (COMP-IDENTITY-001).
//
// GET  ?scope=mine  -> the caller's own requests (any authenticated account -- asking needs no role).
// GET  ?scope=org   -> the approver's inbox, hospital_admin or super_admin only, scoped to THEIR
//                      organisation/facility -- the engine takes the scope from the caller's own
//                      profile, never from a query parameter, so an admin cannot read another
//                      organisation's inbox by editing a URL.
// POST {action:"create"|"withdraw"|"decide", ...} -- create/withdraw are the requester's own acts;
//                      decide re-checks authority INSIDE the engine as well as here.

export async function GET(req: NextRequest) {
  const c = await getCaller();
  if (c instanceof NextResponse) return c;

  const scope = req.nextUrl.searchParams.get("scope") ?? "mine";
  if (scope === "mine") {
    const mine = await myJoinRequests(c.admin, c.userId);
    // The organisation catalogue rides along so the requester's picker and the list are one fetch.
    const { data: orgs } = await c.admin.from("organisations").select("id, name").order("name").limit(500);
    return NextResponse.json({ requests: mine, organisations: orgs ?? [] });
  }

  if (!hasRole(c, "hospital_admin", "super_admin"))
    return NextResponse.json({ error: "the join-request inbox belongs to organisation administrators" }, { status: 403 });
  const inbox = await listJoinRequests(c.admin, {
    organisationId: c.organisationId, hospitalId: c.hospitalId,
    status: req.nextUrl.searchParams.get("status") ?? undefined,
  });
  return NextResponse.json({ requests: inbox });
}

export async function POST(req: NextRequest) {
  const c = await getCaller();
  if (c instanceof NextResponse) return c;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const action = String(body.action ?? "");

  if (action === "create") {
    const result = await createJoinRequest(c.admin, {
      userId: c.userId,
      organisationId: String(body.organisationId ?? ""),
      hospitalId: body.hospitalId ? String(body.hospitalId) : null,
      note: typeof body.note === "string" ? body.note : null,
    });
    if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
    return NextResponse.json(result.data, { status: 201 });
  }

  if (action === "withdraw") {
    const result = await withdrawJoinRequest(c.admin, {
      requestId: String(body.requestId ?? ""), userId: c.userId,
    });
    if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
    return NextResponse.json(result.data);
  }

  if (action === "decide") {
    if (!hasRole(c, "hospital_admin", "super_admin"))
      return NextResponse.json({ error: "answering a join request needs an organisation administrator" }, { status: 403 });
    const result = await decideJoinRequest(c.admin, {
      requestId: String(body.requestId ?? ""),
      approve: body.approve === true,
      decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : null,
      orgRoles: Array.isArray(body.orgRoles) ? (body.orgRoles as string[]) : [],
      hospitalId: body.hospitalId ? String(body.hospitalId) : null,
      actorId: c.userId,
    });
    if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
    return NextResponse.json(result.data);
  }

  return NextResponse.json({ error: "action must be create, withdraw or decide" }, { status: 400 });
}
