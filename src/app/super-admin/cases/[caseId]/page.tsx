import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { DEFAULT_DIMENSIONS, validateBlueprint } from "@/lib/cases/blueprint";
import { CASE_LIBRARY_OFF, caseLibraryEnabled } from "@/lib/cases/policy";
import { caseDetail, classificationOptions, competencyOptions, type ClinicalCaseState } from "@/lib/cases/studio";
import { CaseContent } from "@/app/super-admin/clinical-review/_components/CaseContent";
import { CaseEditor } from "../_components/CaseEditor";
import { VersionActions } from "../_components/CaseControls";

// /super-admin/cases/[caseId] -- one case: its versions and their clinical state, the draft editor, and the audit
// history (s8 item 10). Guarded by hq.quality.case.author. Publication is on /super-admin/cases/publication.
//
// ⚠ APPROVED MEANS THE 395 RECORD SAYS SO, for this exact version. A submitted version is frozen: changing it means a
// new draft, which needs its own approval.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Case" };

const CLINICAL: Record<ClinicalCaseState, string> = {
  draft: "Draft: not reviewed", in_review: "In clinical review", changes_requested: "Clinical reviewer asked for changes",
  approved: "Clinically approved, not yet published", published: "Published (clinically approved)", superseded: "Superseded by a newer published version", retired: "Retired",
};
const day = (t: string | null) => (t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Not yet");

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const ctx = await requireHqCapability("hq.quality.case.author");
  if (!(await caseLibraryEnabled(ctx.admin))) return <div className="max-w-3xl"><h1 className="text-xl font-bold text-gray-900">Case</h1><p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">{CASE_LIBRARY_OFF} It opens when the platform flag case_library is switched on, after migrations 422 and 423 are applied here.</p></div>;
  const { caseId } = await params;
  const [d, comps, classes] = await Promise.all([caseDetail(ctx.admin, caseId), competencyOptions(ctx.admin), classificationOptions(ctx.admin)]);
  if (!d) notFound();
  const draft = d.versions.find(v => v.state === "draft");
  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px]"><Link href="/super-admin/cases" className="text-teal-800 underline">Case studio</Link></p>
        <h1 className="text-xl font-bold text-gray-900">{d.case.code}: {d.case.title}</h1>
        <p className="text-sm text-gray-600">{d.case.status === "active" ? "Active" : "Retired: no longer offered"} · {d.versions.length} version{d.versions.length === 1 ? "" : "s"}</p>
      </header>

      <section aria-labelledby="v-h">
        <h2 id="v-h" className="text-[15px] font-bold text-gray-900">Versions</h2>
        <ul className="mt-2 space-y-3">
          {d.versions.map(v => (
            <li key={v.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-bold text-gray-900">Version {v.versionNo}: {v.title}</h3>
                <span className="rounded-full border border-gray-300 px-2 py-0.5 text-[11.5px] font-semibold text-gray-800">{CLINICAL[v.clinical]}{v.required !== null && (v.clinical === "in_review" || v.clinical === "approved") ? ` · ${v.approvals} of ${v.required}` : ""}</span>
              </div>
              <p className="text-[12.5px] text-gray-600">From: {v.origin === "candidate" ? "a student-offered candidate" : v.origin} · {v.authors} author{v.authors === 1 ? "" : "s"} · submitted {day(v.submittedAt)} · published {day(v.publishedAt)} · {v.level} · {v.risk} risk</p>
              {v.comments.length ? <ul className="mt-2 space-y-1 text-[13px]">{v.comments.map((c, i) => <li key={i} className={c.decision === "rejected" ? "text-[var(--cmp-text-critical)]" : "text-gray-800"}>{c.decision === "rejected" ? "Changes requested" : "Approved"} {day(c.at)}{c.comment ? `: ${c.comment}` : ""}</li>)}</ul> : null}
              {v.state !== "draft" && <details className="mt-2"><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Read this version</summary><div className="mt-2"><CaseContent c={d.contentOf[v.id]} /></div></details>}
              <div className="mt-3 border-t border-gray-100 pt-3"><VersionActions caseId={d.case.id} versionId={v.id} state={v.state} clinical={v.clinical} canPublish={false} hasDraft={!!draft} /></div>
            </li>
          ))}
        </ul>
      </section>

      {draft && (
        <section aria-labelledby="ed-h">
          <h2 id="ed-h" className="text-[15px] font-bold text-gray-900">Edit the draft (version {draft.versionNo})</h2>
          <p className="text-[12.5px] text-gray-600">Saving makes you one of this draft&apos;s authors, so you will not be able to approve it.</p>
          <div className="mt-2"><CaseEditor versionId={draft.id} initial={d.contentOf[draft.id]} competencies={comps} dimensions={[...DEFAULT_DIMENSIONS]} initialProblems={validateBlueprint(d.contentOf[draft.id], "library")} classification={classes} /></div>
        </section>
      )}

      <section aria-labelledby="a-h">
        <h2 id="a-h" className="text-[15px] font-bold text-gray-900">Audit history</h2>
        {d.audit.length ? <ul className="mt-2 space-y-1 text-[13px] text-gray-800">{d.audit.map((a, i) => <li key={i}>{day(a.at)} · {a.actor ?? "Unknown actor"} · {a.action.replace(/^case_/, "").replace(/_/g, " ")}</li>)}</ul> : <p className="text-[13px] text-gray-700">No recorded action yet.</p>}
      </section>
    </div>
  );
}
