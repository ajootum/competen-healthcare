import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { individualShell, gatedMetadata } from "../../../_components/shell-context";
import { secondaryBtn } from "../../../_components/chrome";
import { minorToMajor } from "@/lib/commerce/gateway";
import { learningCommerceEnabled, learningEnabled, LEARNING_TERMS } from "@/lib/learning/policy";
import { offeringForLearner } from "@/lib/learning/catalogue";
import { LearningShell, day } from "../_components/LearningShell";
import { BuyButton, EnrolButton } from "../_components/LearnerControls";

// Request-time only: it reads the release gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /individual/learning/[code] -- one offering (COMPETEN-LEARNING-01 S2-S3). Discover -> Access or Purchase -> Enrol.
//
// ⚠ WHO DOES WHAT IS STATED. The content owner, delivery provider, certificate issuer and the party that takes
// payment are shown. For an external course: where it is delivered, that the provider takes payment, that Competen
// does not check completion with the provider, and that listing it is not a clinical endorsement.
//
// ⚠ PRICE AND TERMS ARE THE APPROVED ROW'S. The page reads the approved price and the terms text of its version. The
// checkout copies exactly that row, and access starts only when settlement proves the payment.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Course" }); }

export default async function OfferingPage({ params }: { params: Promise<{ code: string }> }) {
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  if (shell.state !== "READY") redirect("/individual/access");
  const { admin, userId, live } = shell.ctx;
  if (!(await learningEnabled(admin))) notFound();
  const { code } = await params;
  const o = await offeringForLearner(admin, userId, decodeURIComponent(code));
  if (!o) notFound();
  const { item: i, content: b, record, access } = o;
  const commerce = await learningCommerceEnabled(admin);
  const enrolled = record && record.status !== "withdrawn" && record.version_id === i.versionId;
  const price = i.prices[0];
  const priceText = price ? `${price.currency} ${(minorToMajor(price.amountMinor, price.currency) ?? price.amountMinor).toLocaleString("en-GB")}` : null;

  return (
    <LearningShell live={live} current="catalogue">
      <article className="space-y-6">
        <header>
          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-[var(--cmp-theme-ink)]">{i.delivery === "external" ? "External course" : i.source === "partner" ? "Partner course" : "Competen course"} · {i.offeringType.replace(/_/g, " ")}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 text-balance">{i.title}</h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-gray-700">{i.summary}</p>
          <p className="mt-2 text-[13.5px] text-gray-600">{[i.level, i.format?.replace(/_/g, " "), i.durationMinutes ? `about ${i.durationMinutes} minutes` : null, `version ${i.versionNo}`].filter(Boolean).join(" · ")}</p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 text-[14px] text-gray-700">
            <h2 className="text-[15px] font-bold text-gray-900">Who provides it</h2>
            <dl className="mt-2 space-y-1">
              <div><dt className="inline font-semibold">Delivered by: </dt><dd className="inline">{i.provider?.name ?? "Not stated"}</dd></div>
              {i.delivery === "external" && b.external && <div><dt className="inline font-semibold">Where: </dt><dd className="inline">{b.external.deliveryLocation || "On the provider's site"}</dd></div>}
              <div><dt className="inline font-semibold">Payment: </dt><dd className="inline">{i.delivery === "external" ? (b.external?.payment === "none" ? "Free" : "Taken by the provider, on its own terms") : i.access === "free" ? "Free" : `Taken by ${i.commercial?.name ?? "Competen Holdings"} through Competen's payment provider`}</dd></div>
              <div><dt className="inline font-semibold">Certificate: </dt><dd className="inline">{i.delivery === "external" ? (b.external?.certificateBy === "provider" ? "Issued by the provider, if it offers one" : "None") : i.certificateOffered ? `Issued by ${i.issuer?.name ?? "the named issuer"}` : "None"}</dd></div>
              <div><dt className="inline font-semibold">CPD: </dt><dd className="inline">{i.delivery === "external" ? (b.external?.cpdInfo || "As the provider states it") : i.cpdHours ? `${i.cpdHours} hours of learning${i.cpdNote ? ` (${i.cpdNote})` : ""}` : "Not stated"}. Competen does not accredit CPD.</dd></div>
            </dl>
            {i.listingApproved && <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[13px] text-gray-700">Competen lists this course so you can find it and record it. Listing it is not a clinical endorsement, an accreditation or a claim that Competen owns it.</p>}
            {i.clinicallyApproved && <p className="mt-3 rounded-xl bg-[var(--cmp-theme-soft)] px-3 py-2 text-[13px] text-[var(--cmp-theme-ink)]">This version was independently clinically reviewed before publication.</p>}
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 text-[14px] text-gray-700">
            <h2 className="text-[15px] font-bold text-gray-900">What it covers</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">{b.objectives.map(x => <li key={x.id}>{x.text}</li>)}</ul>
            {i.competencies.length > 0 && <><h3 className="mt-3 text-[13.5px] font-bold text-gray-900">Competencies (CFCA)</h3>
              <ul className="mt-1 space-y-0.5 text-[13.5px]">{i.competencies.map(c => <li key={`${c.id}-${c.relation}`}>{c.name}: <span className="text-gray-600">{c.relationLabel.toLowerCase()}</span></li>)}</ul>
              <p className="mt-2 text-[12.5px] text-gray-500">Completing a course is not verification of clinical competence.</p></>}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          {enrolled ? (
            <div className="flex flex-wrap items-center gap-3"><p className="text-[14.5px] text-gray-800">{record.status === "completed" ? "You have completed this version." : "You are enrolled."}</p>
              <Link href={`/individual/learning/record/${record.id}`} className={secondaryBtn}>{record.status === "completed" ? "See your record" : i.delivery === "external" ? "Record your completion" : "Continue"}</Link></div>
          ) : i.delivery === "external" ? (
            <div className="space-y-3">
              <p className="text-[14.5px] text-gray-800">You will leave Competen to take this course with {i.provider?.name ?? "its provider"}. Afterwards, come back to record that you completed it and attach their certificate if you have one.</p>
              <div className="flex flex-wrap gap-3">
                {b.external?.url && <a href={b.external.url} target="_blank" rel="noopener noreferrer nofollow" className={secondaryBtn}>Open at {i.provider?.name ?? "the provider"} (new tab)</a>}
                <EnrolButton offeringId={i.offeringId} label="Add it to my learning to record later" />
              </div>
            </div>
          ) : i.access === "free" || access.live ? (
            <div className="space-y-2">{access.live && <p className="text-[14px] text-gray-700">You have access{access.endsAt ? ` until ${day(access.endsAt)}` : ""}.</p>}<EnrolButton offeringId={i.offeringId} label={i.access === "free" ? "Start this free course" : "Start the course"} /></div>
          ) : price && commerce ? (
            <div className="space-y-3">
              <p className="text-[15px] font-semibold text-gray-900">{priceText} · {price.accessDays ? `${price.accessDays} days of access` : "access for as long as the course is offered under these terms"}</p>
              <details className="text-[13.5px] text-gray-700"><summary className="cursor-pointer font-semibold">{LEARNING_TERMS[price.termsVersion]?.title ?? "Terms"}</summary><p className="mt-2">{LEARNING_TERMS[price.termsVersion]?.text}</p></details>
              <BuyButton priceId={price.id} label={`Get access for ${priceText}`} />
              <p className="text-[12.5px] text-gray-500">Mobile Money or card, through Competen&apos;s payment provider. Access starts when the provider confirms the payment to Competen.</p>
            </div>
          ) : (
            <p className="text-[14.5px] text-gray-700">Access to this course is arranged by Competen during the pilot. Contact the person who invited you.</p>
          )}
        </section>
      </article>
    </LearningShell>
  );
}
