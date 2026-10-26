"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";

// WHAT SCHOLAR FOUND IN THIS MATERIAL (PRODUCT-EXPERIENCE P6, Option A). Classify runs in the background; this is
// where its result is read, on the material itself: the topics found across sections, and the competency links
// suggested, with each suggestion accepted or rejected through the SAME decision route the sections use
// (/api/individual/scholar/mappings/[id] -- a decision is a new row, never an edit). Nothing here is a judgement of
// competence, and nothing waits on it: the notes are studied the same either way.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const small = `inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-[9px] border px-3 text-[13px] font-semibold disabled:opacity-50 ${focusRing}`;

export type FoundTopicView = { name: string; sections: number; firstChunkId: string };
export type FoundCompetencyView = {
  competencyId: string; title: string; code: string | null; contentStatus: string | null; outcomes: string[];
  sections: number; firstChunkId: string; proposedIds: string[]; accepted: number; rejected: number;
  state: "proposed" | "accepted" | "rejected" | "mixed";
};

const STATE: Record<FoundCompetencyView["state"], { text: string; cls: string }> = {
  proposed: { text: "Suggested", cls: "bg-[#fff3d9] text-[#805a19]" },
  accepted: { text: "Accepted", cls: "bg-[#e9f7f8] text-[#086b7b]" },
  mixed: { text: "Accepted in some sections", cls: "bg-[#e9f7f8] text-[#086b7b]" },
  rejected: { text: "Rejected", cls: "bg-[#eff2f5] text-[#61717e]" },
};
const STATUS: Record<string, string> = { approved: "Clinically approved", draft: "Draft content", unreviewed: "Not yet reviewed" };

export function FoundInMaterial({ topics, competencies, analysed, sections, absence, consent }: {
  topics: FoundTopicView[]; competencies: FoundCompetencyView[]; analysed: number; sections: number;
  /** Why no competency is suggested, when none can be (competencyAbsence). Null when suggestions can be made. */
  absence: string | null; consent: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const waiting = competencies.reduce((n, c) => n + c.proposedIds.length, 0);

  async function decide(c: FoundCompetencyView, decision: "accepted" | "rejected") {
    setBusy(c.competencyId); setError("");
    for (const id of c.proposedIds) {
      const r = await fetch(`/api/individual/scholar/mappings/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) }).catch(() => null);
      if (!r || !r.ok) { setError((await r?.json().catch(() => null))?.error ?? "Your choice could not be saved. Try again."); break; }
    }
    setBusy("");
    router.refresh();
  }

  return (
    <section aria-labelledby="found-h" className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="found-h" className="text-[16px] font-bold text-gray-900">What Scholar found</h2>
        <span className="text-[12.5px] text-gray-600">{analysed} of {sections} section{sections === 1 ? "" : "s"} looked at</span>
      </div>

      {analysed === 0 ? (
        <p className="mt-1.5 text-[14px] text-gray-600">
          Scholar has not looked for topics in this material yet.{" "}
          {consent ? "It starts on its own when you open the material with AI help on, or use “Find topics and competencies” below." : "It looks for them once AI help is on. You can study the material either way."}
        </p>
      ) : (
        <>
          <h3 className="mt-3 text-[13px] font-bold uppercase tracking-[0.12em] text-gray-500">Topics</h3>
          {topics.length === 0 ? <p className="mt-1 text-[14px] text-gray-600">No topics were found in the sections looked at so far.</p> : (
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {topics.slice(0, 16).map(t => (
                <li key={t.name}>
                  <a href={`#c-${t.firstChunkId}`} className={`inline-flex items-center gap-1 rounded-md bg-[#f2f6f7] px-2.5 py-1 text-[12.5px] text-gray-900 hover:bg-[#e9f7f8] ${focusRing}`}>
                    {t.name}{t.sections > 1 && <span className="text-gray-500">· {t.sections}</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-4 text-[13px] font-bold uppercase tracking-[0.12em] text-gray-500">Competency links</h3>
          {absence ? <p className="mt-1 text-[14px] text-gray-600">{absence}</p>
            : competencies.length === 0 ? <p className="mt-1 text-[14px] text-gray-600">No competency of your programme was suggested for the sections looked at so far. You can add a link yourself in any section.</p>
              : (
                <>
                  <p className="mt-1 text-[13.5px] text-gray-600">
                    {waiting ? `${waiting} suggestion${waiting === 1 ? "" : "s"} wait${waiting === 1 ? "s" : ""} for your decision. ` : ""}
                    A suggestion counts towards your progress only once you accept it. Accepting or rejecting here decides it in every section of this material; you can still decide section by section below.
                  </p>
                  <ul className="mt-2 divide-y divide-gray-200">
                    {competencies.map(c => (
                      <li key={c.competencyId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <span className="min-w-0">
                          <span className="block text-[14.5px] font-semibold text-gray-900">{c.code ? `${c.code} ` : ""}{c.title}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-gray-600">
                            <span className={`rounded-full px-2 py-0.5 font-semibold ${STATE[c.state].cls}`}>{STATE[c.state].text}</span>
                            {c.contentStatus && <span>{STATUS[c.contentStatus] ?? c.contentStatus}</span>}
                            <a href={`#c-${c.firstChunkId}`} className={`underline underline-offset-2 ${focusRing}`}>{c.sections} section{c.sections === 1 ? "" : "s"}</a>
                            {c.outcomes.length > 0 && <span>· Outcome: {c.outcomes[0]}{c.outcomes.length > 1 ? ` and ${c.outcomes.length - 1} more` : ""}</span>}
                          </span>
                        </span>
                        {c.proposedIds.length > 0 && (
                          <span className="flex gap-2">
                            <button type="button" className={`${small} border-transparent text-white`} style={{ background: accent }} disabled={!!busy} onClick={() => decide(c, "accepted")}>{busy === c.competencyId ? "Saving…" : "Accept"}</button>
                            <button type="button" className={`${small} border-gray-200 bg-white text-gray-900 hover:bg-gray-50`} disabled={!!busy} onClick={() => decide(c, "rejected")}>Reject</button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
          {error && <p role="alert" className="mt-2 text-[13.5px] font-medium text-red-700">{error}</p>}
          <p className="mt-3 text-[12.5px] text-gray-500">
            Found by AI from your notes and kept for your decision. A link says what your notes are about, not what you can do. See your practice by topic and by competency in{" "}
            <Link href={experienceHref("scholar", "study/progress")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>Progress</Link>.
          </p>
        </>
      )}
    </section>
  );
}
