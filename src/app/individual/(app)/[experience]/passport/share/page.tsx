import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { listShares, loadShareHistory, suggestedShareDays } from "@/lib/individual/professional/share";
import { identityOf, loadIdentity } from "@/lib/individual/identity";
import { loadIndividualPassport, EVIDENCE_LABEL } from "@/lib/individual/passport";
import { CATEGORY_LABEL } from "@/lib/individual/passport-vocabulary";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import type { Metadata } from "next";
import { experiencePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing } from "../../../../_components/chrome";
import { ApiButton, ApiForm, Field, inputCls } from "../../../../_components/professional/forms";
import { Empty, Section, fmtDate } from "../../../../_components/professional/bits";
import CopyLink from "../../../../_components/professional/CopyLink";
import { SITE_URL } from "@/lib/marketing/site";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// SHARE FROM COMPETEN SCHOLAR -- PRODUCT-EXPERIENCE P4 (owner Option A, 26 Oct). A learner shares FORMATIVE records
// from their Passport: the study achievements (375) and evaluations (427) they already chose to show, ticked one by
// one. The same Passport links as Professional (passport_share_tokens, the 540 view, /verify): a draft first, previewed
// exactly, activated once, time-limited, withdrawable, with the opening history. Nothing from Professional, nothing an
// organisation issued, and never notes, answers, AI text or reflections. Each record says it is formative.
// In Professional, sharing lives on the Professional share page; this page sends a Professional user there.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Share from your Passport" }); }

const API = "/api/individual/scholar/passport-share";

