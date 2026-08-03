import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listTeam, listInvitations, membershipHistory } from "@/lib/practice/team";
import TeamConsole from "./TeamConsole";

// /practice/team -- CPR-310.
//
// THE CAPABILITY LIST IS SHOWN IN FULL, per person. A team page that shows role names alone asks the
// owner to remember what "practice assistant" grants, and the answer has changed with every module
// since Phase 0. Showing the actual capabilities makes the boundary legible at the moment somebody is
// deciding whether to widen it.
//
// REVOKED PEOPLE STAY LISTED. "Who used to have access" is the question an audit asks, and a page that
// shows only current members answers it with silence.

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "practice.members.manage")) redirect("/practice/home");

  const admin = createAdminClient();
  const [team, invitations, history] = await Promise.all([
    listTeam(admin, shell.ctx.workspaceId),
    listInvitations(admin, shell.ctx.workspaceId),
    membershipHistory(admin, shell.ctx.workspaceId),
  ]);

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900">Team</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        Who has access to this practice, what that access actually grants, and how it got that way.
      </p>

      <TeamConsole
        team={team}
        invitations={invitations}
        history={history}
        me={shell.ctx.userId}
        myCapabilities={shell.ctx.capabilities}
      />
    </div>
  );
}
