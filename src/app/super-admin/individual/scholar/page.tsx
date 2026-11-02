/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireHqCapability } from "@/lib/hq/context";
import { individualAppEnabled } from "@/lib/individual/gate";
import { readIndividualAccess } from "@/lib/individual/access";
import Link from "next/link";
import PreviewLauncher from "./_components/PreviewLauncher";

// Request-time only: it reads the session and live state, and must never be prerendered at build.
export const dynamic = "force-dynamic";

/**
 * Competen HQ -- View Scholar. HQ-SCHOLAR-PREVIEW-01 (migration 860).
 *
 * Opens the REAL Competen Scholar as a designated demonstration learner, on the separate preview host, in a new tab. The HQ
 * user's own session on this host is never touched: the preview host has its own host-only cookies, and the learner's session
 * there is the demonstration learner's own.
 *
 * ⚠ GATED BY requireHqCapability("hq.individual.scholar.preview") -- the Individual Product Administrator, the Individual
 * Product Reviewer, and the platform owners. The route it posts to checks the same capability again (hqApiGate).
 * ⚠ HOLDING THE RIGHT TO PREVIEW IS NOT ACCESS TO SCHOLAR. "My Scholar" below reports the person's OWN Individual status
 * and never grants it: an administrator cannot grant themselves access (only another holder of the Individual access right, or
 * the owner, can).
 * ⚠ NO LEARNER RECORD IS READ HERE. Seeded-record counts for the demonstration learners would put Scholar learner tables on
 * this plane's allowlist (plane-boundary.ts), which is a security decision of its own and not part of this change. The
 * readiness below is the designation and the learner's access state, and the seeded counts come from the provisioning
 * script's `status` command.
 */

const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }) : "";

function sessionState(s: any): string {
  if (s.ended_at) return s.end_reason === "ended_by_user" ? "Ended by you" : "Ended";
  if (!s.consumed_at) return new Date(s.ticket_expires_at ?? 0).getTime() < Date.now() ? "Link not used" : "Waiting to open";
  return new Date(s.expires_at).getTime() < Date.now() ? "Expired" : "Open";
}

