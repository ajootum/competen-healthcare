import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getThread, markThreadRead } from "@/lib/practice/communication";
import Reply from "./Reply";
import { practiceDayOf, workspaceClock } from "@/lib/practice/practice-time";

// /practice/messages/{id} -- one conversation.
//
// OPENING THE PAGE MOVES YOUR CURSOR. A page render is a person looking -- unlike the API GET, which a
// prefetcher can fire and which therefore does not mark anything read. The cursor moves AFTER the load
// succeeds, and only the caller's own.
//
// Messages have no edit and no delete: what was said and read cannot be unsaid, and the database
// enforces it (migration 200 s5). A correction is the next message.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "message.use")) redirect("/practice/home");

  const { threadId } = await params;
  const admin = createAdminClient();
  // The practice's own day for every date rendered below. These were UTC slices of timestamptz
  // columns, which name yesterday for the three hours a practice ahead of UTC is already on tomorrow.
  const { timezone } = await workspaceClock(admin, shell.ctx.workspaceId);
  const detail = await getThread(admin, shell.ctx.workspaceId, threadId);
  if (!detail) notFound();

  await markThreadRead(admin, { workspaceId: shell.ctx.workspaceId, threadId, userId: shell.ctx.userId });

  const { thread, messages } = detail as any;

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{thread.subject}</h1>
          <p className="mt-0.5 text-[12px] text-gray-500">
            {thread.patient_name && (
              <>about{" "}
                <Link href={`/practice/patients/${thread.patient_id}`} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  {thread.patient_name}
                </Link>{" · "}</>
            )}
            started {practiceDayOf(timezone, thread.created_at) ?? "date not recorded"}
          </p>
        </div>
        <Link href="/practice/messages" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">← Messages</Link>
      </div>

      <section className="mt-4 flex flex-col gap-2">
        {messages.map((m: any) => (
          <div key={m.id} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] font-bold text-gray-900">{m.author_name ?? "Unnamed member"}</span>
              <span className="ml-auto font-mono text-[10px] text-gray-400">
                {String(m.created_at).slice(0, 16).replace("T", " ")}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[13px] text-gray-800">{m.body}</p>
          </div>
        ))}
      </section>

      <Reply threadId={thread.id} />

      <p className="mt-3 text-[10px] text-gray-400">
        Messages cannot be edited or deleted &mdash; what was said and read cannot be unsaid, and the
        database refuses the attempt. A correction is the next message. Nothing here leaves the practice.
      </p>
    </div>
  );
}
