import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { pathwayWorkspace } from "@/lib/practice/pathways";
import { PATHWAY_CAPABILITIES } from "@/lib/practice/pathways-constants";
import PathwaysWorkspace from "./PathwaysWorkspace";

// /practice/pathways -- CPR-FUP-003 s12, the Care Pathways workspace.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A PATHWAY IS A PLAN, NOT A PROTOCOL (s2). This screen shows what a practitioner PLANNED for a patient
// and where they have actually got to -- and every departure from the plan is a first-class action on
// it, not an exception hidden behind a menu. Nothing on this page can refuse a deviation.
//
// ⚠ THE PROGRESS CHIPS ARE ARITHMETIC. "On track" and "Overdue" are the current stage's due date against
// this practice's today, computed at read time. The design also shows "At risk" between them, and it is
// NOT RENDERED -- see AT_RISK_REFUSAL in pathways-constants.ts. There is no date rule that produces it,
// and a threshold nobody chose printed where a clinical judgement goes is worse than a missing chip.
//
// ⚠ THREE CAPABILITIES, ALL SEEDED BY MIGRATION 239 s8. pathway.view to read, pathway.assign to put
// somebody on a plan, pathway.design to author one. An invented code would 403 for everybody including
// the practice owner and nothing would error.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PathwaysPage({ searchParams }: {
  searchParams: Promise<{ q?: string; templateId?: string; status?: string; tab?: string; open?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, PATHWAY_CAPABILITIES.view)) redirect("/practice/home");

  const sp = await searchParams;
  const admin = createAdminClient();

  const workspace = await pathwayWorkspace(admin, shell.ctx.workspaceId, {
    search: sp.q ?? null,
    templateId: sp.templateId ?? null,
    status: sp.status ?? null,
  });

  return (
    <div className="max-w-[1400px]">
      <PathwaysWorkspace
        workspace={workspace}
        canAssign={hasCapability(shell.ctx, PATHWAY_CAPABILITIES.assign)}
        canDesign={hasCapability(shell.ctx, PATHWAY_CAPABILITIES.design)}
        initialTab={sp.tab === "templates" ? "templates" : "patients"}
        initialSearch={sp.q ?? ""}
        initialOpen={sp.open ?? null}
      />
    </div>
  );
}
