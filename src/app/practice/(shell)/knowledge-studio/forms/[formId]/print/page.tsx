import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getForm } from "@/lib/practice/forms";
import { letterhead } from "@/lib/practice/document-generation";
import { FORM_CAPABILITIES, FORM_ROUTE, FORM_TYPE_NOT_OFFERED } from "@/lib/practice/form-constants";
import { fieldType, fieldOptions, fieldRules } from "@/lib/practice/form-field";

// /practice/knowledge-studio/forms/[id]/print -- a blank form on paper.
//
// ⚠ A FORM THAT IS NOT IN USE PRINTS MARKED. A draft pinned to a wall is the version people follow, and
// somebody who prints one has no way afterwards to tell it from the approved one.
//
// ⚠ EVERY QUESTION PRINTS ITS RULES AND ITS CONDITION. A paper copy that hides "only asked when the
// answer above was yes" produces a filled-in sheet nobody can key in, and a paper copy that hides the
// range produces answers the screen will refuse.
//
// ⚠ AND THE NOTICE GOES ON THE PAPER. A reader of a printed form cannot see the screen's banner, and on
// a consent form it is the sentence that matters most.

export const dynamic = "force-dynamic";

export default async function PrintFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, FORM_CAPABILITIES.view)) redirect("/practice/home");

  const { formId } = await params;
  const admin = createAdminClient();
  const detail = await getForm(admin, shell.ctx.workspaceId, formId);
  if (detail.state !== "ok" || !detail.form) redirect(FORM_ROUTE);

  const head = await letterhead(admin, shell.ctx.workspaceId);
  const doc = detail.form;
  const inUse = doc.status === "published";
  const byKey = new Map(detail.fields.map(f => [f.field_key, f]));
  const headingFor = (f: { section: string | null }, i: number, all: { section: string | null }[]) =>
    f.section && f.section !== (all[i - 1]?.section ?? null) ? f.section : null;

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 print:p-0">
      <div className="mb-6 flex items-center gap-3 print:hidden">
        <a href={`${FORM_ROUTE}/${doc.id}`} className="text-[12px] text-gray-500 hover:underline">
          &larr; Back to the form
        </a>
        <p className="ml-auto text-[11px] text-gray-500">
          Use your browser&rsquo;s print dialog and choose &ldquo;Save as PDF&rdquo;.
        </p>
      </div>

      <article className="relative text-[12px] leading-relaxed text-black">
        {!inUse && (
          <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rotate-[-30deg] text-center text-[48px] font-black leading-none tracking-widest text-black/10">
              NOT IN USE
            </span>
          </span>
        )}

        {head && (
          <header className="mb-6 whitespace-pre-line border-b border-black/20 pb-3 text-center text-[11px]">
            {head}
          </header>
        )}

        <h1 className="mb-1 text-[15px] font-bold">{doc.title}</h1>
        <p className="mb-1 text-[11px] text-black/60">
          {doc.code} &middot; {doc.kindLabel} &middot; Version {doc.version} &middot; {doc.stateLabel}
          {doc.effective_from ? ` · In use from ${doc.effective_from}` : ""}
          {doc.review_on ? ` · Review by ${doc.review_on}` : ""}
        </p>
        {doc.purpose && <p className="mb-3 text-[11.5px] text-black/70">{doc.purpose}</p>}

        <p className="mb-4 border-y border-black/15 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-black/70">
          {detail.notVerified.onPaper}
        </p>

        {doc.subject === "patient" ? (
          <p className="mb-4 border border-black/25 p-2 text-[11.5px]">
            Patient: <span className="inline-block w-[60%] border-b border-dotted border-black/50">&nbsp;</span>
            <span className="mt-1 block text-[10.5px] text-black/60">
              This form is about one patient. A completed one entered into Competen Practice names them.
            </span>
          </p>
        ) : (
          <p className="mb-4 text-[10.5px] text-black/60">
            This form is not about a patient, and no patient is recorded on it.
          </p>
        )}

        <ol className="space-y-2.5">
          {detail.fields.map((f, i, all) => {
            const heading = headingFor(f, i, all);
            const type = fieldType(f.field_type);
            const rules = fieldRules(f);
            const options = fieldOptions(f);
            const when = f.condition && typeof f.condition === "object"
              ? (f.condition as Record<string, unknown>).when : null;
            const source = typeof when === "string" ? byKey.get(when) ?? null : null;
            return (
              <li key={f.id} className="break-inside-avoid">
                {heading && (
                  <p className="mb-1 mt-3 border-b border-black/10 pb-0.5 text-[11px] font-bold uppercase tracking-wide">
                    {heading}
                  </p>
                )}
                <div className="flex gap-2">
                  <span className="w-5 shrink-0 text-right text-black/50">{i + 1}.</span>
                  <span className="w-full">
                    <span className="font-semibold">{f.label}</span>
                    {f.required !== false && type?.valueKind !== "derived" && (
                      <span className="ml-1 font-bold" aria-hidden>*</span>
                    )}
                    {f.help && <span className="block text-[11px] text-black/60">{f.help}</span>}

                    {/* ⚠ THE CONDITION, ON PAPER. Otherwise a paper copy asks everybody everything. */}
                    {typeof when === "string" && (
                      <span className="block text-[11px] italic text-black/60">
                        Only asked when &ldquo;{source ? source.label : when}&rdquo; is answered as required.
                      </span>
                    )}

                    {/* ⚠ AND THE RULES, so an answer written on paper is one the screen will accept. */}
                    {(rules.min !== undefined || rules.max !== undefined) && (
                      <span className="block text-[11px] text-black/60">
                        {rules.min !== undefined && rules.max !== undefined
                          ? `Between ${rules.min} and ${rules.max}.`
                          : rules.min !== undefined ? `${rules.min} or more.` : `${rules.max} or less.`}
                      </span>
                    )}
                    {(rules.earliest || rules.latest) && (
                      <span className="block text-[11px] text-black/60">
                        {rules.earliest && rules.latest ? `Between ${rules.earliest} and ${rules.latest}.`
                          : rules.earliest ? `Not before ${rules.earliest}.` : `Not after ${rules.latest}.`}
                      </span>
                    )}

                    {type?.valueKind === "derived" ? (
                      <span className="mt-1 block border border-black/25 px-2 py-1 text-[11px] text-black/60">
                        Worked out from other answers on this form. It is not entered by hand, and nothing
                        on paper works it out &mdash; the figure appears when the answers are entered into
                        Competen Practice.
                      </span>
                    ) : options.length > 0 ? (
                      <span className="mt-1 block text-[11.5px]">
                        {options.map(o => (
                          <span key={o.value} className="mr-4 inline-block">
                            <span className="mr-1 inline-block h-3 w-3 border border-black/60 align-middle" aria-hidden />
                            {o.label}
                          </span>
                        ))}
                      </span>
                    ) : f.field_type === "boolean" ? (
                      <span className="mt-1 block text-[11.5px]">
                        <span className="mr-1 inline-block h-3 w-3 border border-black/60 align-middle" aria-hidden />
                        Yes
                      </span>
                    ) : f.field_type === "long_text" ? (
                      <span className="mt-1 block h-14 border-b border-dotted border-black/40" />
                    ) : (
                      <span className="mt-1 block h-5 border-b border-dotted border-black/40" />
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>

        {detail.fields.length === 0 && (
          <p className="border border-dashed border-black/30 p-4 text-center text-[11.5px]">
            This form has no questions on it yet, so there is nothing to print.
          </p>
        )}

        <footer className="mt-8 border-t border-black/20 pt-3 text-[10.5px] text-black/70">
          <p>
            A blank copy of {doc.code} version {doc.version}
            {inUse ? "" : `, which is ${String(doc.stateLabel).toLowerCase()} and is not the version in use`}.
            {" "}Answers written on paper are not in Competen Practice until somebody enters them.
          </p>
          <p className="mt-1">{detail.notVerified.onPaper}</p>
          <p className="mt-1 text-black/50">
            This is not {FORM_TYPE_NOT_OFFERED.label.toLowerCase()} &mdash; the patient registration form is
            a different form in this product.
          </p>
        </footer>
      </article>
    </div>
  );
}
