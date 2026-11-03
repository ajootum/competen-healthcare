import type { Metadata } from "next";
import Link from "next/link";
import { requireAnyHqCapability, holdsHqCapability } from "@/lib/hq/context";
import { loadGovernanceIndex, type IndexRow } from "@/lib/competency/governance-workspace";
import type { Stage } from "@/lib/competency/governance-rules";

// /super-admin/competencies/governance -- FRAMEWORK-GOVERNANCE-WORKSPACE-01, the landing page, as a TIMELINE per framework
// (owner, 3 Nov 2026): the five governance stages left to right, each with its status and the date and person the records
// hold, so the process reads as a story rather than a table of counts. Admits an author, a clinical reviewer or a
// publisher; each sees the "needs my action" count that concerns them. Nothing is decided here.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Framework governance" };

const CAPABILITIES = ["hq.quality.competency.author", "hq.quality.clinical.approve", "hq.quality.competency.publish"];
const STATUS: Record<string, string> = { draft: "Draft", in_review: "Publication request submitted", approved: "Approved, not published", published: "Published", archived: "Archived" };
const DOT: Record<Stage["status"], string> = { done: "bg-teal-700 border-teal-700", current: "bg-white border-blue-600 ring-4 ring-blue-100", waiting: "bg-amber-400 border-amber-400", blocked: "bg-red-500 border-red-500", not_started: "bg-white border-gray-300" };
const WORD: Record<Stage["status"], string> = { done: "Done", current: "Current", waiting: "Submitted early", blocked: "Blocked", not_started: "Not started" };
const TONE: Record<Stage["status"], string> = { done: "text-teal-900", current: "text-blue-900", waiting: "text-amber-950", blocked: "text-red-900", not_started: "text-gray-500" };
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;

/** What each stage says beneath its status: the date and person from the records, or the count that explains it. */
function detail(r: IndexRow, s: Stage): string[] {
  const m = r.milestones, c = r.counts;
  switch (s.key) {
    case "preparation": return [m.created ? `Created ${when(m.created)}` : "", c.total ? `${c.total} competencies` : "No competency yet", m.forwarded ? `First put forward ${when(m.forwarded)}` : c.ready ? `${c.ready} not yet put forward` : ""].filter(Boolean);
    case "review": return [`${c.approved} of ${c.total} approved`, c.inReview ? `${c.inReview} awaiting review` : "", c.changes ? `${c.changes} returned for changes` : "", m.approved ? `Completed ${when(m.approved)}` : ""].filter(Boolean);
    case "readiness": return [c.total === 0 ? "No competency to approve" : s.status === "done" || s.status === "current" ? "All competencies clinically approved" : `${c.total - c.approved} still need approval`, m.submitted && (s.status === "done") ? `Put forward ${when(m.submitted)}${r.pending?.byName ? ` by ${r.pending.byName}` : ""}` : ""].filter(Boolean);
    case "decision": return [
      r.pending ? `Request submitted ${when(r.pending.submittedAt)}${r.pending.byName ? ` by ${r.pending.byName}` : ""}` : "",
      r.pending && s.status === "waiting" ? "Waits for clinical review to finish" : "",
      m.decided ? `${m.decided.outcome === "published" ? "Published" : "Returned to author"} ${when(m.decided.at)}${m.decided.byName ? ` by ${m.decided.byName}` : ""}` : "",
      !r.pending && !m.decided ? "No request yet" : "",
    ].filter(Boolean);
    case "published": return [m.published ? `Version ${m.published.version ?? r.version} · ${when(m.published.at)}${m.published.byName ? ` · ${m.published.byName}` : ""}` : "Not published"];
  }
}

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
          The governance pathway of each shared framework: preparation, independent clinical review of every competency, readiness, an independent
          publication decision, publication. Dates and names come from the records. Open a workspace to act{me.canReview ? "; your review queue is counted" : ""}.
        </p>
      </header>
      {rows === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">The frameworks could not be read just now. Nothing is shown rather than a partial list.</p>
      ) : rows.length === 0 ? (
        <p className="text-[13.5px] text-gray-700">No shared framework yet. Authors create them in Competency Authoring.</p>
      ) : rows.map(r => (
        <section key={r.id} aria-labelledby={`gi-${r.id}`} className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id={`gi-${r.id}`} className="text-[16px] font-bold text-gray-900">{r.name} <span className="font-mono text-[12px] font-semibold text-gray-500">{r.code ?? "no code"}</span></h2>
              <p className="text-[12.5px] text-gray-600">
                {STATUS[r.pubStatus] ?? r.pubStatus} · version {r.version} · {r.counts.total} competencies · {r.counts.approved} of {r.counts.total} clinically approved
                {r.mine > 0 && <span className="ml-2 rounded-md bg-teal-50 px-2 py-0.5 text-[12px] font-semibold text-teal-900">{r.mine} need{r.mine === 1 ? "s" : ""} your action</span>}
              </p>
            </div>
            <Link href={`/super-admin/competencies/governance/${r.id}`} className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)]">Open workspace →</Link>
          </div>
          <ol className="relative mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label={`${r.name} governance timeline`}>
            <span aria-hidden className="absolute left-3 right-3 top-[7px] hidden h-0.5 bg-gray-200 lg:block" />
            {r.stages.map((s, i) => (
              <li key={s.key} className="relative pl-6 lg:pl-0 lg:pt-5">
                <span aria-hidden className={`absolute left-0 top-0.5 h-4 w-4 rounded-full border-2 lg:left-3 ${DOT[s.status]}`} />
                <p className={`text-[11px] font-bold uppercase tracking-wide ${TONE[s.status]}`}>{i + 1}. {s.label}</p>
                <p className={`text-[12.5px] font-semibold ${TONE[s.status]}`}>{WORD[s.status]}{s.role && s.status !== "done" && s.status !== "not_started" ? ` · ${s.role}` : ""}</p>
                {detail(r, s).map(t => <p key={t} className="text-[12px] text-gray-700">{t}</p>)}
                {s.next && s.status !== "done" && <p className="mt-0.5 text-[12px] font-semibold text-gray-900">Next: {s.next}</p>}
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="text-[12.5px] text-gray-600">
        Specialist pages stay for advanced administration: <Link href="/super-admin/competencies/authoring" className="font-semibold underline">Competency Authoring</Link>,{" "}
        <Link href="/super-admin/clinical-review" className="font-semibold underline">Clinical Review</Link>, <Link href="/super-admin/competencies/publication" className="font-semibold underline">Framework Publication</Link>.
      </p>
    </div>
  );
}
