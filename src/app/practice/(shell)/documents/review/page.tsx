import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { documentsReview } from "@/lib/practice/documents-workspace-review";
import WorkspaceHeader from "../_workspace/WorkspaceHeader";
import ReviewBoard from "../_workspace/ReviewBoard";

// /practice/documents/review -- CPR-DOC-002 s20 PHASE 3: review queues, document tasks, saved views,
// bulk operations and the permission picture.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS IS A TAB AND NOT MORE CARDS ON THE OVERVIEW. s4's attention queues are PREVIEWS -- eight rows
// and a link -- and that was right while nothing could be assigned to anybody. The moment work has an
// owner, "what is mine" and "what is the practice's" become two lists, and neither fits under a card.
//
// ⚠ WHAT THIS PAGE IS HONEST ABOUT, IN THE INTERFACE RATHER THAN ONLY IN A COMMENT. The arrivals queue
// -- the one migration 200 calls the missed-result harm -- CANNOT BE ASSIGNED TO ANYBODY, because
// practice_task has no incoming_document_id. It is drawn as the practice's, it says so in those words,
// and no assign control is drawn over it. See the header of documents-workspace-review.ts for the exact
// column that would close it.
//
// ⚠ THREE STATES REACH THE SCREEN. Every queue below is a Reading, and an unreadable one prints the
// database's own words in place of the list. A review queue that cannot read its source must never
// render as an empty queue: "there is nothing to review" tells a practitioner to stop looking.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function DocumentsReviewPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const admin = createAdminClient();
  const review = await documentsReview(admin, shell.ctx);

  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <WorkspaceHeader active="review" capabilities={shell.ctx.capabilities} />
      <ReviewBoard
        review={review}
        canAssign={hasCapability(shell.ctx, "task.manage")}
        canClassify={hasCapability(shell.ctx, "inbox.record")}
      />
      <p className="text-[11px] text-gray-400">
        Tasks about documents are shown here. Every other kind of task this practice owes lives on{" "}
        <Link href="/practice/tasks" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
          the task board
        </Link>
        , which is the same table read a different way &mdash; nothing is duplicated between them.
      </p>
    </div>
  );
}
