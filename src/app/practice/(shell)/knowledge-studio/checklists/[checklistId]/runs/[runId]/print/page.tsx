import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getChecklistRun } from "@/lib/practice/checklist";
import { letterhead } from "@/lib/practice/document-generation";
import {
  CHECKLIST_CAPABILITIES, CHECKLIST_ROUTE, CHECKLIST_RESPONSE_SWATCH, checklistResponse,
} from "@/lib/practice/checklist-constants";

// /practice/knowledge-studio/checklists/[id]/runs/[runId]/print -- the completion record on paper.
//
// ⚠ NEVER A BLANK BESIDE AN ITEM. Four outcomes print as four different things: an answer, "not
// answered", "did not apply", and -- for a record still open -- a mark saying the record is not
// finished. An unanswered item printed as white space reads as "nothing to say here", which on a safety
// checklist is the most expensive claim this product could accidentally make.
//
// ⚠ CRITICAL ITEMS RECORDED AS NOT DONE ARE PRINTED AT THE TOP, BY NAME. It is the single thing anybody
// would ever come looking for in one of these, and burying it in row nineteen is the same as hiding it.
//
// ⚠ AND THE NOTICE GOES ON THE PAPER. A reader of a printed record cannot see the screen's banner.

export const dynamic = "force-dynamic";

export default async function PrintChecklistRunPage({ params }: {
  params: Promise<{ checklistId: string; runId: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, CHECKLIST_CAPABILITIES.view)) redirect("/practice/home");

  const { checklistId, runId } = await params;
  const admin = createAdminClient();
  const detail = await getChecklistRun(admin, shell.ctx.workspaceId, runId);
  if (detail.state !== "ok" || !detail.run) redirect(`${CHECKLIST_ROUTE}/${checklistId}`);

  const head = await letterhead(admin, shell.ctx.workspaceId);
  const run = detail.run;
  const closed = run.status === "completed";
  const c = detail.completeness;
  // Read off the PREVIOUS ROW rather than carried in a mutable variable -- reassigning during a render
  // is an error in this project's lint, and rightly: a second render would start where the first ended.
  const headingFor = (item: { section: string | null }, i: number, all: { section: string | null }[]) =>
    item.section && item.section !== (all[i - 1]?.section ?? null) ? item.section : null;

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 print:p-0">
      <div className="mb-6 flex items-center gap-3 print:hidden">
        <a href={`${CHECKLIST_ROUTE}/${checklistId}/runs/${run.id}`} className="text-[12px] text-gray-500 hover:underline">
          &larr; Back to the record
        </a>
        <p className="ml-auto text-[11px] text-gray-500">
          Use your browser&rsquo;s print dialog and choose &ldquo;Save as PDF&rdquo;.
        </p>
      </div>

      <article className="relative text-[12px] leading-relaxed text-black">
        {!closed && (
          <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rotate-[-30deg] text-center text-[48px] font-black leading-none tracking-widest text-black/10">
              NOT FINISHED
            </span>
          </span>
        )}

        {head && (
          <header className="mb-6 whitespace-pre-line border-b border-black/20 pb-3 text-center text-[11px]">
            {head}
          </header>
        )}

        <h1 className="mb-1 text-[15px] font-bold">{detail.checklist?.title ?? "Checklist"}</h1>
        <p className="mb-1 text-[11px] text-black/60">
          {detail.checklist?.code} &middot; {detail.checklist?.kindLabel} &middot; Version {run.checklist_version}
          {" "}&middot; {run.stateLabel}
        </p>
        <p className="mb-3 text-[11px] text-black/70">
          Started {String(run.started_at).slice(0, 16).replace("T", " ")}
          {run.startedByName ? ` by ${run.startedByName}` : ""}
          {run.context_note ? ` · ${run.context_note}` : ""}
          {run.completed_at ? ` · Closed ${String(run.completed_at).slice(0, 16).replace("T", " ")}${run.completedByName ? ` by ${run.completedByName}` : ""}` : ""}
          {run.abandoned_reason ? ` · Abandoned: ${run.abandoned_reason}` : ""}
        </p>

        <p className="mb-4 border-y border-black/15 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-black/70">
          {detail.notVerified.onPaper}
        </p>

        {/* ⚠ AT THE TOP, BY NAME. */}
        {c && c.criticalNotDone.length > 0 && (
          <section className="mb-4 border border-black/40 p-2">
            <p className="text-[11.5px] font-bold uppercase tracking-wide">
              Critical items recorded as not done
            </p>
            <ul className="mt-1 space-y-0.5">
              {c.criticalNotDone.map(i => (
                <li key={i.id} className="text-[11.5px]">{i.label}{i.note ? ` — ${i.note}` : " — no reason was recorded"}</li>
              ))}
            </ul>
          </section>
        )}

        <ol className="space-y-1.5">
          {detail.rendered.map((item, i, all) => {
            const heading = headingFor(item, i, all);
            const label = checklistResponse(item.state)?.label ?? null;
            const mark = CHECKLIST_RESPONSE_SWATCH[item.state]?.icon ?? "◌";
            return (
              <li key={item.id} className="break-inside-avoid">
                {heading && (
                  <p className="mb-1 mt-3 border-b border-black/10 pb-0.5 text-[11px] font-bold uppercase tracking-wide">
                    {heading}
                  </p>
                )}
                <div className="flex gap-2">
                  <span className="w-5 shrink-0 text-right text-black/50">{i + 1}.</span>
                  <span className="w-4 shrink-0 text-center font-bold" aria-hidden>{mark}</span>
                  <span>
                    <span className={item.state === "did_not_apply" ? "text-black/50" : "font-semibold"}>{item.label}</span>
                    {item.is_critical && <span className="ml-1.5 text-[10px] font-bold uppercase">critical</span>}
                    {/* ⚠ FOUR OUTCOMES, FOUR SENTENCES. Never a blank. */}
                    <span className="block text-[11px] text-black/70">
                      {label
                        ? label
                        : item.state === "did_not_apply"
                          ? `Did not apply${item.withheldBy ? ` — withdrawn by the answer to "${item.withheldBy}"` : ""}, so it was never asked.`
                          : closed
                            ? "Not answered."
                            : "Not answered — this record is not finished."}
                      {item.note ? ` — ${item.note}` : ""}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>

        <footer className="mt-8 border-t border-black/20 pt-3 text-[10.5px] text-black/70">
          {closed ? (
            <p>
              Closed by {run.completedByName ?? "the person who completed it"}
              {run.completed_at ? ` on ${String(run.completed_at).slice(0, 10)}` : ""}, recorded in
              Competen Practice. This copy carries no handwritten signature, and no second person
              countersigned it.
            </p>
          ) : (
            <p>This record is not finished. It is not a record of a completed checklist.</p>
          )}
          <p className="mt-1">{detail.notVerified.onPaper}</p>
        </footer>
      </article>
    </div>
  );
}
