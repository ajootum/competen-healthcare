import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { CASE_LIBRARY_OFF, caseLibraryEnabled, loadCasePolicy } from "@/lib/cases/policy";
import { caseDetail, listCases } from "@/lib/cases/studio";
import { CasePolicyEditor, RetireCase, VersionActions } from "../_components/CaseControls";

// /super-admin/cases/publication -- C3 publication, a separate governed act (s9), and the case policy (s13).
// Guarded by hq.quality.case.publish (Quality Council Member).
//
// ⚠ ONLY AN APPROVED VERSION IS PUBLISHABLE, and the database checks again: case_library_publish refuses a version
// without an approved 395 record of its exact hash. Publishing approves nothing. Approving publishes nothing.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Case publication" };

export default async function CasePublicationPage() {
  const ctx = await requireHqCapability("hq.quality.case.publish");
  if (!(await caseLibraryEnabled(ctx.admin))) return <div className="max-w-3xl"><h1 className="text-xl font-bold text-gray-900">Case publication</h1><p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">{CASE_LIBRARY_OFF} It opens when the platform flag case_library is switched on, after migrations 422 and 423 are applied here.</p></div>;
  const [cases, policy] = await Promise.all([listCases(ctx.admin), loadCasePolicy(ctx.admin)]);
  const details = cases ? await Promise.all(cases.filter(c => c.status === "active").map(c => caseDetail(ctx.admin, c.id))) : [];
  const ready = details.flatMap(d => (d ? d.versions.filter(v => v.clinical === "approved").map(v => ({ d, v })) : []));
  const live = details.flatMap(d => (d ? d.versions.filter(v => v.state === "published").map(v => ({ d, v })) : []));
  return (
    <div className="max-w-4xl space-y-8">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Clinical content</p>
        <h1 className="text-xl font-bold text-gray-900">Case publication</h1>
        <p className="mt-1 text-sm text-gray-600">Publish clinically approved case versions to the shared library, retire cases, and set the case policy.</p>
      </header>
      {cases === null && <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">The library could not be read just now.</p>}
      <section aria-labelledby="ready-h">
        <h2 id="ready-h" className="text-[15px] font-bold text-gray-900">Approved, waiting to be published ({ready.length})</h2>
        {ready.length ? <ul className="mt-2 space-y-3">{ready.map(({ d, v }) => (
          <li key={v.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="font-semibold text-gray-900"><Link className="text-teal-800 underline" href={`/super-admin/cases/${d.case.id}`}>{d.case.code}</Link> version {v.versionNo}: {v.title}</p>
            <p className="text-[12.5px] text-gray-600">{v.approvals} of {v.required} independent approval{v.required === 1 ? "" : "s"} for this exact version.</p>
            <div className="mt-2"><VersionActions caseId={d.case.id} versionId={v.id} state={v.state} clinical={v.clinical} canPublish hasDraft /></div>
          </li>))}</ul> : <p className="mt-1 text-[13.5px] text-gray-700">Nothing is waiting. A version appears here once its independent clinical approval is complete.</p>}
      </section>
      <section aria-labelledby="live-h">
        <h2 id="live-h" className="text-[15px] font-bold text-gray-900">Published ({live.length})</h2>
        {live.length ? <ul className="mt-2 space-y-2">{live.map(({ d, v }) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3">
            <span><Link className="font-semibold text-teal-800 underline" href={`/super-admin/cases/${d.case.id}`}>{d.case.code}</Link> version {v.versionNo}: {v.title}</span>
            <RetireCase caseId={d.case.id} />
          </li>))}</ul> : <p className="mt-1 text-[13.5px] text-gray-700">No case is published yet.</p>}
      </section>
      <section aria-labelledby="pol-h" className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="pol-h" className="text-[15px] font-bold text-gray-900">Case policy</h2>
        <p className="mb-3 text-[12.5px] text-gray-600">Versioned and audited. It tunes the queue, retention and delivery. It cannot open any boundary: the permission, the identifier screen and clinical approval are enforced by the database. Approval counts are set in clinical review governance.</p>
        <CasePolicyEditor initial={policy} />
      </section>
    </div>
  );
}
