import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { CASE_LIBRARY_OFF, caseLibraryEnabled, loadCasePolicy } from "@/lib/cases/policy";
import { candidateQueue, classificationOptions, competencyOptions, listCases, type QueueFilters } from "@/lib/cases/studio";
import { CaseContent } from "@/app/super-admin/clinical-review/_components/CaseContent";
import { AiDraft, CandidateActions, CreateCase } from "./_components/CaseControls";
import { input, primary } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";

// /super-admin/cases -- the Educator Case Review Studio (COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s8, C2) and the library
// list (s9, C3). Guarded by hq.quality.case.author (Clinical Case Educator).
//
// ⚠ THE QUEUE IS STORED RECORDS (s8, s14.10): the filters below are query parameters on case_candidate_queue. Opening
// or filtering this page makes no AI call. AI runs only when an educator asks for a draft, on the platform budget.
// ⚠ NO STUDENT IS NAMED: the queue view has no user and no source reference (423).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Case studio" };

const UUIDish = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const when = (t: string) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const STATE: Record<string, string> = { draft: "Draft", submitted: "Submitted (in clinical review, or approved and not published)", published: "Published", superseded: "Superseded", retired: "Retired" };
const BAND = { high: "border-teal-300 bg-teal-50 text-teal-900", medium: "border-amber-300 bg-amber-50 text-amber-900", low: "border-gray-300 bg-gray-50 text-gray-700" } as const;

