import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { reviewQueue } from "@/lib/competency/clinical-review-hq";
import { Decide } from "./_components/ReviewControls";
import { CaseContent } from "./_components/CaseContent";

// /super-admin/clinical-review -- owner decision D2, migration 395. The clinical reviewer's queue.
//
// Guarded by hq.quality.clinical.approve (the Clinical Content Reviewer position). It lists the content
// versions this reviewer may decide now: put forward by someone else, not authored or edited by them, within
// a scope of one of their active reviewer appointments, still current, and not yet decided. The 395 trigger
// enforces the same rules on every decision, so this list is a convenience, not the control.
//
// ⚠ APPROVAL IS NOT PUBLICATION. Approving content here publishes nothing, and publishing a catalogue
// approves nothing. A catalogue shows each competency's clinical state beside it.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clinical review" };

export default async function ClinicalReviewPage() {
  const ctx = await requireHqCapability("hq.quality.clinical.approve");
  const q = await reviewQueue(ctx.admin, ctx.userId);

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings</p>
        <h1 className="text-xl font-bold text-gray-900">Clinical review</h1>
        <p className="mt-1 text-sm text-gray-600">
          Shared clinical content waiting for your independent review. Your approval applies to the exact content shown: if it changes, it
          needs review again. You cannot review content you wrote, edited or put forward.
        </p>
      </header>

      {q === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          The review queue could not be read just now (or migration 395 is not applied on this environment). Nothing is shown rather than a partial list.
        </p>
      ) : q.appointments.length === 0 ? (
        <p className="text-[13.5px] text-gray-700">You hold no active Clinical Content Reviewer appointment, so there is nothing for you to review.</p>
      ) : !q.appointments.some(a => a.scopes.length) ? (
        <p className="text-[13.5px] text-gray-700">Your reviewer appointment has no scope yet. Clinical review governance sets which professions, specialties, frameworks or domains you review.</p>
      ) : q.items.length === 0 ? (
        <p className="text-[13.5px] text-gray-700">Nothing is waiting for you. Content appears here when someone else puts it forward within your scope.</p>
      ) : (
        <ul className="space-y-4">
          {q.items.map(i => (
            <li key={i.versionId} className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-bold text-gray-900">{i.title}</h2>
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-900">{i.approvals} of {i.required} approval{i.required === 1 ? "" : "s"}</span>
              </div>
              <p className="text-[12.5px] text-gray-600">{i.home} · {i.domain}{i.risk ? ` · reviewed at ${i.risk}` : ""} · put forward {new Date(i.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</p>
              {i.kind === "case" ? <div className="mt-3"><p className="mb-2 text-[12.5px] text-gray-600">Clinical case. You are approving every finding, the key, the rationales, the progression and the safety criteria below, for this exact version.</p><CaseContent c={i.caseContent} /></div> : (
              <dl className="mt-3 space-y-2 text-[13.5px]">
                <div><dt className="text-[12px] font-semibold text-gray-500">Description</dt><dd className="text-gray-800">{i.snapshot.description ?? "None recorded"}</dd></div>
                <div><dt className="text-[12px] font-semibold text-gray-500">Learning outcomes</dt><dd className="text-gray-800">{i.snapshot.outcomes.length ? <ul className="list-disc pl-5">{i.snapshot.outcomes.map((o, n) => <li key={n}>{o}</li>)}</ul> : "None recorded"}</dd></div>
                <div><dt className="text-[12px] font-semibold text-gray-500">Skills</dt><dd className="text-gray-800">{i.snapshot.skills.length ? i.snapshot.skills.join(", ") : "None recorded"}</dd></div>
              </dl>)}
              <div className="mt-4 border-t border-gray-100 pt-3"><Decide versionId={i.versionId} appointmentId={i.appointmentId} idPrefix={`v-${i.versionId}`} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
