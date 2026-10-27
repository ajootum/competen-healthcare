import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { individualShell, gatedMetadata } from "../../_components/shell-context";
import { StatePanel, Unreadable } from "../../_components/chrome";
import { minorToMajor } from "@/lib/commerce/gateway";
import { learningEnabled, loadLearningPolicy } from "@/lib/learning/policy";
import { publishedCatalogue, type CatalogueFilters } from "@/lib/learning/catalogue";
import { myRecords } from "@/lib/learning/record";
import { EVIDENCE_LABEL, OUTCOME_LABEL } from "@/lib/learning/record";
import { LearningShell, day } from "./_components/LearningShell";

// Request-time only: it reads the release gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /individual/learning -- THE UNIFIED LEARNING CATALOGUE and MY LEARNING (COMPETEN-LEARNING-01 S2, product definition s4).
//
// ⚠ MEMBER-ONLY, EXPERIENCE-FREE (owner D2). Gate 3 (the (app) layout) admits any active member. Nothing here needs
// Scholar or Professional, and browsing needs no development need or plan. A course-only member lands here.
//
// ⚠ EXTERNAL LEARNING IS LABELLED AS EXTERNAL: the provider, who takes payment and who issues any certificate are
// shown, and a listing is never described as clinically endorsed.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Learning" }); }

const UUID = /^[0-9a-f-]{36}$/i;
const pick = (v: unknown) => (typeof v === "string" && v.length <= 100 ? v : null);

