import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { PageHeader } from "../../../../../_components/chrome";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadLcpdConfig } from "@/lib/individual/lcpd-config";
import { loadPassportSelection } from "@/lib/individual/passport-view";
import { identityOf, loadIdentity, photoUrl } from "@/lib/individual/identity";
import { shareCarriesOwnRecords } from "@/lib/individual/professional/share";
import { SITE_URL } from "@/lib/marketing/site";
import PassportLinkView from "../../../../../_components/passport/PassportLinkView";
import PrintButton from "../../../../../_components/passport/PrintButton";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// PREVIEW AND EXPORT OF ONE PASSPORT VIEW -- COMPETEN-PROFESSIONAL-PASSPORT-01 (Stage 7) P4.
//
// The owner sees EXACTLY what a recipient will see: the same read (loadPassportSelection) and the same rendering
// (PassportLinkView) as /verify, for their own link only, whether it is a draft, active, expired or withdrawn. The
// export is this page printed: it carries its issue date and the link to check current status, and says that a saved
// copy cannot be recalled. Nothing here shares anything.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Preview a Passport view" }); }

export default async function PreviewPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await experienceModulePage((await params).experience, "share");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const raw = (await searchParams).link;
  const id = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const back = experienceHref("professional", "share");
  const { data: link } = /^[0-9a-f-]{36}$/i.test(id)
    ? await ctx.admin.from("passport_share_tokens").select("id, token, expires_at, revoked, consent, created_at").eq("id", id).eq("nurse_id", ctx.userId).maybeSingle()
    : { data: null };
  if (!link || !(await shareCarriesOwnRecords(ctx.admin, link.id, ctx.userId))) {
    return (<><PageHeader accent={x.accent} eyebrow="Your Passport" title="Preview" intro="That link is not one of yours." /><Link href={back} className="font-semibold underline">Back to sharing</Link></>);
  }
  const today = new Date().toISOString().slice(0, 10);
  const policy = await loadIndividualPolicy(ctx.admin);
  const selection = await loadPassportSelection(ctx.admin, ctx.userId, link.id, { today, profile: policy.professionalProfile, competency: policy.professionalCompetency, lcpd: await loadLcpdConfig(ctx.admin), passport: policy.professionalPassport });
  const photo = selection.meta?.includePhoto ? await photoUrl(ctx.admin, identityOf(await loadIdentity(ctx.admin, ctx.userId)).photoPath) : null;
  const state = link.revoked ? "withdrawn" : link.expires_at && link.expires_at < new Date().toISOString() ? "expired" : selection.meta && !selection.meta.activatedAt ? "a draft (nobody can open it yet)" : "active";

  return (
    <>
      <div className="print:hidden">
        <PageHeader accent={x.accent} eyebrow="Your Passport" title="What the recipient will see"
          intro={`Exactly what this link shows, read now. The link is ${state}.`} />
        <p className="mb-3 text-[13px]"><Link href={back} className="font-semibold underline" style={{ color: x.accent }}>← Back to sharing</Link></p>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        {selection.meta === null ? <p className="text-[13.5px] text-gray-700">This link was made before record-level sharing, so it carries no records. Create a new view to share records.</p>
          : <PassportLinkView selection={selection} order={policy.professionalPassport.sections} name={ctx.profile.fullName ?? null} detailed={policy.professionalPassport.presentation === "detailed"} photoUrl={photo} />}
        <div className="mt-5 border-t border-gray-100 pt-3 text-[11.5px] text-gray-600">
          <p>Issued {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} from the professional&apos;s Competen Passport. Link valid until {link.expires_at ? new Date(link.expires_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}.</p>
          <p>Check current status at {SITE_URL}/verify/{link.token} while the link is active. A printed or saved copy cannot be recalled and may be out of date: the link shows each record as it stands now.</p>
        </div>
      </div>
      {policy.professionalPassport.exportOn === "on" && selection.meta !== null && <div className="mt-4"><PrintButton /></div>}
    </>
  );
}
