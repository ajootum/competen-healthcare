import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listIncoming } from "@/lib/practice/communication";
import InboxConsole from "./InboxConsole";

// /practice/inbox -- CPR-320's register of what ARRIVED at the practice.
//
// AWAITING REVIEW IS FIRST AND LOUDEST. A lab result that arrived and was never looked at is the
// classic way a practice hurts somebody by omission, and this page exists so that pile is visible
// rather than physical. The product does not HOLD the documents -- where_held says where each one is
// -- it holds the fact of their arrival and the name of whoever reviewed them.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "inbox.record")) redirect("/practice/home");

  const admin = createAdminClient();
  const incoming = await listIncoming(admin, shell.ctx.workspaceId, {}) as any[];
  const received = incoming.filter(d => d.status === "RECEIVED");
  const reviewed = incoming.filter(d => d.status === "REVIEWED");
  const actioned = incoming.filter(d => d.status === "ACTIONED").slice(0, 15);

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inbox</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            What arrived at the practice &mdash; results, reports, letters &mdash; and whether anybody
            has looked. The documents themselves stay where they are; this register holds the fact of
            their arrival and the name of the reviewer.
          </p>
        </div>
        <Link href="/practice/documents" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          Issued documents →
        </Link>
      </div>

      <InboxConsole
        received={received}
        reviewed={reviewed}
        actioned={actioned}
        canReview={hasCapability(shell.ctx, "inbox.review")}
      />
    </div>
  );
}
