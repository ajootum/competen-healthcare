import { redirect } from "next/navigation";
import Link from "next/link";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { practiceHandbook } from "@/lib/practice/handbook";
import { formatDateTime } from "@/lib/datetime";

// /practice/documentation -- the user-facing documentation section.
//
// ⚠ GENERATED FROM THE PRODUCT, NOT WRITTEN BESIDE IT. Every section, every module and every limit below
// is read out of the constants the application itself uses. A folder of prose would be a second
// description of the software, and a second description starts drifting the day after it is written --
// documentation that disagrees with the product is worse than none, because somebody trusts it.
//
// ⚠ THE LIMITS ARE THE POINT, and they are given more room than the features. Seven engines already
// declare in code what they will not claim -- no bed availability, no confidence score, no allergy list
// on the calendar, no cross-practice baseline -- and those declarations answer the question a manual
// never does: not "what can this do" but "what will it never tell me, and what must I therefore keep
// doing myself". A clinician deciding whether to trust a screen at 08:00 is better served by one honest
// limit than by three paragraphs of features.
//
// NO DATABASE READ. Help should be the one screen that still works when everything else is unreadable.

export const dynamic = "force-dynamic";

export default async function DocumentationPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");

  const book = practiceHandbook(shell.ctx.capabilities);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-gray-900">Documentation</h1>
      <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-gray-500">
        What each part of Competen Practice is for, and — more usefully — what it will not tell you.
        This page is generated from the product itself, so it cannot describe a version that no longer
        exists.
      </p>

      {/* ── WHAT THIS PRODUCT WILL NOT DO ─────────────────────────────────────────────────────────── */}
      {/* First, deliberately. A practitioner arrives here because something did not appear, and the
          answer is far more often "it never will" than "you clicked the wrong thing". */}
      <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/50 p-4" aria-labelledby="limits">
        <h2 id="limits" className="text-[13px] font-bold text-amber-900">
          What this product will not tell you ({book.allLimits.length})
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-amber-800">
          Each of these is a claim the software refuses to make, declared in its own code rather than
          decided here. Where a limit exists, the work it describes is still yours.
        </p>
        <ul className="mt-3 space-y-2.5">
          {book.allLimits.map(l => (
            <li key={l.key}>
              <p className="text-[12.5px] font-semibold text-amber-900">{l.label}</p>
              {l.detail && l.detail !== l.label && (
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-amber-800/90">{l.detail}</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ── THE SECTIONS, IN THE ORDER THE SIDEBAR DRAWS THEM ─────────────────────────────────────── */}
      {book.sections.map(sec => (
        <section key={sec.label} className="mt-6" aria-labelledby={`s-${sec.label}`}>
          <h2 id={`s-${sec.label}`} className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
            {sec.label}
          </h2>
          <div className="mt-2 space-y-3">
            {sec.entries.map(e => (
              <div key={e.href} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link href={e.href} className="text-[14px] font-bold text-gray-900 hover:text-[var(--cp-primary)]">
                    {e.title} →
                  </Link>
                  {/* NAMED, because "why can I not see this" is the second most common question about
                      any workspace, and the answer is almost always a capability somebody else holds. */}
                  {e.capability && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-gray-500">
                      needs {e.capability}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-600">{e.purpose}</p>

                {e.contains.length > 0 && (
                  <p className="mt-2 text-[11.5px] text-gray-500">
                    Inside it:{" "}
                    {e.contains.map((c, i) => (
                      <span key={c.href}>
                        {i > 0 && " · "}
                        <Link href={c.href} className="text-[var(--cp-primary)] hover:underline">{c.title}</Link>
                      </span>
                    ))}
                  </p>
                )}

                {e.limits.length > 0 && (
                  <ul className="mt-2.5 space-y-1 border-t border-gray-100 pt-2">
                    {e.limits.map(l => (
                      <li key={l.key} className="flex items-start gap-2 text-[11.5px] leading-snug text-gray-600">
                        <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                        <span><span className="font-semibold">Will not:</span> {l.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* ── WHAT YOU CANNOT OPEN ──────────────────────────────────────────────────────────────────── */}
      {/* Documented anyway. "What am I missing" is a fair question, and hiding the answer is how a locum
          concludes the product is broken rather than that they hold fewer permissions. */}
      {book.hiddenFromYou.length > 0 && (
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Sections you do not have access to</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
            {book.hiddenFromYou.join(", ")}. These exist and are documented above; your account does not
            hold the capability each one needs. Whoever manages your practice can grant it.
          </p>
        </section>
      )}

      <p className="mt-6 text-[10.5px] text-gray-400">
        Generated from this build at {formatDateTime(book.generatedAt)}. Nothing on this page is written
        by hand except one sentence describing each section; the limits and the module lists are read
        from the software.
      </p>
    </div>
  );
}
