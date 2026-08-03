import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { reportsDashboard } from "@/lib/practice/document-generation";
import { TEMPLATE_KINDS } from "@/lib/practice/document-constants";
import PeriodPicker from "./PeriodPicker";
import GenerateConsole from "./GenerateConsole";

// /practice/reports -- CPR-330 REPORTS, DOCUMENTS & CORRESPONDENCE.
//
// BUILT TO THE COMP'S LAYOUT, which is the correction CPR-AUDIT-001 recorded: KPI strip, report
// categories, recently generated, quick create, template library, scheduled reports, most used. The
// layout was never in dispute -- what the first attempt got wrong was the SUBJECT (it built analytics,
// which is CPR-270) and the habit of dropping a tile rather than filling its position honestly.
//
// SO TWO TILES RENDER EMPTY, IN PLACE, SAYING WHY. "Time saved by AI" has no AI to save it. That is
// more useful to a reader than a gap where a tile was, because a gap looks like a bug and an empty state
// looks like a decision.

export const dynamic = "force-dynamic";

const KIND_LABEL = Object.fromEntries(TEMPLATE_KINDS.map(([k, l]) => [k, l])) as Record<string, string>;

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  FINAL: "bg-amber-50 text-amber-700",
  SIGNED: "bg-emerald-50 text-emerald-700",
  AMENDED: "bg-blue-50 text-blue-700",
  ENTERED_IN_ERROR: "bg-red-50 text-red-700",
};

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ from?: string; to?: string; days?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "report.view")) redirect("/practice/home");

  const { from, to, days } = await searchParams;
  const admin = createAdminClient();
  const board = await reportsDashboard(admin, shell.ctx, {
    fromDay: from, toDay: to,
    days: days ? Math.min(Math.max(Number(days) || 30, 1), 366) : undefined,
  });
  const canAuthor = hasCapability(shell.ctx, "document.author");

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reports, documents and correspondence</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Letters, certificates and summaries, generated from what is already in the record. {board.period.label}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/practice/reports/analytics"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
            Practice activity
          </Link>
          <Link href="/practice/documents/templates"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
            Templates
          </Link>
        </div>
      </div>

      <PeriodPicker fromDay={board.period.fromDay} toDay={board.period.toDay} />

      {/* ── KPI strip: six tiles, comp order, two of them deliberately empty ── */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {board.kpis.map(k => (
          <div key={k.key} className={`rounded-xl border p-3 ${k.available ? "border-gray-200 bg-white" : "border-dashed border-gray-200 bg-gray-50/60"}`}>
            <p className="text-[11px] font-semibold text-gray-500">{k.label}</p>
            {k.available ? (
              <>
                <p className="mt-1 text-2xl font-bold text-gray-900">{k.value}</p>
                {k.sub && <p className="mt-0.5 text-[10px] text-gray-500">{k.sub}</p>}
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold text-gray-300">&mdash;</p>
                <p className="mt-0.5 text-[10px] text-gray-500">{k.reason}</p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 grid lg:grid-cols-3 gap-4 items-start">
        {/* ── Left: categories, then the template library ── */}
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-bold text-gray-900">Report categories</h2>
              <Link href="/practice/documents/templates" className="text-[11px] text-blue-700 hover:underline">View all</Link>
            </div>
            {board.categories.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">
                No published templates yet. A category appears here once a template exists for it.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {board.categories.map(c => (
                  <li key={c.kind} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <span className="text-[12px] font-semibold text-gray-800">{KIND_LABEL[c.kind] ?? c.kind}</span>
                    <span className="ml-auto text-[11px] text-gray-500">
                      {c.templates} {c.templates === 1 ? "template" : "templates"}
                    </span>
                    {/* Which of them can actually be generated from -- a template with no merge body is
                        a heading and five empty boxes, and saying so here saves finding out later. */}
                    <span className="w-24 text-right text-[10px] text-gray-400">
                      {c.mergeable} with a body
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Most used templates</h2>
            {board.mostUsed.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">Nothing generated from a template in this period.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {board.mostUsed.map(t => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate text-[11px] text-gray-700" title={t.title}>{t.title}</span>
                    {/* A bar drawn to the largest count in the list. It is a count rendered, not a rate --
                        the number stays beside it so nothing is read off a picture. */}
                    <span className="h-1.5 flex-1 rounded bg-gray-100">
                      <span className="block h-1.5 rounded bg-blue-600"
                        style={{ width: `${Math.round((t.total / board.mostUsed[0].total) * 100)}%` }} />
                    </span>
                    <span className="w-6 text-right text-[11px] font-bold text-gray-900">{t.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Middle: recently generated, then schedules and batches ── */}
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-bold text-gray-900">Recently generated</h2>
              <Link href="/practice/documents" className="text-[11px] text-blue-700 hover:underline">View all</Link>
            </div>
            {board.recent.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">No documents yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {board.recent.map(d => (
                  <li key={d.id} className="flex items-center gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <div className="min-w-0">
                      <Link href={`/practice/documents/${d.id}`} className="block truncate text-[12px] font-semibold text-gray-800 hover:underline">
                        {d.title}
                      </Link>
                      <p className="text-[10px] text-gray-500">
                        {/* De-identified when the caller holds report.view without patient.view -- the
                            same rule the access log follows. */}
                        {d.patient ?? (board.identified ? "No patient on the record" : "Patient name hidden")}
                        {" · "}{new Date(d.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[d.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {d.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Scheduled reports</h2>
            {/* THE ONE SENTENCE THIS SECTION MUST NOT LOSE. A schedule that looks automatic and is not
                is worse than no schedule, because nobody checks. */}
            <p className="mt-0.5 text-[11px] text-[var(--cmp-text-critical)]">
              Definitions only. Nothing runs these on its own yet &mdash; each one is a note to yourself
              with a Run now button.
            </p>
            {board.schedules.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">None defined.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {board.schedules.map(s => (
                  <li key={s.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <span className="text-[12px] text-gray-800">{s.name}</span>
                    <span className="ml-auto text-[10px] text-gray-500">{s.cadence}</span>
                    <span className="w-28 text-right text-[10px] text-gray-400">
                      {s.last_run_at ? `last run ${new Date(s.last_run_at).toLocaleDateString()}` : "never run"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {board.batches.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-[13px] font-bold text-gray-900">Recent bulk runs</h2>
              <ul className="mt-2 flex flex-col">
                {board.batches.map(b => (
                  <li key={b.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <span className="text-[12px] text-gray-800">{b.title_pattern}</span>
                    <span className="ml-auto text-[11px] font-bold text-gray-900">{b.generated}</span>
                    <span className="text-[10px] text-gray-500">of {b.requested}</span>
                    {/* A failure count is never rounded away: "40 generated" when 2 failed is the kind
                        of claim somebody relies on without checking. */}
                    {b.failed > 0 && (
                      <span className="w-20 text-right text-[10px] font-semibold text-[var(--cmp-text-critical)]">
                        {b.failed} failed
                      </span>
                    )}
                    {b.failed === 0 && <span className="w-20" />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ── Right: quick create, then the AI slot ── */}
        <div className="flex flex-col gap-4">
          <GenerateConsole
            templates={board.templates}
            canAuthor={canAuthor}
            canFindPatients={hasCapability(shell.ctx, "patient.list")}
          />

          {/* THE COMP'S AI REPORT ASSISTANT, rendered as the empty slot it is. Not a button that does
              nothing -- a panel that says what would go here and which specification owns it. */}
          <section className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4">
            <h2 className="text-[13px] font-bold text-gray-500">AI report assistant</h2>
            <p className="mt-1 text-[11px] text-gray-500">
              Drafting, summarising and language help are specified in CPR-210 AI Clinical Assistant,
              which is not built. Nothing on this page is machine-written.
            </p>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Export</h2>
            <p className="mt-1 text-[11px] text-gray-500">
              A generated document opens with a print view, which is how it becomes a PDF. Word export is
              not built. There is no send &mdash; this product has no email or messaging channel, so a
              copy leaves the practice when somebody records that it did.
            </p>
            <a href={`/api/v1/practice/reports/export?from=${board.period.fromDay}&to=${board.period.toDay}`}
              className="mt-2 inline-block rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Download activity CSV
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