export default async function ScholarSharePage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experiencePage((await params).experience);
  if (!page) return null;
  const { ctx, experience } = page;
  const x = EXPERIENCES[experience];
  if (experience !== "scholar") {
    return (
      <>
        <PageHeader accent={x.accent} eyebrow="Your Passport" title="Share from your Passport" intro="In Competen Professional, you share from the Professional share page." />
        <Link href={experienceHref("professional", "share")} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Go to Share your Passport</Link>
      </>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const [passport, policy, links] = await Promise.all([
    loadIndividualPassport(ctx.admin, ctx.userId, today), loadIndividualPolicy(ctx.admin), listShares(ctx.admin, ctx.userId, "scholar"),
  ]);
  const pp = policy.professionalPassport;
  const maxDays = policy.shareLinkMaxDays;
  const history = await loadShareHistory(ctx.admin, ctx.userId, (links ?? []).map(l => l.id));
  const hasPhoto = !!identityOf(await loadIdentity(ctx.admin, ctx.userId)).photoPath;
  const now = new Date().toISOString();
  const study = pp.shareable.includes("study") && passport.study.ok ? passport.study.data.filter(s => s.itemId) : [];
  const evaluations = pp.shareable.includes("evaluation") && passport.evaluations.ok ? passport.evaluations.data.filter(v => v.itemId) : [];
  const groups = ([
    ["study", study.map(s => ({ id: s.itemId!, title: s.label, note: EVIDENCE_LABEL.self_directed }))],
    ["scholar_evaluation", evaluations.map(v => ({ id: v.itemId!, title: v.label, note: EVIDENCE_LABEL.educational_evaluation }))],
  ] as const).filter(([, list]) => list.length > 0);

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your Passport" title="Share from your Passport"
        intro="Give a tutor, a course or an employer a link to the study and evaluations you choose. You decide what it shows and for how long, and you can withdraw it at any time." />

      <Section title="What a link shows">
        <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-gray-700">
          <li><span className="font-semibold">Only what you tick:</span> study achievements and evaluations already on your Passport, one by one. Nothing else of yours travels with it.</li>
          <li><span className="font-semibold">Formative, not verified:</span> each record says it is your own practice and its evaluation, not an assessment, a qualification or a verified competency.</li>
          <li><span className="font-semibold">A draft first:</span> a new link opens for nobody until you have previewed it and activated it.</li>
          <li><span className="font-semibold">Never shown:</span> your notes, your answers, anything the AI wrote, your reflections, or study you have not put on your Passport.</li>
        </ul>
        <p className="mt-3 text-[13.5px] text-gray-600">
          Choose what can be shared on <Link href={experienceHref("scholar", "passport")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>your Passport</Link> first.
        </p>
      </Section>

      <Section title="Create a link">
        {!passport.study.ok && !passport.evaluations.ok ? <Unreadable what="your Passport" />
          : groups.length === 0 ? <Empty>Nothing on your Passport can be shared yet. Put a study achievement or an evaluation on your Passport, then come back.</Empty> : (
          <ApiForm action={API} submitLabel="Create draft" accent={x.accent} savedText="Draft created. Preview it below, then activate it when it is right.">
            <div className="grid gap-4 sm:grid-cols-3">
              {pp.purposes.length > 0 && (
                <Field label="What it is for (optional)" htmlFor="ssh-purpose">
                  <select id="ssh-purpose" name="purpose" className={inputCls} defaultValue=""><option value="">Not stated</option>{pp.purposes.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}</select>
                </Field>
              )}
              <Field label={pp.recipient === "required" ? "Who it is for" : "Who it is for (optional)"} htmlFor="ssh-recipient" hint="A label for you and them. No account or address is created.">
                <input id="ssh-recipient" name="recipient" maxLength={160} required={pp.recipient === "required"} className={inputCls} />
              </Field>
              <Field label="Valid for (days)" htmlFor="ssh-days" hint={`Up to ${maxDays} days.`}><input id="ssh-days" name="days" type="number" min={1} max={maxDays} defaultValue={suggestedShareDays(maxDays)} className={inputCls} /></Field>
            </div>
            <Field label="A short note in your own words (optional)" htmlFor="ssh-summary"><textarea id="ssh-summary" name="summary" rows={3} maxLength={2000} className={inputCls} /></Field>
            {/* IDENTITY-HUB-01 (590): the private photo travels only on a link it is ticked for. Unticked by default. */}
            {hasPhoto && (
              <label className="flex items-start gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                <input type="checkbox" name="includePhoto" value="true" className="mt-1 h-4 w-4 rounded border-gray-400" />
                <span>Show my profile photo on this link</span>
              </label>
            )}
            {groups.map(([kind, list]) => (
              <fieldset key={kind} className="rounded-xl border border-gray-200 p-4">
                <legend className="px-1 text-[13.5px] font-semibold text-gray-800">{CATEGORY_LABEL[kind === "scholar_evaluation" ? "evaluation" : kind]}</legend>
                <p className="text-[12.5px] text-gray-500">Nothing is included unless you tick it, for this link only.</p>
                {list.slice(0, 200).map(r => (
                  <label key={r.id} className="mt-1 flex items-start gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                    <input type="checkbox" name={`record:${kind}:${r.id}`} value="true" className="mt-1 h-4 w-4 rounded border-gray-400" />
                    <span>{r.title} <span className="text-[12.5px] text-gray-500">· {r.note}</span></span>
                  </label>
                ))}
              </fieldset>
            ))}
          </ApiForm>
        )}
      </Section>

      <Section title="Your links">
        {links === null ? <Unreadable what="share links" /> : links.length === 0 ? <Empty>You have not shared anything from Competen Scholar.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {links.map(l => {
              const expired = !!l.expires_at && l.expires_at < now;
              const h = history.get(l.id);
              const state = l.revoked ? "Withdrawn" : expired ? "Expired" : h?.draft ? "Draft" : "Active";
              const preview = `${experienceHref("scholar", "passport/share/preview")}?link=${l.id}`;
              return (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-gray-900">{h?.purpose ?? l.label ?? "Passport link"}{h?.recipient ? <span className="font-normal"> · for {h.recipient}</span> : null} <span className="font-normal text-gray-500">· {state}</span></p>
                    <p className="text-[12.5px] text-gray-500">Created {fmtDate(l.created_at)} · until {fmtDate(l.expires_at)} · opened {h ? h.opened : l.view_count} {(h ? h.opened : l.view_count) === 1 ? "time" : "times"}{h?.lastOpened ? `, last ${fmtDate(h.lastOpened)}` : ""}{h?.refused ? ` · ${h.refused} refused while it was closed` : ""}</p>
                    {state === "Active" && <CopyLink url={`${SITE_URL}/verify/${l.token}`} accent={x.accent} />}
                    {h && <Link href={preview} className="text-[12.5px] font-semibold underline" style={{ color: x.accent }}>{state === "Draft" ? "Preview what they will see" : "See what they see"}</Link>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {state === "Draft" && <ApiButton action={`${API}?id=${l.id}`} method="PATCH" body={{ action: "activate" }} label="Activate" confirm="Activate this link? Anyone with it can then open it until it expires or you withdraw it." />}
                    {(state === "Active" || state === "Draft") && <ApiButton action={`${API}?id=${l.id}`} method="PATCH" label={state === "Draft" ? "Discard" : "Withdraw"} confirm={state === "Draft" ? "Discard this draft?" : "Withdraw this link? It stops working at once."} />}
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
