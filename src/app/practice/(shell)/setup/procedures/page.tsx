import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listProcedureTypes } from "@/lib/practice/procedures";
import ProcedureConfigurationConsole from "./ProcedureConfigurationConsole";

// Procedure catalogue configuration -- CPR-PROC-HFE-005 s20's SETTINGS SCREEN, the one migration 297
// shipped without ("a practice configures them only by SQL today" -- no longer).
//
// The split it renders is the schema's own: SUPPLIED procedures (workspace_id null) can be hidden,
// renamed locally and sorted -- never rule-edited; YOUR OWN procedures carry the full s20 rule set
// (site/laterality/consent tri-states, allowed values, default status, outcome requirement).
//
// Read gate mirrors the investigations precedent: recording staff may LOOK (the screen explains what
// the capture form will ask); procedure.manage is required to TOUCH, enforced at the API route and
// again in the engine.

export const dynamic = "force-dynamic";

export default async function ProcedureSetupPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const canManage = hasCapability(shell.ctx, "procedure.manage");
  if (!canManage && !hasCapability(shell.ctx, "procedure.record")) redirect("/practice/setup");

  const admin = createAdminClient();
  const types = await listProcedureTypes(admin, shell.ctx.workspaceId, {
    includeUnpublished: true, includeDisabled: true,
  });

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900">Procedure catalogue</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        What each procedure requires before it can be recorded &mdash; and which supplied procedures
        this practice offers at all.
      </p>
      <div className="mt-4">
        <ProcedureConfigurationConsole types={types} canManage={canManage} />
      </div>
    </div>
  );
}