export default async function CaseStudioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireHqCapability("hq.quality.case.author");
  if (!(await caseLibraryEnabled(ctx.admin))) return <div className="max-w-3xl"><h1 className="text-xl font-bold text-gray-900">Case studio</h1><p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">{CASE_LIBRARY_OFF} It opens when the platform flag case_library is switched on, after migrations 422 and 423 are applied here.</p></div>;
  const sp = await searchParams;
  const policy = await loadCasePolicy(ctx.admin);
  const f: QueueFilters = {
    window: (["24h", "7d", "30d", "custom"].includes(sp.window ?? "") ? sp.window : policy.queueWindow) as QueueFilters["window"],
    from: sp.from ?? null, to: sp.to ?? null,
    status: sp.status === "eligible" || sp.status === "in_development" ? sp.status : null,
    level: ["foundation", "intermediate", "advanced"].includes(sp.level ?? "") ? sp.level! : null,
    risk: sp.risk === "standard" || sp.risk === "high" ? sp.risk : null,
    domainId: UUIDish(sp.domain), cpuId: UUIDish(sp.cpu), specialtyTermId: UUIDish(sp.specialty), professionTermId: UUIDish(sp.profession),
  };
  const [queue, cases, comps, classification] = await Promise.all([candidateQueue(ctx.admin, ctx.userId, f), listCases(ctx.admin), competencyOptions(ctx.admin), classificationOptions(ctx.admin)]);
  const compLabel = new Map(comps.map(c => [c.id, c.label]));

  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Clinical content</p>
        <h1 className="text-xl font-bold text-gray-900">Case studio</h1>
        <p className="mt-1 text-sm text-gray-600">Review de-identified cases students chose to offer, build shared cases, and send them for independent clinical review. You never see who offered a case. Only an approved, published version reaches students.</p>
      </header>

      <section aria-labelledby="queue-h" className="space-y-3">
        <h2 id="queue-h" className="text-[15px] font-bold text-gray-900">Candidate queue</h2>
        <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
          <label className="text-[12.5px] text-gray-700">Offered<select name="window" defaultValue={f.window} className={`${input} ml-1`}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom range</option></select></label>
          <label className="text-[12.5px] text-gray-700">From<input type="date" name="from" defaultValue={sp.from ?? ""} className={`${input} ml-1`} /></label>
          <label className="text-[12.5px] text-gray-700">To<input type="date" name="to" defaultValue={sp.to ?? ""} className={`${input} ml-1`} /></label>
          <label className="text-[12.5px] text-gray-700">Status<select name="status" defaultValue={f.status ?? ""} className={`${input} ml-1`}><option value="">Any</option><option value="eligible">Waiting</option><option value="in_development">In development</option></select></label>
          <label className="text-[12.5px] text-gray-700">Level<select name="level" defaultValue={f.level ?? ""} className={`${input} ml-1`}><option value="">Any</option><option value="foundation">Foundation</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
          <label className="text-[12.5px] text-gray-700">Clinical risk<select name="risk" defaultValue={f.risk ?? ""} className={`${input} ml-1`}><option value="">Any</option><option value="standard">Standard</option><option value="high">High</option></select></label>
          <label className="text-[12.5px] text-gray-700">CFCA domain id<input name="domain" defaultValue={sp.domain ?? ""} className={`${input} ml-1 w-40`} /></label>
          <label className="text-[12.5px] text-gray-700">CPU id<input name="cpu" defaultValue={sp.cpu ?? ""} className={`${input} ml-1 w-40`} /></label>
          <label className="text-[12.5px] text-gray-700">Specialty id<input name="specialty" defaultValue={sp.specialty ?? ""} className={`${input} ml-1 w-40`} /></label>
          <button type="submit" className={primary}>Filter</button>
        </form>
        {queue === null ? (
          <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">The queue could not be read just now (or migration 423 is not applied on this environment). Nothing is shown rather than a partial list.</p>
        ) : f.window === "custom" && !(sp.from && sp.to) ? (
          <p className="text-[13.5px] text-gray-700">Choose both ends of the custom range (at most a year apart).</p>
        ) : queue.length === 0 ? (
          <p className="text-[13.5px] text-gray-700">No candidate case in this window. A case appears here only when a student who allowed it offers one, and it passes the identifier screen.</p>
        ) : (
          <ul className="space-y-3">
            {queue.map(c => (
              <li key={c.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[14.5px] font-bold text-gray-900">{c.title}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${BAND[c.reuse.band]}`}>Reuse potential: {c.reuse.band}</span>
                </div>
                <p className="text-[12.5px] text-gray-600">
                  {c.status === "eligible" ? "Waiting" : c.mine ? "In development by you" : "In development by another educator"} · {c.level ?? "Level not set"} · {c.risk === "high" ? "High clinical risk" : c.risk === "standard" ? "Standard risk" : "Risk not set"} · offered {when(c.offeredAt)} · rests on: {c.attestation === "own_notes" ? "the student's own notes" : "material licensed to share"}
                </p>
                <p className="text-[12.5px] text-gray-600">Why: {c.reuse.reasons.join("; ")}.</p>
                <p className="text-[12.5px] text-gray-600">Teaches: {c.competencyIds.length ? c.competencyIds.map(id => compLabel.get(id) ?? "a competency no longer listed").join("; ") : "no CFCA competency named yet"}</p>
                <details className="mt-2"><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Read the case</summary><div className="mt-2"><CaseContent c={c.snapshot} /></div></details>
                <div className="mt-3 border-t border-gray-100 pt-3"><CandidateActions id={c.id} status={c.status} mine={c.mine} title={c.title} /></div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lib-h" className="space-y-3">
        <h2 id="lib-h" className="text-[15px] font-bold text-gray-900">Case library</h2>
        <div className="rounded-xl border border-gray-200 bg-white p-3"><CreateCase /></div>
        <details className="rounded-xl border border-gray-200 bg-white p-3"><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Draft a case with AI (charged to the platform budget, never to a student)</summary><div className="mt-3"><AiDraft competencies={comps} professions={classification?.professions ?? []} /></div></details>
        {cases === null ? (
          <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">The library could not be read just now.</p>
        ) : cases.length === 0 ? (
          <p className="text-[13.5px] text-gray-700">No case yet. Create one, draft one with AI, or promote a candidate.</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead><tr className="text-[12px] text-gray-500"><th className="py-1">Case</th><th>Latest version</th><th>Published</th><th>Status</th></tr></thead>
            <tbody>{cases.map(c => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="py-2"><Link className="font-semibold text-teal-800 underline" href={`/super-admin/cases/${c.id}`}>{c.code}</Link> {c.title}</td>
                <td>{c.latest ? `v${c.latest.versionNo}: ${STATE[c.latest.state] ?? c.latest.state}` : "None"}</td>
                <td>{c.published ? "Yes" : "No"}</td>
                <td>{c.status === "active" ? "Active" : "Retired"}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
