// ── TEAM MEMBERSHIP ── COMP-IDENTITY-001 item 14, over migration 308 ────────────────────────────────
//
// ent_teams has existed since migration 052 with a name and a lead and no way to say who is ON the
// team -- the spec's "one user may belong to multiple organizations and teams" was unexpressible.
// This module is deliberately boring: add, remove, list, mine. The only rule worth a sentence is
// that re-adding somebody is reported as already-there rather than silently succeeding, because a
// screen that said "added" for a person who was already on the team would be claiming an act that
// did not happen.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type TeamResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): { ok: false; status: number; code: string; message: string } =>
  ({ ok: false, status, code, message });

export async function addTeamMember(admin: any, args: {
  teamId: string; userId: string; actorId: string;
}): Promise<TeamResult<{ id: string }>> {
  const { data: team } = await admin.from("ent_teams")
    .select("id, name, is_active").eq("id", args.teamId).maybeSingle();
  if (!team) return fail(404, "NO_SUCH_TEAM", "that team does not exist");
  if (!team.is_active) return fail(422, "TEAM_ARCHIVED", "that team is archived; restore it before adding people");

  const { data: person } = await admin.from("profiles").select("id").eq("id", args.userId).maybeSingle();
  if (!person) return fail(404, "NO_SUCH_PERSON", "that person does not exist");

  const { data, error } = await admin.from("ent_team_members").insert({
    team_id: args.teamId, user_id: args.userId, added_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (String(error.code) === "23505" || /ux_ent_team_members_once/.test(String(error.message)))
      return fail(409, "ALREADY_ON_TEAM", "they are already on this team");
    return fail(500, "WRITE_FAILED", error.message);
  }
  return { ok: true, data: { id: data.id as string } };
}

export async function removeTeamMember(admin: any, args: {
  teamId: string; userId: string;
}): Promise<TeamResult<{ removed: boolean }>> {
  const { data, error } = await admin.from("ent_team_members")
    .delete().eq("team_id", args.teamId).eq("user_id", args.userId).select("id");
  if (error) return fail(500, "WRITE_FAILED", error.message);
  if ((data ?? []).length === 0)
    return fail(404, "NOT_ON_TEAM", "they were not on this team, so there was nothing to remove");
  return { ok: true, data: { removed: true } };
}

export async function listTeamMembers(admin: any, teamId: string) {
  const { data, error } = await admin.from("ent_team_members")
    .select("id, user_id, joined_at, profiles!ent_team_members_user_id_fkey(full_name, email, role, roles)")
    .eq("team_id", teamId).order("joined_at");
  if (error) return { items: [], unavailable: true as const, detail: error.message };
  return { items: (data ?? []) as any[], unavailable: false as const, detail: null };
}

/** The spec's sentence made queryable: which teams does this person belong to. */
export async function teamsOf(admin: any, userId: string) {
  const { data, error } = await admin.from("ent_team_members")
    .select("team_id, joined_at, ent_teams!ent_team_members_team_id_fkey(name, unit_id, is_active)")
    .eq("user_id", userId).order("joined_at");
  if (error) return { items: [], unavailable: true as const, detail: error.message };
  return { items: (data ?? []) as any[], unavailable: false as const, detail: null };
}
