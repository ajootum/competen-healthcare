import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { listShares, suggestedShareDays } from "@/lib/individual/professional/share";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing } from "../../../../_components/chrome";
import { ApiButton, ApiForm, Field, inputCls } from "../../../../_components/professional/forms";
import { Empty, Section, fmtDate } from "../../../../_components/professional/bits";
import CopyLink from "../../../../_components/professional/CopyLink";
import { SITE_URL } from "@/lib/marketing/site";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// SHARE YOUR PASSPORT -- COMPETEN-IND-007 s5.
//
// A revocable, time-limited link to the public /verify page (passport_share_tokens, migration 122), which
// also carries the person's own records, each with its evidence class. Not in the navigation: it is
// reached from the Passport, where the person sees exactly what they would be sharing.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Share your Passport" }); }

export default async function SharePage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "share");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const [links, policy] = await Promise.all([listShares(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin)]);
  const maxDays = policy.shareLinkMaxDays;
  const now = new Date().toISOString();

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your Passport" title="Share your Passport"
        intro="Create a link you can give to an employer, a course or a regulator. You choose what it shows and for how long, and you can withdraw it at any time." />

      <Section title="What a link shows">
        <ul className="list-disc space-y-1 pl-5 text-[14px] text-gray-700">
          <li><span className="font-semibold">Summary:</span> counts only. How many current assessed competencies and verified credentials organisations recorded for you, and how many records you added yourself.</li>
          <li><span className="font-semibold">Full:</span> also lists them by name. Each record you added says it is self-declared, with or without a document, and not verified.</li>
          <li>Never shown: your reflections, development needs, plan, notes, documents or anything you have not recorded as evidence.</li>
        </ul>
        <p className="mt-3 text-[13.5px] text-gray-600">
          Check what you would share on <Link href={experienceHref("professional", "passport")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>your Passport</Link> first.
        </p>
      </Section>

      <Section title="Create a link">
        <ApiForm action="/api/individual/professional/share" submitLabel="Create link" accent={x.accent} savedText="Link created. It is listed below.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="What it shows" htmlFor="sh-scope">
              <select id="sh-scope" name="scope" className={inputCls} defaultValue="summary">
                <option value="summary">Summary</option>
                <option value="full">Full</option>
              </select>
            </Field>
            <Field label="Valid for (days)" htmlFor="sh-days" hint={`Up to ${maxDays} days.`}><input id="sh-days" name="days" type="number" min={1} max={maxDays} defaultValue={suggestedShareDays(maxDays)} className={inputCls} /></Field>
            <Field label="Purpose (optional)" htmlFor="sh-label" hint="Shown on the link, e.g. a job application."><input id="sh-label" name="label" maxLength={120} className={inputCls} /></Field>
          </div>
        </ApiForm>
      </Section>

      <Section title="Your links">
        {links === null ? <Unreadable what="share links" /> : links.length === 0 ? <Empty>You have not shared your Passport from Competen Professional.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {links.map(l => {
              const expired = !!l.expires_at && l.expires_at < now;
              const state = l.revoked ? "Withdrawn" : expired ? "Expired" : "Active";
              return (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-gray-900">{l.label ?? "Passport link"} <span className="font-normal text-gray-500">· {l.scope === "full" ? "Full" : "Summary"} · {state}</span></p>
                    <p className="text-[12.5px] text-gray-500">Created {fmtDate(l.created_at)} · until {fmtDate(l.expires_at)} · opened {l.view_count} {l.view_count === 1 ? "time" : "times"}</p>
                    {state === "Active" && <CopyLink url={`${SITE_URL}/verify/${l.token}`} accent={x.accent} />}
                  </div>
                  {state === "Active" && <ApiButton action={`/api/individual/professional/share?id=${l.id}`} method="PATCH" label="Withdraw" confirm="Withdraw this link? Anyone holding it will no longer be able to open it." />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
