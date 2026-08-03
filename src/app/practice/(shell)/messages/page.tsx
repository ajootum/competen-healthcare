import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listThreads } from "@/lib/practice/communication";
import NewThread from "./NewThread";

// /practice/messages -- CPR-320's internal conversations.
//
// UNREAD IS PER READER, DERIVED FROM A CURSOR. The same list renders differently for each member, which
// is why the page is force-dynamic and the caller comes from the session. Nothing on this page was
// sent anywhere: these are conversations inside the practice, and the footer says so.

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "message.use")) redirect("/practice/home");

  const admin = createAdminClient();
  const threads = await listThreads(admin, shell.ctx.workspaceId, shell.ctx.userId);
  const unread = threads.filter(t => t.unread);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-gray-900">Messages</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        Conversations inside this practice. Nothing here is sent to patients or anywhere outside it
        &mdash; this product has no way to do that, and does not pretend otherwise.
      </p>

      <NewThread />

      {threads.length === 0 ? (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-[13px] font-semibold text-gray-700">No conversations yet.</p>
          <p className="mt-1 text-[12px] text-gray-500">
            Start one for anything the team should see in one place rather than in somebody&apos;s memory
            of a corridor conversation.
          </p>
        </section>
      ) : (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          {unread.length > 0 && (
            <p className="mb-2 text-[11px] font-semibold text-[var(--cp-primary-deep)]">
              {unread.length} with something you have not seen.
            </p>
          )}
          <ul className="flex flex-col">
            {threads.map(t => (
              <li key={t.id} className="border-b border-gray-100 py-2 last:border-0">
                <div className="flex items-baseline gap-2">
                  {t.unread && <span aria-label="unread" className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-[var(--cp-primary)]" />}
                  <Link href={`/practice/messages/${t.id}`}
                    className={`text-[13px] hover:underline ${t.unread ? "font-bold text-gray-900" : "font-semibold text-gray-700"}`}>
                    {t.subject}
                  </Link>
                  {t.patient_name && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                      {t.patient_name}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-gray-400">
                    {String(t.last_message_at).slice(0, 16).replace("T", " ")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
