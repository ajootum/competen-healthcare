import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage } from "../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { countDue, listMaterials, readConsent } from "@/lib/individual/scholar/store";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../_components/chrome";
import StudyNav from "./_components/StudyNav";
import { ConsentPanel, EraseAll, ExplainPanel, UploadPanel } from "./_components/client";

// MY LEARNING -- COMPETEN-IND-004, the Scholar learning journey's home: Upload, and the way into
// Understand, Assess, Revise, Apply and Improve.
//
// What it shows is what exists. Migration 372 not applied → a governed "not set up" state, not an empty
// list. Material unreadable → said so, not "none yet". Consent off → upload and reading still work, and
// every AI action says it needs consent instead of failing when pressed.

export const metadata: Metadata = { title: "My Learning" };

const JOURNEY = [
  { step: "Upload", text: "Add your notes, slides or guidance as PDF or Word." },
  { step: "Understand", text: "Ask about them. Answers cite your pages." },
  { step: "Assess", text: "Practice questions written from a section." },
  { step: "Revise", text: "Anything you miss comes back on a schedule." },
  { step: "Apply", text: "Case questions built from your material." },
  { step: "Improve", text: "See where you are strong and what is due." },
];

export default async function MyLearning({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [materials, consent, due] = await Promise.all([
    listMaterials(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId), countDue(ctx.admin, ctx.userId),
  ]);

  if (!materials.ok && materials.notProvisioned) {
    return (
      <>
        <PageHeader accent={x.accent} eyebrow={x.name} title="My Learning" />
        <StatePanel title="My Learning is not set up on this environment yet">
          <p>The study store it needs has not been installed here, so nothing can be uploaded or read back yet. Nothing on your account has changed.</p>
        </StatePanel>
      </>
    );
  }
  const consentOn = consent.ok && consent.data.granted;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow={x.name} title="My Learning"
        intro="Upload your own study material, have it explained with page citations, practise questions from it and revise what you miss. Everything here is yours alone." />
      <StudyNav dueCount={due} />

      <ol aria-label="How My Learning works" className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {JOURNEY.map((j, i) => (
          <li key={j.step} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-[12px] font-bold tabular-nums" style={{ color: x.accent }}>{i + 1}. {j.step}</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-gray-600">{j.text}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-2">
        <UploadPanel />
        {consent.ok
          ? <ConsentPanel granted={consent.data.granted} grantedAt={consent.data.grantedAt} revokedAt={consent.data.revokedAt} />
          : <Unreadable what="AI consent setting" />}
      </div>

      <section aria-labelledby="materials-h" className="mt-8">
        <h2 id="materials-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Your materials</h2>
        {!materials.ok ? <div className="mt-3"><Unreadable what="study materials" /></div>
          : materials.data.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">
              None yet. Upload a PDF or Word file above to start.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
              {materials.data.map(m => (
                <li key={m.id}>
                  <Link href={experienceHref("scholar", `study/${m.id}`)} className={`flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-gray-50 sm:p-5 ${focusRing}`}>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-gray-900">{m.title}</span>
                      <span className="block text-[12.5px] text-gray-500">
                        {m.mimeType === "application/pdf" ? `PDF · ${m.pageCount} page${m.pageCount === 1 ? "" : "s"}` : "Word document"} · {m.chunkCount} section{m.chunkCount === 1 ? "" : "s"} · added {new Date(m.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </span>
                    <span className="text-[13px] font-semibold" style={{ color: x.accent }}>Open →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </section>

      {materials.ok && materials.data.length > 0 && (
        <div className="mt-8">
          <ExplainPanel consent={consentOn} title="Ask across all your notes"
            hint="Searches every material you have uploaded and answers only from what it finds, citing the page or section. Explanations are not saved." />
        </div>
      )}

      {materials.ok && (
        <div className="mt-8"><EraseAll count={materials.data.length} /></div>
      )}
    </>
  );
}
