import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { reviewQueue } from "@/lib/competency/clinical-review-hq";
import { Decide } from "./_components/ReviewControls";
import { CaseContent } from "./_components/CaseContent";
import { MethodContent } from "./_components/MethodContent";
import { CriteriaList } from "../competencies/_studio/CriteriaList";
import { ReviewPackView } from "../competencies/_studio/ReviewPackView";
import { checksFor, loadReviewerPack } from "@/lib/competency/review-pack";
import { ApproveFramework, type ApproveItem } from "./_components/ApproveFramework";

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

export default async function ClinicalReviewPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireHqCapability("hq.quality.clinical.approve");
  // The paper copy of exactly this queue (owner, 29 Oct 2026). Notes on paper; decisions recorded here.
  if ((await searchParams).view === "pack") {
    const pack = await loadReviewerPack(ctx.admin, { id: ctx.userId, name: ctx.fullName ?? null });
    return pack ? <ReviewPackView pack={pack} back={{ href: "/super-admin/clinical-review", label: "Clinical review" }} wordHref="/api/hq/clinical-review/pack" />
      : <p role="alert" className="text-[13.5px] text-[var(--cmp-text-critical)]">Your review queue could not be read just now.</p>;
  }
  const [q, comps] = await Promise.all([reviewQueue(ctx.admin, ctx.userId), ctx.admin.from("competency_assessment_component").select("code, label").order("sort_order")]);
  const components: Record<string, string> = Object.fromEntries(((comps.data ?? []) as { code: string; label: string }[]).map(c => [c.code, c.label]));
  // Method items (690) name scale levels by id. Read only when one is waiting; a failed read shows "no longer listed", never a guess.
  const levels: Record<string, string> = {}, scales: Record<string, string> = {};
  if (q?.items.some(i => i.kind === "method")) {
    const [lv, sc] = await Promise.all([ctx.admin.from("scoring_levels").select("id, score, label").order("score"), ctx.admin.from("scoring_scales").select("id, name")]);
    for (const l of (lv.data ?? []) as { id: string; score: number; label: string }[]) levels[l.id] = `${l.score} · ${l.label}`;
    for (const x of (sc.data ?? []) as { id: string; name: string }[]) scales[x.id] = x.name;
  }
  // Framework-level approval: the waiting competencies grouped by framework, each with its version and points worth checking.
  const byFramework = q ? [...q.items.filter(i => i.kind === "competency").reduce((m, i) => m.set(i.home, [...(m.get(i.home) ?? []), {
    versionId: i.versionId, competencyId: i.competencyId, title: i.title, domain: i.domain, version: i.versionId.slice(0, 8),
    criteria: i.criteria?.length ?? i.snapshot.skills.length, checks: checksFor(i.criteria ?? [], components) }]), new Map<string, ApproveItem[]>())]
    .map(([framework, items]) => ({ framework, items })).filter(g => g.items.length > 1) : [];

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings</p>
        <h1 className="text-xl font-bold text-gray-900">Clinical review</h1>
        <p className="mt-1 text-sm text-gray-600">
          Shared clinical content waiting for your independent review. Your approval applies to the exact content shown: if it changes, it
          needs review again. You cannot review content you wrote, edited or put forward.
        </p>
        {q && q.items.length > 0 && <p className="mt-2"><a href="?view=pack" className="text-[13px] font-semibold text-teal-800 underline">Review pack for paper review (print, PDF or Word) →</a></p>}
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
        <>
        {byFramework.length > 0 && (
          <section aria-labelledby="fw-approve-h" className="rounded-xl border border-teal-200 bg-teal-50/40 p-4">
            <h2 id="fw-approve-h" className="text-[14px] font-bold text-gray-900">Review a whole framework</h2>
            <p className="mt-1 text-[12.5px] text-gray-600">Approve every competency you have reviewed in a framework at once. Each still gets its own decision at its exact version, so every criterion stays traceable. Ask for changes on any competency individually below.</p>
            <ul className="mt-2 space-y-2">{byFramework.map(g => (
              <li key={g.framework} className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13.5px] text-gray-900">{g.framework} <span className="text-gray-500">· {g.items.length} waiting</span></span><ApproveFramework framework={g.framework} items={g.items} /></li>
            ))}</ul>
          </section>
        )}
        <ul className="space-y-4">
          {q.items.map(i => (
            <li key={i.versionId} className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-bold text-gray-900">{i.title}</h2>
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-900">{i.approvals} of {i.required} approval{i.required === 1 ? "" : "s"}</span>
              </div>
              <p className="text-[12.5px] text-gray-600">{i.home} · {i.domain}{i.risk ? ` · reviewed at ${i.risk}` : ""} · put forward {new Date(i.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</p>
              {i.kind === "case" ? <div className="mt-3"><p className="mb-2 text-[12.5px] text-gray-600">Clinical case. You are approving every finding, the key, the rationales, the progression and the safety criteria below, for this exact version.</p><CaseContent c={i.caseContent} /></div>
              : i.kind === "method" ? <div className="mt-3"><p className="mb-2 text-[12.5px] text-gray-600">Assessment method. You are approving the criteria, checklist, components with their pass levels, outcomes, evidence required and decision guidance below, for this exact version. Approval publishes nothing.</p><MethodContent m={i.methodContent} components={components} levels={levels} scales={scales} /></div> : (
              <dl className="mt-3 space-y-2 text-[13.5px]">
                <div><dt className="text-[12px] font-semibold text-gray-500">Description</dt><dd className="text-gray-800">{i.snapshot.description ?? "None recorded"}</dd></div>
                <div><dt className="text-[12px] font-semibold text-gray-500">Learning outcomes</dt><dd className="text-gray-800">{i.snapshot.outcomes.length ? <ul className="list-disc pl-5">{i.snapshot.outcomes.map((o, n) => <li key={n}>{o}</li>)}</ul> : "None recorded"}</dd></div>
                {i.criteria?.some(k => k.component) ? (
                  <div><dt className="text-[12px] font-semibold text-gray-500">Assessment criteria, by component</dt><dd><CriteriaList criteria={i.criteria} components={components} open /></dd></div>
                ) : <div><dt className="text-[12px] font-semibold text-gray-500">Skills</dt><dd className="text-gray-800">{i.snapshot.skills.length ? i.snapshot.skills.join(", ") : "None recorded"}</dd></div>}
              </dl>)}
              <div className="mt-4 border-t border-gray-100 pt-3"><Decide versionId={i.versionId} appointmentId={i.appointmentId} idPrefix={`v-${i.versionId}`} /></div>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