export default async function ViewScholarPage() {
  const ctx = await requireHqCapability("hq.individual.scholar.preview");
  const admin: any = ctx.admin;
  const enabled = await individualAppEnabled(admin);

  const learnersRead = await admin.from("individual_scholar_preview_learner").select("user_id, mode, designated_at").order("mode");
  // 860 absent, or the table unreadable: the screen says it is not set up rather than showing an empty list as if nobody were designated.
  const setUp = !learnersRead.error;
  const learners: { user_id: string; mode: "read_only" | "testing"; designated_at: string }[] = learnersRead.data ?? [];
  const readOnly = learners.find(l => l.mode === "read_only") ?? null;
  const testing = learners.find(l => l.mode === "testing") ?? null;

  const ids = learners.map(l => l.user_id);
  const people = ids.length ? await admin.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const nameOf = new Map<string, string>(((people.data ?? []) as any[]).map(p => [p.id, p.full_name ?? p.email ?? "Unnamed"]));
  const access = new Map<string, Awaited<ReturnType<typeof readIndividualAccess>>>();
  for (const l of learners) access.set(l.user_id, await readIndividualAccess(admin, l.user_id));
  const scholarLive = (id: string) => { const a = access.get(id); return a?.state === "member" && a.live.includes("scholar"); };

  const mine = await readIndividualAccess(admin, ctx.userId);
  const myScholarLive = mine.state === "member" && mine.live.includes("scholar");

  const sessionsRead = await admin.from("individual_scholar_preview_session")
    .select("mode, created_at, consumed_at, ended_at, end_reason, expires_at, ticket_expires_at")
    .eq("actor_id", ctx.userId).order("created_at", { ascending: false }).limit(10);
  const sessions: any[] = sessionsRead.data ?? [];

  const card = "rounded-2xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-5";
  const h2 = "text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500";

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Individual</p>
        <h1 className="text-xl font-bold text-gray-900">View Scholar</h1>
        <p className="mt-1 text-sm text-gray-600">See the real Competen Scholar the way a learner sees it, without a learner&apos;s account.</p>
      </header>

      {!enabled && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          Competen Individual is switched off here, so a preview would open to a page that does not exist.
        </p>
      )}
      {!setUp && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          The Scholar preview is not set up on this environment yet. Nothing below can be opened.
        </p>
      )}

      <section aria-labelledby="view-h" className={`${card} space-y-3`}>
        <h2 id="view-h" className={h2}>View Scholar</h2>
        <p className="text-sm text-gray-700">
          Product Preview opens the real Scholar as the demonstration learner: read-only, for 60 minutes, in a new tab. Nothing you
          do there changes anything, and your own HQ session stays signed in here.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {readOnly && enabled ? (
            <PreviewLauncher mode="read_only" label="Open Product Preview" />
          ) : (
            <p className="text-[13px] text-gray-600">
              {readOnly ? "Competen Individual is switched off." : "No demonstration learner is designated for the read-only preview yet. An owner designates one, see the readiness below."}
            </p>
          )}
        </div>

        {testing && enabled && (
          <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <h3 className="text-[13px] font-bold text-amber-900">Testing mode</h3>
            <p className="mt-1 text-[13px] text-amber-900">
              Testing mode lets you use Scholar for real, as a separate sandbox demonstration learner. Changes and AI use go to that
              sandbox learner, never to a real one. Use it only to try a flow the read-only preview cannot show.
            </p>
            <div className="mt-3">
              <PreviewLauncher mode="testing" tone="amber" label="Open Testing mode"
                confirmText="Testing mode is not read-only. What you do (including AI use) is recorded against the sandbox demonstration learner. Open it?" />
            </div>
          </div>
        )}

        <p className="text-[12.5px] text-gray-600">
          Device preview: open on a phone or tablet, or use your browser&apos;s responsive mode. Preview shows the same responsive Scholar.
        </p>
      </section>

      <section aria-labelledby="ready-h" className={`${card} space-y-3`}>
        <h2 id="ready-h" className={h2}>Demonstration learners</h2>
        {learners.length === 0 ? (
          <p className="text-sm text-gray-700">
            None designated. A demonstration learner is an account classified Demo (HQ Users) that a platform owner designates for a
            mode. The provisioning script prepares them with representative material on the staging environment.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--cmp-app-border)]">
            {learners.map(l => (
              <li key={l.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-semibold text-gray-900">{nameOf.get(l.user_id) ?? "Unnamed"}</span>
                  <span className="ml-2 text-gray-600">{l.mode === "read_only" ? "Read-only preview" : "Testing mode sandbox"}</span>
                </span>
                <span className="text-[13px] text-gray-600">
                  {scholarLive(l.user_id) ? "Scholar access in place" : "Scholar access is not live for this account"} · designated {when(l.designated_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12.5px] text-gray-600">
          Counts of the seeded records are not shown here, because reading learner tables from HQ is outside this screen&apos;s boundary.
          They are listed by the provisioning script&apos;s status command.
        </p>
      </section>

      <section aria-labelledby="mine-h" className={`${card} space-y-2`}>
        <h2 id="mine-h" className={h2}>My Scholar</h2>
        {myScholarLive ? (
          <p className="text-sm text-gray-700">
            You have your own Scholar access.{" "}
            <Link href="/individual/scholar" className="font-semibold underline">Open my Scholar</Link> (your own account, on this site).
          </p>
        ) : mine.state === "unavailable" ? (
          <p className="text-sm text-gray-700">Your own Individual status could not be read just now.</p>
        ) : (
          <p className="text-sm text-gray-700">
            Your own Scholar access is granted by another holder of the Individual access right, or the owner. Administrators cannot grant
            themselves access.{" "}
            <Link href="/super-admin/individual" className="font-semibold underline">Individual pilot access</Link>
          </p>
        )}
      </section>

      <section aria-labelledby="recent-h" className={`${card} space-y-2`}>
        <h2 id="recent-h" className={h2}>Your recent preview sessions</h2>
        {sessionsRead.error ? (
          <p className="text-sm text-gray-700">Your sessions could not be read just now.</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-gray-700">You have not opened a preview yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="text-gray-500"><th className="py-1 pr-4 font-semibold">Mode</th><th className="py-1 pr-4 font-semibold">Started</th><th className="py-1 font-semibold">State</th></tr></thead>
              <tbody>
                {sessions.map((s, i) => (
                  <tr key={i} className="border-t border-[var(--cmp-app-border)]">
                    <td className="py-1.5 pr-4">{s.mode === "testing" ? "Testing mode" : "Read-only"}</td>
                    <td className="py-1.5 pr-4">{when(s.created_at)}</td>
                    <td className="py-1.5">{sessionState(s)}{s.ended_at ? ` · ${when(s.ended_at)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
