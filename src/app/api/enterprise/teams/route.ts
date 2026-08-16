import { NextRequest, NextResponse } from "next/server";
import { getCaller, hasRole } from "@/lib/api-auth";
import { addTeamMember, removeTeamMember, listTeamMembers, teamsOf } from "@/lib/enterprise/teams";

// /api/enterprise/teams -- team MEMBERSHIP (migration 308). The teams themselves are created and
// archived by the enterprise structure route; this one answers who is on them. Managing membership
// takes the same authority as managing structure (hospital_admin / super_admin); reading your OWN
// teams takes none, because which teams you belong to is a fact about you.

export async function GET(req: NextRequest) {
  const c = await getCaller();
  if (c instanceof NextResponse) return c;

  const teamId = req.nextUrl.searchParams.get("teamId");
  if (teamId) {
    if (!hasRole(c, "hospital_admin", "super_admin"))
      return NextResponse.json({ error: "listing a team's members needs an administrator" }, { status: 403 });
    return NextResponse.json({ members: await listTeamMembers(c.admin, teamId) });
  }
  return NextResponse.json({ teams: await teamsOf(c.admin, c.userId) });
}

export async function POST(req: NextRequest) {
  const c = await getCaller();
  if (c instanceof NextResponse) return c;
  if (!hasRole(c, "hospital_admin", "super_admin"))
    return NextResponse.json({ error: "managing team membership needs an administrator" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const action = String(body.action ?? "");
  const teamId = String(body.teamId ?? "");

  // The builder adds by EMAIL (the directory is a tab away on that screen); the engine works in
  // account ids. Resolved here, refused plainly when nobody holds the address.
  let userId = String(body.userId ?? "");
  if (!userId && typeof body.email === "string" && body.email.trim()) {
    const { data: person } = await c.admin.from("profiles")
      .select("id").eq("email", body.email.trim().toLowerCase()).maybeSingle();
    if (!person) return NextResponse.json({ error: "no Competen account holds that email address" }, { status: 404 });
    userId = person.id as string;
  }

  if (action === "add") {
    const result = await addTeamMember(c.admin, { teamId, userId, actorId: c.userId });
    if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
    await c.admin.from("audit_log").insert({
      trace_id: c.traceId, actor_id: c.userId, action: "team_member_added",
      entity_type: "ent_team_members", entity_id: result.data.id, entity_name: userId,
    });
    return NextResponse.json(result.data, { status: 201 });
  }

  if (action === "remove") {
    const result = await removeTeamMember(c.admin, { teamId, userId });
    if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
    await c.admin.from("audit_log").insert({
      trace_id: c.traceId, actor_id: c.userId, action: "team_member_removed",
      entity_type: "ent_team_members", entity_id: teamId, entity_name: userId,
    });
    return NextResponse.json(result.data);
  }

  return NextResponse.json({ error: "action must be add or remove" }, { status: 400 });
}
