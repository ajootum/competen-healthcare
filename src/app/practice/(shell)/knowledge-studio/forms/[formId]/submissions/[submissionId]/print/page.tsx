import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getFormSubmission } from "@/lib/practice/forms";
import { letterhead } from "@/lib/practice/document-generation";
import { FORM_CAPABILITIES, FORM_ROUTE, FORM_ANSWER_SWATCH } from "@/lib/practice/form-constants";
import { calculationNotice } from "@/lib/practice/form-field";
import { practiceDayOf, workspaceClock } from "@/lib/practice/practice-time";

// /practice/knowledge-studio/forms/[id]/submissions/[submissionId]/print -- a completed form on paper.
//
// ⚠ NEVER A BLANK BESIDE A QUESTION. Four outcomes print as four different things: the answer, "not
// answered", "did not apply", and -- for a record still open -- a mark saying it is not finished. An
// unanswered question printed as white space reads as "nothing to say here", which on a consent form is
// the most expensive claim this product could accidentally make.
//
// ⚠ A WORKED-OUT ANSWER PRINTS ITS FIGURE AND THE SENTENCE UNDER IT, always. A total that could not use
// two of its five inputs and prints as a bare number is a number somebody will quote.
//
// ⚠ AND THE NOTICE GOES ON THE PAPER, INCLUDING THE PART ABOUT THE SIGNATURE. A completed consent form
// with a patient's name at the top reads to everybody who opens it as evidence that the patient
// consented. It is not, and the footer says so rather than leaving it to be inferred.

export const dynamic = "force-dynamic";

export default async function PrintFormSubmissionPage({ params }: {
  params: Promise<{ formId: string; submissionId: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, FORM_CAPABILITIES.view)) redirect("/practice/home");

  const { formId, submissionId } = await params;
  const admin = createAdminClient();
  // The practice's own day for every date rendered below. These were UTC slices of timestamptz
  // columns, which name yesterday for the three hours a practice ahead of UTC is already on tomorrow.
  const { timezone } = await workspaceClock(admin, shell.ctx.workspaceId);
  const detail = await getFormSubmission(admin, shell.ctx.workspaceId, submissionId);
  if (detail.state !== "ok" || !detail.submission) redirect(`${FORM_ROUTE}/${formId}`);

  const head = await letterhead(admin, shell.ctx.workspaceId);
  const sub = detail.submission;
  const closed = sub.status === "submitted";
  const c = detail.completeness;
  const headingFor = (f: { section: string | null }, i: number, all: { section: string | null }[]) =>
    f.section && f.section !== (all[i - 1]?.section ?? null) ? f.section : null;

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 print:p-0">
      <div className="mb-6 flex items-center gap-3 print:hidden">
        <a href={`${FORM_ROUTE}/${formId}/submissions/${sub.id}`} className="text-[12px] text-gray-500 hover:underline">
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

        <h1 className="mb-1 text-[15px] font-bold">{detail.form?.title ?? "Form"}</h1>
        <p className="mb-1 text-[11px] text-black/60">
          {detail.form?.code} &middot; {detail.form?.kindLabel} &middot; Version {sub.form_version}
          {" "}&middot; {sub.stateLabel}
        </p>
        <p className="mb-3 text-[11px] text-black/70">
          Started {String(sub.started_at).slice(0, 16).replace("T", " ")}
          {sub.startedByName ? ` by ${sub.startedByName}` : ""}
          {sub.context_note ? ` · ${sub.context_note}` : ""}
          {sub.submitted_at ? ` · Submitted ${String(sub.submitted_at).slice(0, 16).replace("T", " ")}${sub.submittedByName ? ` by ${sub.submittedByName}` : ""}` : ""}
          {sub.abandoned_reason ? ` · Abandoned: ${sub.abandoned_reason}` : ""}
        </p>

        <p className="mb-4 border-y border-black/15 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-black/70">
          {detail.notVerified.onPaper}
        </p>

        {/* ⚠ AT THE TOP, BY NAME. A figure that could not use all of its inputs is the thing somebody
            quotes from one of these, and burying the caveat under row nineteen is the same as hiding it. */}
        {c && c.calculated.filter(x => !x.complete || x.problem).length > 0 && (
          <section className="mb-4 border border-black/40 p-2">
            <p className="text-[11.5px] font-bold uppercase tracking-wide">
              Worked-out answers that are not complete
            </p>
            <ul className="mt-1 space-y-0.5">
              {c.calculated.filter(x => !x.complete || x.problem).map(x => (
                <li key={x.field_key} className="text-[11.5px]">
                  {x.label} &mdash; {x.problem ?? calculationNotice(x)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <ol className="space-y-1.5">
          {detail.rendered.map((f, i, all) => {
            const heading = headingFor(f, i, all);
            const mark = FORM_ANSWER_SWATCH[f.state]?.icon ?? "◌";
            return (
              <li key={f.id} className="break-inside-avoid">
                {heading && (
                  <p className="mb-1 mt-3 border-b border-black/10 pb-0.5 text-[11px] font-bold uppercase tracking-wide">
                    {heading}
                  </p>
                )}
                <div className="flex gap-2">
                  <span className="w-5 shrink-0 text-right text-black/50">{i + 1}.</span>
                  <span className="w-4 shrink-0 text-center font-bold" aria-hidden>{mark}</span>
                  <span>
                    <span className={f.state === "did_not_apply" ? "text-black/50" : "font-semibold"}>{f.label}</span>
                    {/* ⚠ FOUR OUTCOMES, FOUR SENTENCES. Never a blank. */}
                    <span className="block text-[11px] text-black/70">
                      {f.state === "answered"
                        ? f.display
                        : f.state === "calculated"
                          ? (f.calculated?.problem
                              ? f.calculated.problem
                              : `${f.calculated ? f.calculated.value : "—"} — ${f.calculated ? calculationNotice(f.calculated) : "nothing was entered for this to work from."}`)
                          : f.state === "did_not_apply"
                            ? `Did not apply${f.withheldBy ? ` — withdrawn by the answer to "${f.withheldBy}"` : ""}, so it was never asked.`
                            : closed
                              ? "Not answered."
                              : "Not answered — this record is not finished."}
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
              Submitted by {sub.submittedByName ?? "the person who completed it"}
              {sub.submitted_at ? ` on ${practiceDayOf(timezone, sub.submitted_at)}` : ""}, recorded in Competen
              Practice. ⚠ This copy carries no handwritten signature, nobody countersigned it, and nothing
              re-checked who was at the keyboard. It records that answers were typed, not that the person
              this form is about agreed to anything.
            </p>
          ) : (
            <p>This record is not finished. It is not a record of a completed form.</p>
          )}
          <p className="mt-1">{detail.notVerified.onPaper}</p>
        </footer>
      </article>
    </div>
  );
}
