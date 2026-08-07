import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { documentsOverview } from "@/lib/practice/documents-workspace";
import WorkspaceHeader from "./_workspace/WorkspaceHeader";
import OverviewBoard from "./_workspace/OverviewBoard";

// /practice/documents -- CPR-DOC-002 s4, THE OVERVIEW DASHBOARD.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS REPLACED, AND WHY (s22, "Documents landing page shows an empty library -> Replace with
// Overview dashboard and operational queues"). The previous page was CPR-130's document REGISTER: two
// lists of practitioner-authored documents, split by whether they had been signed. It was correct and it
// answered one question. It could not answer "what needs me", it could not see anything that ARRIVED,
// and its empty state was the words "No documents yet" -- which s4.1 forbids by name.
//
// The register itself is not lost. It is Patient Documents and My Documents, with the arrivals and the
// patient files merged into it, which is what s3 asks for.
//
// PHASE 1 ONLY (s20). No editor, no PDF render, no signature or sharing surface, no review queue, no AI
// drafting, no saved views. Where the comp draws one of those, it is not drawn here -- see the note in
// OverviewBoard.tsx about why "not drawn" rather than "drawn disabled".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function DocumentsOverviewPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  // The same gate the sidebar entry uses. document.view, which migration 195 grants the practitioner and
  // deliberately withholds from the practice owner -- the owner of a practice is a business role.
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const admin = createAdminClient();
  const overview = await documentsOverview(admin, shell.ctx.workspaceId, {
    userId: shell.ctx.userId, capabilities: shell.ctx.capabilities,
  });

  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <WorkspaceHeader active="overview" capabilities={shell.ctx.capabilities} />
      <OverviewBoard overview={overview} capabilities={shell.ctx.capabilities} />
    </div>
  );
}
