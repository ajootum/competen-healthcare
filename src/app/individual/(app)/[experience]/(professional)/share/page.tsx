import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { listShares, loadShareHistory, suggestedShareDays } from "@/lib/individual/professional/share";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { CATEGORY_LABEL as PASSPORT_CATEGORY_LABEL } from "@/lib/individual/passport-vocabulary";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing } from "../../../../_components/chrome";
import { ApiButton, ApiForm, Field, inputCls } from "../../../../_components/professional/forms";
import { Empty, Section, fmtDate } from "../../../../_components/professional/bits";
import CopyLink from "../../../../_components/professional/CopyLink";
import { SITE_URL } from "@/lib/marketing/site";
import DraftSummary from "../../../../_components/passport/DraftSummary";
import { loadProfessionalProfile } from "@/lib/individual/professional/profile-store";
import { chainsOf, evidenceState, stateLabel } from "@/lib/individual/professional/profile-records";
import { NO_VERIFICATION, VERIFICATION_LABEL, loadVerifications } from "@/lib/individual/professional/profile-verification";
import { ITEM_KINDS, ITEM_SECTION, SECTION_LABEL } from "@/lib/individual/professional/profile-vocabulary";
import { learningProvenance, loadProfessionalLearning } from "@/lib/individual/professional/learning";
import { eligibleLearning } from "@/lib/individual/professional/share-learning";
import { loadLcpdConfig } from "@/lib/individual/lcpd-config";
import { loadCompetencyWorkspace } from "@/lib/individual/professional/competency-store";
import { SHARE_PART_LABEL } from "@/lib/individual/professional/competency-vocabulary";

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
  const today = new Date().toISOString().slice(0, 10);
  const [links, policy, view, verifications, learning, lcpd] = await Promise.all([listShares(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin),
    loadProfessionalProfile(ctx.admin, ctx.userId), loadVerifications(ctx.admin, ctx.userId, today), loadProfessionalLearning(ctx.admin, ctx.userId), loadLcpdConfig(ctx.admin)]);
  // COMPETENCY-01 S11: the person's current competencies, and the parts the configuration lets them share. Nothing ticked by default.
  const [comp, record, passport] = await Promise.all([loadCompetencyWorkspace(ctx.admin, ctx.userId), loadProfessionalRecord(ctx.admin, ctx.userId), loadIndividualPassport(ctx.admin, ctx.userId, today)]);
  // PASSPORT-01 (540): the person's own records, offered one by one, only in kinds the configuration lets a link carry.
  const pp = policy.professionalPassport;
  const offer = (k: Parameters<typeof pp.shareable.includes>[0]) => pp.shareable.includes(k);
  const ownCpd = offer("cpd") ? record.cpd ?? [] : [];
  const ownEvidence = offer("evidence") ? record.evidence ?? [] : [];
  const ownStudy = offer("study") && passport.study.ok ? passport.study.data.filter(s => s.itemId) : [];
  const ownEvaluations = offer("evaluation") && passport.evaluations.ok ? passport.evaluations.data.filter(v => v.itemId) : [];
  const history = await loadShareHistory(ctx.admin, ctx.userId, (links ?? []).map(l => l.id));
  const shareableCompetencies = comp.provisioned ? (comp.entries ?? []).filter(e => !e.removed_at) : [];
  // LCPD-01 LCPD-6: completed learning of a kind the configuration lets a person share. Nothing ticked by default.
  const shareableLearning = learning.enabled && learning.refs ? eligibleLearning(learning.refs, lcpd) : [];
  const maxDays = policy.shareLinkMaxDays;
  const now = new Date().toISOString();
  // COMPETEN-PROFESSIONAL-PROFILE-01 part B: the current profile records the person may choose to put on a link,
  // grouped by section, in the sections the sharing policy allows. Nothing is ticked by default.
  const shareSections = policy.professionalProfile.shareSections;
  const shareable = view.provisioned && view.items !== null
    ? ITEM_KINDS.filter(k => shareSections.includes(ITEM_SECTION[k])).map(k => ({ kind: k, chains: chainsOf(view.items, k).live })).filter(g => g.chains.length)
    : [];
  const canShareOverview = view.provisioned && !!view.pointer && shareSections.includes("overview");

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your Passport" title="Share your Passport"
        intro="Create a link you can give to an employer, a course or a regulator. You choose what it shows and for how long, and you can withdraw it at any time." />

      <Section title="What a link shows">
        <ul className="list-disc space-y-1 pl-5 text-[14px] text-gray-700">
          <li><span className="font-semibold">Record by record:</span> a link shows only what you tick for it, each record with where it came from, who issued it, whether it is current, and what it means. Nothing else of yours travels with it.</li>
          <li><span className="font-semibold">A draft first:</span> a new link opens for nobody until you have previewed it and activated it.</li>
          <li><span className="font-semibold">Your professional profile:</span> only what you tick below for that link, each record labelled exactly as it is, including whether Competen verified it. If you later change or withdraw a record, the link stops showing it.</li>
          <li><span className="font-semibold">Completed learning:</span> only the courses you tick below for that link, each labelled exactly as it is. Never your reflections on it.</li>
          <li><span className="font-semibold">Competencies:</span> only the parts you tick below for that link: a self-assessment (labelled self-reported), the evidence you linked, or independent verification outcomes. Never a reflection.</li>
          <li>Never shown: your reflections, development needs, plan, notes, documents or anything you have not recorded as evidence.</li>
        </ul>
        <p className="mt-3 text-[13.5px] text-gray-600">
          Check what you would share on <Link href={experienceHref("professional", "passport")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>your Passport</Link> first.
        </p>
      </Section>

      <Section title="Create a Passport view">
        <ApiForm action="/api/individual/professional/share" submitLabel="Create draft" accent={x.accent} savedText="Draft created. Preview it below, then activate it when it is right.">
          <div className="grid gap-4 sm:grid-cols-3">
            {pp.purposes.length > 0 && (
              <Field label="What it is for (optional)" htmlFor="sh-purpose">
                <select id="sh-purpose" name="purpose" className={inputCls} defaultValue=""><option value="">Not stated</option>{pp.purposes.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}</select>
              </Field>
            )}
            <Field label={pp.recipient === "required" ? "Who it is for" : "Who it is for (optional)"} htmlFor="sh-recipient" hint="A label for you and them. No account or address is created.">
              <input id="sh-recipient" name="recipient" maxLength={160} required={pp.recipient === "required"} className={inputCls} />
            </Field>
            <Field label="Valid for (days)" htmlFor="sh-days" hint={`Up to ${maxDays} days.`}><input id="sh-days" name="days" type="number" min={1} max={maxDays} defaultValue={suggestedShareDays(maxDays)} className={inputCls} /></Field>
          </div>
          <Field label="A short summary in your own words (optional)" htmlFor="sh-summary"><textarea id="sh-summary" name="summary" rows={3} maxLength={2000} className={inputCls} /></Field>
          {pp.ai === "on" && <DraftSummary targetId="sh-summary" purposeId="sh-purpose" accent={x.accent} />}
          {offer("institution") && (
            <label className="flex items-start gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
              <input type="checkbox" name="includeInstitution" value="true" className="mt-1 h-4 w-4 rounded border-gray-400" />
              <span>Include records organisations issued or verified for you (current assessed competencies and verified credentials)</span>
            </label>
          )}
          {([["cpd", ownCpd.map(c => ({ id: c.id, title: c.title, note: fmtDate(c.activity_date) }))],
             ["evidence", ownEvidence.map(e => ({ id: e.id, title: e.title, note: e.kind === "credential" ? "credential" : "supporting evidence" }))],
             ["study", ownStudy.map(s => ({ id: s.itemId!, title: s.label, note: PASSPORT_CATEGORY_LABEL.study }))],
             ["scholar_evaluation", ownEvaluations.map(v => ({ id: v.itemId!, title: v.label, note: `${PASSPORT_CATEGORY_LABEL.evaluation} (educational)` }))]] as const)
            .filter(([, list]) => list.length > 0).map(([kind, list]) => (
            <fieldset key={kind} className="rounded-xl border border-gray-200 p-4">
              <legend className="px-1 text-[13.5px] font-semibold text-gray-800">{PASSPORT_CATEGORY_LABEL[kind === "scholar_evaluation" ? "evaluation" : kind]} (optional)</legend>
              <p className="text-[12.5px] text-gray-500">Nothing is included unless you tick it, for this view only.</p>
              {list.slice(0, 200).map(r => (
                <label key={r.id} className="mt-1 flex items-start gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                  <input type="checkbox" name={`record:${kind}:${r.id}`} value="true" className="mt-1 h-4 w-4 rounded border-gray-400" />
                  <span>{r.title} <span className="text-[12.5px] text-gray-500">· {r.note}</span></span>
                </label>
              ))}
            </fieldset>
          ))}
          {(canShareOverview || shareable.length > 0) && (
            <fieldset className="rounded-xl border border-gray-200 p-4">
              <legend className="px-1 text-[13.5px] font-semibold text-gray-800">From your professional profile (optional)</legend>
              <p className="text-[12.5px] text-gray-500">Nothing is included unless you tick it, for this link only. Each record shows exactly what it is: recorded by you, with or without a document, and whether Competen verified it. Registration numbers, documents and details are never shared.</p>
              {canShareOverview && (
                <label className="mt-3 flex items-start gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                  <input type="checkbox" name="profileOverview" value="true" className="mt-1 h-4 w-4 rounded border-gray-400" />
                  <span>{SECTION_LABEL.overview}: profession, country of practice, status, title, specialty and setting</span>
                </label>
              )}
              {shareable.map(g => (
                <div key={g.kind} className="mt-3">
                  <p className="text-[12px] font-bold uppercase tracking-wide text-gray-500">{SECTION_LABEL[ITEM_SECTION[g.kind]]}</p>
                  {g.chains.map(c => {
                    const v = verifications?.[c.current.id] ?? NO_VERIFICATION;
                    return (
                      <label key={c.current.id} className="mt-1 flex items-start gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                        <input type="checkbox" name={`item:${c.current.id}`} value="true" className="mt-1 h-4 w-4 rounded border-gray-400" />
                        <span>{c.current.title} <span className="text-[12.5px] text-gray-500">· {stateLabel(evidenceState(c.current))}{["qualification", "registration", "employment"].includes(g.kind) ? ` · ${VERIFICATION_LABEL[v.state]}` : ""}</span></span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </fieldset>
          )}
          {shareableLearning.length > 0 && (
            <fieldset className="rounded-xl border border-gray-200 p-4">
              <legend className="px-1 text-[13.5px] font-semibold text-gray-800">Completed learning (optional)</legend>
              <p className="text-[12.5px] text-gray-500">Nothing is included unless you tick it, for this link only. Each course shows exactly what it is. Your reflections on it are never shared.</p>
              {shareableLearning.map(r => (
                <label key={r.recordId} className="mt-1 flex items-start gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                  <input type="checkbox" name={`learning:${r.recordId}`} value="true" className="mt-1 h-4 w-4 rounded border-gray-400" />
                  <span>{r.title} <span className="text-[12.5px] text-gray-500">· {learningProvenance(r)} · {fmtDate(r.completedOn)}</span></span>
                </label>
              ))}
            </fieldset>
          )}
          {shareableCompetencies.length > 0 && policy.professionalCompetency.shareParts.length > 0 && (
            <fieldset className="rounded-xl border border-gray-200 p-4">
              <legend className="px-1 text-[13.5px] font-semibold text-gray-800">Competencies (optional)</legend>
              <p className="text-[12.5px] text-gray-500">Nothing is included unless you tick it, for this link only. A self-assessment is shown as self-reported, evidence as evidence, and only an appointed assessor&apos;s outcome as verification. Reflections are never shared.</p>
              {shareableCompetencies.map(e => (
                <div key={e.id} className="mt-2">
                  <p className="text-[14px] font-semibold text-gray-800">{e.title}</p>
                  <div className="flex flex-wrap gap-x-4">
                    {policy.professionalCompetency.shareParts.filter(part => part !== "assessed_outcomes" || e.kind === "catalogue").map(part => (
                      <label key={part} className="mt-1 flex items-start gap-2 text-[13px] text-gray-700 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                        <input type="checkbox" name={`competency:${e.id}:${part}`} value="true" className="mt-0.5 h-4 w-4 rounded border-gray-400" />
                        <span>{SHARE_PART_LABEL[part]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
          )}
        </ApiForm>
      </Section>

      <Section title="Your links">
        {links === null ? <Unreadable what="share links" /> : links.length === 0 ? <Empty>You have not shared your Passport from Competen Professional.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {links.map(l => {
              const expired = !!l.expires_at && l.expires_at < now;
              const h = history.get(l.id);
              const state = l.revoked ? "Withdrawn" : expired ? "Expired" : h?.draft ? "Draft" : "Active";
              const preview = `${experienceHref("professional", "share/preview")}?link=${l.id}`;
              return (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-gray-900">{h?.purpose ?? l.label ?? "Passport link"}{h?.recipient ? <span className="font-normal"> · for {h.recipient}</span> : null} <span className="font-normal text-gray-500">· {state}</span></p>
                    <p className="text-[12.5px] text-gray-500">Created {fmtDate(l.created_at)} · until {fmtDate(l.expires_at)} · opened {h ? h.opened : l.view_count} {(h ? h.opened : l.view_count) === 1 ? "time" : "times"}{h?.lastOpened ? `, last ${fmtDate(h.lastOpened)}` : ""}{h?.refused ? ` · ${h.refused} refused after it closed` : ""}</p>
                    {state === "Active" && <CopyLink url={`${SITE_URL}/verify/${l.token}`} accent={x.accent} />}
                    {h && <Link href={preview} className="text-[12.5px] font-semibold underline" style={{ color: x.accent }}>{state === "Draft" ? "Preview what they will see" : "See what they see"}</Link>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {state === "Draft" && <ApiButton action={`/api/individual/professional/share?id=${l.id}`} method="PATCH" body={{ action: "activate" }} label="Activate" confirm="Activate this view? Anyone with the link can then open it until it expires or you withdraw it." />}
                    {(state === "Active" || state === "Draft") && <ApiButton action={`/api/individual/professional/share?id=${l.id}`} method="PATCH" label={state === "Draft" ? "Discard" : "Withdraw"} confirm={state === "Draft" ? "Discard this draft?" : "Withdraw this link? Anyone holding it will no longer be able to open it."} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
