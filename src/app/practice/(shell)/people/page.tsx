import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listTeam, listInvitations, membershipHistory } from "@/lib/practice/team";
import { delegationBoard, workQueues, listApprovals, listRoleTemplates } from "@/lib/practice/delegation";
import TeamConsole from "./TeamConsole";
import DelegationConsole from "./DelegationConsole";

// /practice/people -- CPR-310 TEAM AND DELEGATED ACCESS.
//
// THE CAPABILITY LIST IS SHOWN IN FULL, per person. A team page that shows role names alone asks the
// owner to remember what "practice assistant" grants, and the answer has changed with every module
// since Phase 0. Showing the actual capabilities makes the boundary legible at the moment somebody is
// deciding whether to widen it.
//
// REVOKED PEOPLE STAY LISTED. "Who used to have access" is the question an audit asks, and a page that
// shows only current members answers it with silence.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// NO CAPABILITY GUARDS THE PAGE ANY MORE. It guards the MANAGEMENT half, inside.
//
// The page used to redirect anybody without practice.members.manage — which put the approval queue out
// of reach of exactly the people it exists for. CPR-310's comp puts "My Approvals" in the top strip: a
// practitioner reviewing a letter their secretary prepared is the module's central workflow, and
// requiring an administrative permission to do it gets the module backwards.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const canManage = hasCapability(ctx, "practice.members.manage");
  const admin = createAdminClient();

  const [board, queues, approvals, templates, team, invitations, history] = await Promise.all([
    delegationBoard(admin, ctx.workspaceId),
    workQueues(admin, ctx.workspaceId, ctx.userId),
    listApprovals(admin, ctx.workspaceId, { status: "PENDING" }),
    listRoleTemplates(admin, ctx.workspaceId),
    canManage ? listTeam(admin, ctx.workspaceId) : Promise.resolve([]),
    canManage ? listInvitations(admin, ctx.workspaceId) : Promise.resolve([]),
    canManage ? membershipHistory(admin, ctx.workspaceId) : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-bold text-gray-900">Team and delegated access</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        Work together while keeping clinical ownership. Who holds what, for how long, and what is waiting
        on you.
      </p>

      <DelegationConsole
        board={board}
        queues={queues}
        approvals={approvals}
        templates={templates}
        team={team}
        canManage={canManage}
        me={ctx.userId}
      />

      {canManage && (
        <>
          <h2 className="mt-6 text-[15px] font-bold text-gray-900">Members and access</h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            Every capability each person holds, and how it got there.
          </p>
          <TeamConsole
            team={team}
            invitations={invitations}
            history={history}
            me={ctx.userId}
            myCapabilities={ctx.capabilities}
          />
        </>
      )}
    </div>
  );
}