export default async function LearningCatalogue({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  if (shell.state !== "READY") redirect("/individual/access");
  const { admin, userId, live } = shell.ctx;
  if (!(await learningEnabled(admin))) notFound();
  const sp = await searchParams;
  const mine = sp.view === "mine";
  const f: CatalogueFilters = {
    q: pick(sp.q), delivery: sp.delivery === "hosted" || sp.delivery === "external" ? sp.delivery : null, level: pick(sp.level), format: pick(sp.format),
    cost: sp.cost === "free" || sp.cost === "paid" || sp.cost === "external" ? sp.cost : null, certificate: sp.certificate === "1" ? true : null,
    professionTermId: UUID.test(sp.profession ?? "") ? sp.profession! : null, competencyId: UUID.test(sp.competency ?? "") ? sp.competency! : null, topic: pick(sp.topic),
  };
  const [policy, items, records] = await Promise.all([loadLearningPolicy(admin), mine ? Promise.resolve([]) : publishedCatalogue(admin, f), myRecords(admin, userId)]);
  const enrolled = new Map((records ?? []).filter(r => r.status !== "withdrawn").map(r => [r.offeringId, r]));
  const sel = "min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 text-[14px] text-gray-900";

  return (
    <LearningShell live={live} current={mine ? "mine" : "catalogue"}>
      {mine ? (
        <section aria-labelledby="mine-h" className="space-y-4">
          <h1 id="mine-h" className="text-2xl font-bold tracking-tight text-gray-900">My learning</h1>
          <p className="text-[14.5px] text-gray-600">Everything you have enrolled on, completed or recorded. It stays here whatever happens to your access or your subscriptions.</p>
          {records === null ? <Unreadable what="learning record" /> : records.length === 0 ? <p className="text-[14.5px] text-gray-700">Nothing yet. <Link className="font-semibold text-[var(--cmp-theme-ink)] underline" href="/individual/learning">Browse the catalogue</Link>.</p> : (
            <ul className="space-y-3">{records.map(r => (
              <li key={r.id} className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[16px] font-bold text-gray-900"><Link href={`/individual/learning/record/${r.id}`} className="underline decoration-gray-300">{r.title}</Link></h2>
                  <span className="text-[13px] font-semibold text-gray-700">{r.status === "completed" ? OUTCOME_LABEL[r.completionKind as keyof typeof OUTCOME_LABEL] ?? "Completed" : r.status === "withdrawn" ? "Withdrawn" : "In progress"}</span>
                </div>
                <p className="text-[13.5px] text-gray-600">Version {r.versionNo} · enrolled {day(r.enrolledAt)}{r.completedAt ? ` · completed ${day(r.completedAt)}` : ""} · {EVIDENCE_LABEL[r.evidenceClass as keyof typeof EVIDENCE_LABEL] ?? r.evidenceClass}{r.status !== "completed" && r.accessKind === "entitlement" && !r.accessLive ? " · your access has ended" : ""}</p>
                {r.certificates.length > 0 && <p className="mt-1 text-[13.5px]">{r.certificates.map(c => <Link key={c.id} href={`/individual/learning/certificate/${c.no}`} className="mr-3 font-semibold text-[var(--cmp-theme-ink)] underline">Certificate {c.no}{c.revokedAt ? " (revoked)" : ""}</Link>)}</p>}
              </li>))}</ul>
          )}
        </section>
      ) : (
        <section aria-labelledby="cat-h" className="space-y-5">
          <div>
            <h1 id="cat-h" className="text-2xl font-bold tracking-tight text-gray-900">Learning catalogue</h1>
            <p className="mt-1 max-w-2xl text-[14.5px] text-gray-600">Courses developed by Competen and its partners, and courses from other providers you can take on their own sites and record here. You do not need Competen Scholar or Competen Professional to take a course.</p>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 bg-white p-3">
            <label className="text-[13px] text-gray-700">Search<input name="q" defaultValue={f.q ?? ""} className={`${sel} ml-1 w-48`} /></label>
            <label className="text-[13px] text-gray-700">Where<select name="delivery" defaultValue={f.delivery ?? ""} className={`${sel} ml-1`}><option value="">Anywhere</option><option value="hosted">On Competen</option><option value="external">With another provider</option></select></label>
            <label className="text-[13px] text-gray-700">Level<select name="level" defaultValue={f.level ?? ""} className={`${sel} ml-1`}><option value="">Any</option>{policy.levels.map(l => <option key={l} value={l}>{l}</option>)}</select></label>
            <label className="text-[13px] text-gray-700">Format<select name="format" defaultValue={f.format ?? ""} className={`${sel} ml-1`}><option value="">Any</option>{policy.formats.map(l => <option key={l} value={l}>{l.replace(/_/g, " ")}</option>)}</select></label>
            <label className="text-[13px] text-gray-700">Cost<select name="cost" defaultValue={f.cost ?? ""} className={`${sel} ml-1`}><option value="">Any</option><option value="free">Free</option><option value="paid">Paid</option><option value="external">Paid to the provider</option></select></label>
            <label className="text-[13px] text-gray-700"><input type="checkbox" name="certificate" value="1" defaultChecked={f.certificate === true} /> With a certificate</label>
            <button type="submit" className="min-h-[44px] rounded-xl bg-gray-900 px-4 text-[14px] font-semibold text-white">Filter</button>
          </form>
          {items === null ? <Unreadable what="learning catalogue" /> : items.length === 0 ? (
            <StatePanel title="Nothing matches yet"><p>No published learning matches these filters. Clear them to see everything that is offered.</p></StatePanel>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">{items.map(i => {
              const r = enrolled.get(i.offeringId);
              const price = i.prices[0];
              return (
                <li key={i.offeringId} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5">
                  <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--cmp-theme-ink)]">{i.delivery === "external" ? `External · ${i.provider?.name ?? "another provider"}` : i.source === "partner" ? `Partner · ${i.provider?.name ?? ""}` : "Competen"}</p>
                  <h2 className="mt-1 text-[17px] font-bold text-gray-900"><Link href={`/individual/learning/${i.code}`} className="underline decoration-gray-300">{i.title}</Link></h2>
                  <p className="mt-1 line-clamp-3 text-[14px] text-gray-600">{i.summary}</p>
                  <p className="mt-2 text-[13px] text-gray-600">{[i.level, i.format?.replace(/_/g, " "), i.durationMinutes ? `${i.durationMinutes} min` : null, i.certificateOffered ? "certificate" : null].filter(Boolean).join(" · ")}</p>
                  <p className="mt-auto pt-3 text-[13.5px] font-semibold text-gray-900">{r ? (r.status === "completed" ? "Completed" : "Enrolled") : i.access === "free" ? "Free" : i.access === "external" ? "Fee and payment with the provider" : price ? `${price.currency} ${(minorToMajor(price.amountMinor, price.currency) ?? price.amountMinor).toLocaleString("en-GB")}` : "Access by arrangement"}</p>
                </li>);
            })}</ul>
          )}
        </section>
      )}
    </LearningShell>
  );
}
