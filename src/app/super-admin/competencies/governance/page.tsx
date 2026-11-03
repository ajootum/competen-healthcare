import type { Metadata } from "next";
import Link from "next/link";
import { requireAnyHqCapability, holdsHqCapability } from "@/lib/hq/context";
import { loadGovernanceIndex } from "@/lib/competency/governance-workspace";

// /super-admin/competencies/governance -- FRAMEWORK-GOVERNANCE-WORKSPACE-01, the landing page: every shared framework
// with what is waiting in it, and one door into the workspace for each. Admits an author, a clinical reviewer or a
// publisher; each sees the counts that concern them. Nothing is decided here.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Framework governance" };

const CAPABILITIES = ["hq.quality.competency.author", "hq.quality.clinical.approve", "hq.quality.competency.publish"];
const STATUS: Record<string, string> = { draft: "Draft", in_review: "Awaiting publication decision", approved: "Approved, not published", published: "Published", archived: "Archived" };

export default async function GovernanceIndexPage() {
  const ctx = await requireAnyHqCapability(CAPABILITIES);
  const [canAuthor, canReview, canPublish] = await Promise.all(CAPABILITIES.map(c => holdsHqCapability(c)));
  const me = { canAuthor, canReview, canPublish };
  const rows = await loadGovernanceIndex(ctx.admin, ctx.userId, me);
  return (
    <div className="max-w-6xl space-y-5">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competency Studio</p>
        <h1 className="text-xl font-bold text-gray-900">Framework governance</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Authoring hand-offs, clinical review and publication readiness for each shared framework, on one page. You see the actions your
          appointment allows{me.canReview ? "; your review queue is marked" : ""}. Approval stays per competency at its exact version, and
          publication stays a separate, independent decision.
        </p>
      </header>
      {rows === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">The frameworks could not be read just now. Nothing is shown rather than a partial list.</p>
      ) : rows.length === 0 ? (
        <p className="text-[13.5px] text-gray-700">No shared framework yet. Authors create them in Competency Authoring.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-[13.5px]">
            <thead><tr className="border-b border-gray-200 text-[12px] text-gray-500">
              <th className="px-4 py-2.5 font-semibold">Framework</th><th className="px-2 py-2.5 font-semibold">Status</th>
              <th className="px-2 py-2.5 text-right font-semibold">Needs my action</th><th className="px-2 py-2.5 text-right font-semibold">Ready</th>
              <th className="px-2 py-2.5 text-right font-semibold">In review</th><th className="px-2 py-2.5 text-right font-semibold">Needs changes</th>
              <th className="px-2 py-2.5 text-right font-semibold">Approved</th><th className="px-4 py-2.5" />
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="px-4 py-2.5"><span className="font-semibold text-gray-900">{r.name}</span><span className="block font-mono text-[11.5px] text-gray-500">{r.code ?? "no code"} · {r.total} competencies</span></td>
                  <td className="px-2 py-2.5 text-gray-700">{STATUS[r.pubStatus] ?? r.pubStatus}{r.pending && <span className="ml-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-amber-900">request submitted</span>}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.mine ? <span className="rounded-md bg-teal-50 px-2 py-0.5 font-semibold text-teal-900">{r.mine}</span> : <span className="text-gray-400">0</span>}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.ready}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.inReview}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.changes}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.approved} / {r.total}</td>
                  <td className="px-4 py-2.5 text-right"><Link href={`/super-admin/competencies/governance/${r.id}`} className="font-semibold text-teal-800 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:items-center">Open workspace →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12.5px] text-gray-600">
        Specialist pages stay for advanced administration: <Link href="/super-admin/competencies/authoring" className="font-semibold underline">Competency Authoring</Link>,{" "}
        <Link href="/super-admin/clinical-review" className="font-semibold underline">Clinical Review</Link>, <Link href="/super-admin/competencies/publication" className="font-semibold underline">Framework Publication</Link>.
      </p>
    </div>
  );
}
