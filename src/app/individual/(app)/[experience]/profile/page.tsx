import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { EVIDENCE_LABEL, loadIndividualPassport } from "@/lib/individual/passport";
import { buildHistory, loadEntitlementHistory } from "@/lib/individual/history";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadProfessionalProfile } from "@/lib/individual/professional/profile-store";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { loadVerifications, NO_VERIFICATION } from "@/lib/individual/professional/profile-verification";
import { chainsOf, itemState } from "@/lib/individual/professional/profile-records";
import { itemTitleOptions, itemTypeOptions } from "@/lib/individual/professional/profile-form";
import { ITEM_KINDS, RECORD_STATES } from "@/lib/individual/professional/profile-vocabulary";
import { loadCompetencyWorkspace } from "@/lib/individual/professional/competency-store";
import { loadLcpdConfig } from "@/lib/individual/lcpd-config";
import { lcpdSchemaReady, recordableTypes } from "@/lib/individual/professional/lcpd-schema";
import { loadPlanWorkspace } from "@/lib/individual/professional/plan-store";
import { openActivities } from "@/lib/individual/professional/record-goals";
import { listShares } from "@/lib/individual/professional/share";
import { identityOf, loadIdentity } from "@/lib/individual/identity";
import { completion, hubCards, toHubExperience, type CardSpec } from "@/lib/individual/profile-hub";
import { loadJoinOptions, contextHistory } from "@/lib/individual/scholar/context";
import { learnerContextPointer } from "@/lib/individual/scholar/store";
import { experiencePage, gatedMetadata } from "../../../_components/shell-context";
import type { Metadata } from "next";
import { Unreadable } from "../../../_components/chrome";
import { ItemBlock, StateBadge, VerificationBadge, type SectionCtx } from "../../../_components/professional/profile-sections";
import { AddPanel } from "../../../_components/professional/forms";
import CpdForm from "../../../_components/professional/CpdForm";
import { OwnProfileInline } from "@/components/account/OwnProfileCard";
import StudyContext, { type StudyOptions, type StudyPeriod } from "../../../_components/profile/StudyContext";
import IdentityEditor from "../../../_components/profile/IdentityEditor";
import PhotoControl from "../../../_components/profile/PhotoControl";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// PROFILE & HISTORY -- THE PERSONAL AND PROFESSIONAL IDENTITY HUB (COMPETEN-INDIVIDUAL-IDENTITY-HUB-01, owner
// directive 26 Oct, "functional redesign"). The owner's mock-up is the visual reference: a header with photo,
// name, headline and the experiences held, then a two-column grid of cards, each added to and edited in place.
// Which records each card shows, and where each one lives, is src/lib/individual/profile-hub.ts. In short: one
// record, one home (HFE D2), read here, never copied; private unless chosen for a Passport link; nothing verified by
// being entered; the development history is read-only and kept apart.

const fmt = (d: string) => new Date(`${d.length === 10 ? `${d}T00:00:00Z` : d}`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const linkCls = "font-semibold underline-offset-2 hover:underline";
// A standalone link is a touch target on a phone (CPR-MOB-001: pointer-coarse, not width).
const actionCls = `${linkCls} inline-flex items-center pointer-coarse:min-h-[var(--cmp-touch-min)]`;

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Profile & history" }); }

function Card({ spec, wide, children }: { spec: Pick<CardSpec, "card" | "title" | "note">; wide?: boolean; children: React.ReactNode }) {
  const id = `card-${spec.card}`;
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={`scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 ${wide ? "md:col-span-2" : ""}`}>
      <h2 id={`${id}-h`} className="text-[16px] font-bold text-gray-900">{spec.title}</h2>
      {spec.note && <p className="mt-0.5 text-[12.5px] text-gray-500">{spec.note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
const Fact = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div><dt className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{k}</dt><dd className="text-[14.5px] text-gray-900">{v ?? <span className="italic text-gray-500">Not recorded</span>}</dd></div>
);

export default async function ProfilePage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experiencePage((await params).experience);
  if (!page) return null;
  const { ctx, experience } = page;
  const x = EXPERIENCES[experience];
  const hub = toHubExperience(experience)!;
  const today = new Date().toISOString().slice(0, 10);
  const holds = { scholar: ctx.live.includes("scholar"), professional: ctx.live.includes("professional") };
  const [passport, entitlements, policy, view, identityRead] = await Promise.all([
    loadIndividualPassport(ctx.admin, ctx.userId, today), loadEntitlementHistory(ctx.admin, ctx.userId),
    loadIndividualPolicy(ctx.admin), loadProfessionalProfile(ctx.admin, ctx.userId), loadIdentity(ctx.admin, ctx.userId),
  ]);
  const identity = identityOf(identityRead);
  const identityReady = !!identityRead?.provisioned;
  const history = buildHistory({ joinedAt: ctx.membership.grantedAt, entitlements, passport });
  const partial = entitlements === null || passport.competencies === null || passport.credentials === null || passport.employment === null;
  const pp = policy.professionalProfile;
  const cards = hubCards(pp.sections, hub, holds);

  // Each card's own data, read where it lives.
  const [record, verifications, competencies, cfg, ready, plan, links, study] = await Promise.all([
    holds.professional ? loadProfessionalRecord(ctx.admin, ctx.userId) : Promise.resolve(null),
    holds.professional && view.provisioned ? loadVerifications(ctx.admin, ctx.userId, today) : Promise.resolve(null),
    holds.professional ? loadCompetencyWorkspace(ctx.admin, ctx.userId) : Promise.resolve(null),
    holds.professional ? loadLcpdConfig(ctx.admin) : Promise.resolve(null),
    holds.professional ? lcpdSchemaReady(ctx.admin) : Promise.resolve(false),
    holds.professional ? loadPlanWorkspace(ctx.admin, ctx.userId) : Promise.resolve(null),
    listShares(ctx.admin, ctx.userId),
    holds.scholar ? (async () => {
      const [opts, ptr, hist] = await Promise.all([loadJoinOptions(ctx.admin, policy), learnerContextPointer(ctx.admin, ctx.userId), contextHistory(ctx.admin, ctx.userId)]);
      const options: StudyOptions | null = opts.ok ? opts.options : null;
      const name = (code: string) => options?.programmes.find(p => p.code === code)?.label ?? code;
      return {
        options,
        current: ptr.ok && ptr.data ? { programme: ptr.data.programme_code, level: ptr.data.level_code, institution: ptr.data.institution_code } : { programme: null, level: null, institution: null },
        periods: hist.ok ? hist.periods.map(p => ({ programmeLabel: name(p.programmeCode), levelLabel: p.levelLabel, institutionLabel: p.institutionLabel, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo })) as StudyPeriod[] : null,
        note: hist.ok ? null : hist.notProvisioned ? "Earlier study contexts are not kept here yet." : "Earlier study contexts could not be read just now.",
      };
    })() : Promise.resolve(null),
  ]);

  const sc: SectionCtx = {
    accent: x.accent, today, verifications: hub === "professional" ? verifications : null, verificationKinds: hub === "professional" ? pp.verificationKinds : [],
    // Documents are Professional records' only (their store and download are Professional's).
    documentKinds: hub === "professional" ? pp.documentKinds : [],
    typeOptions: Object.fromEntries(ITEM_KINDS.map(k => [k, [...itemTypeOptions(pp, k)]])) as SectionCtx["typeOptions"],
    titleOptions: Object.fromEntries(ITEM_KINDS.map(k => [k, [...itemTitleOptions(pp, k)]])) as SectionCtx["titleOptions"],
    orgSuggestions: {}, endpoint: "/api/individual/profile-items", experience: hub,
  };
  const counts = Object.fromEntries(ITEM_KINDS.map(k => [k, chainsOf(view.items, k).live.length]));
  const done = completion(cards, { photo: !!identity.photoPath, headline: !!identity.headline, biography: !!identity.biography, counts });
  const name = identity.preferredName ?? ctx.profile.fullName ?? "Your profile";
  const items = (spec: CardSpec) => !view.provisioned ? <p className="text-[13.5px] text-gray-600">Profile records are not set up here yet.</p>
    : spec.kinds.map((k, i) => (
      <div key={k.kind} className={i ? "mt-5" : ""}>
        {k.heading && <h3 className="mb-1 text-[14px] font-bold text-gray-900">{k.heading}</h3>}
        <ItemBlock items={view.items} kind={k.kind} sc={sc} addLabel={k.add} emptyText={k.empty} unreadable={view.items === null} />
      </div>
    ));
  const cpd = record?.cpd ?? null;
  const learning = passport.learning?.enabled ? passport.learning.items : [];
  const activeLinks = (links ?? []).filter(l => !l.revoked && (!l.expires_at || l.expires_at > new Date().toISOString())).length;

  const body: Record<CardSpec["card"], (s: CardSpec) => React.ReactNode> = {
    personal: s => <Card key={s.card} spec={s} wide><OwnProfileInline accent={x.accent} /></Card>,
    summary: s => (
      <Card key={s.card} spec={s}>
        <dl className="grid gap-3">
          <Fact k="Headline" v={identity.headline} />
          <Fact k="Biography" v={identity.biography ? <span className="whitespace-pre-wrap">{identity.biography}</span> : null} />
        </dl>
        <div className="mt-3"><IdentityEditor fields={["headline", "biography"]} values={{ headline: identity.headline, biography: identity.biography }} accent={x.accent}
          editLabel={identity.headline || identity.biography ? "Edit summary" : "Add a summary"} unavailable={identityReady ? undefined : "Your summary is not set up here yet."} /></div>
        {s.kinds.length > 0 && <div className="mt-5">{items(s)}</div>}
      </Card>
    ),
    education: s => <Card key={s.card} spec={s}>{items(s)}</Card>,
    registration: s => {
      const reg = chainsOf(view.items, "registration").live;
      const primary = record?.profile;
      return (
        <Card key={s.card} spec={s}>
          {primary === null ? <Unreadable what="your primary registration" /> : (
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact k="Registration body" v={primary?.self_declared_registration_body ?? null} />
              <Fact k="Country" v={primary?.self_declared_registration_country ?? null} />
              <Fact k="Renewal due" v={primary?.self_declared_registration_expires_on ? fmt(primary.self_declared_registration_expires_on) : null} />
              <Fact k="Registration number" v={primary?.self_declared_registration_number ? <span className="text-gray-600">Recorded, private</span> : null} />
            </dl>
          )}
          {reg.length > 0 && (
            <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
              {reg.map(c => (
                <li key={c.current.id} className="py-2">
                  <p className="text-[14px] font-semibold text-gray-900">{c.current.title}</p>
                  <p className="text-[12.5px] text-gray-600">{[c.current.organisation, c.current.jurisdiction, c.current.expires_on && `renewal ${fmt(c.current.expires_on)}`].filter(Boolean).join(" · ")}</p>
                  <div className="mt-1 flex flex-wrap gap-2"><StateBadge state={itemState(c.current, today)} />
                    {verifications && <VerificationBadge v={verifications[c.current.id] ?? NO_VERIFICATION} />}</div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[13px]"><Link href={`${experienceHref("professional", "registration")}#sec-reg`} className={linkCls} style={{ color: x.accent }}>Add or change in My practice</Link></p>
        </Card>
      );
    },
    work: s => <Card key={s.card} spec={s}>{items(s)}</Card>,
    skills: s => (
      <Card key={s.card} spec={s}>
        {items(s)}
        {holds.professional && (
          <p className="mt-4 border-t border-gray-100 pt-3 text-[13.5px] text-gray-700">
            {competencies?.entries == null ? "Your competencies could not be read just now." : `${competencies.entries.filter(e => !e.removed_at).length} competencies you are developing.`}{" "}
            <Link href={experienceHref("professional", "competencies")} className={linkCls} style={{ color: x.accent }}>My competencies</Link>
          </p>
        )}
      </Card>
    ),
    training: s => (
      <Card key={s.card} spec={s}>
        {holds.professional && (cpd === null ? <Unreadable what="your CPD" /> : (
          <>
            {cpd.length === 0 ? <p className="text-[13.5px] text-gray-600">No CPD recorded yet.</p> : (
              <ul className="divide-y divide-gray-100">
                {cpd.slice(0, 5).map(c => (
                  <li key={c.id} className="py-2 text-[13.5px]"><span className="font-semibold text-gray-900">{c.title}</span>
                    <span className="text-gray-600"> · {fmt(c.activity_date)}{c.hours != null ? ` · ${c.hours} h` : ""} · {c.evidence_class === "source_linked" ? "document attached, not verified" : "self-declared"}</span></li>
                ))}
              </ul>
            )}
            {record?.provisioned && cfg && plan && hub === "professional" && (
              <AddPanel label="Record CPD" accent={x.accent} suggestOpen={false}>
                <CpdForm accent={x.accent} today={today} goals={(record.goals ?? []).filter(g => g.status === "planned" || g.status === "in_progress").map(g => ({ id: g.id, title: g.title }))}
                  options={{ types: recordableTypes(cfg, ready), flexible: ready, plan: plan.provisioned ? { activities: openActivities(plan) } : null }} />
              </AddPanel>
            )}
            <p className="mt-2 text-[13px]">{cpd.length > 5 ? `${cpd.length} entries in all. ` : ""}<Link href={experienceHref("professional", "cpd")} className={linkCls} style={{ color: x.accent }}>Learning &amp; CPD</Link></p>
          </>
        ))}
        {learning === null ? <Unreadable what="your Competen Learning courses" /> : learning.length > 0 && (
          <ul className={`divide-y divide-gray-100 ${holds.professional ? "mt-3 border-t border-gray-100" : ""}`}>
            {learning.slice(0, 5).map(l => <li key={l.recordId} className="py-2 text-[13.5px]"><span className="font-semibold text-gray-900">{l.title}</span><span className="text-gray-600"> · {fmt(l.date)} · {l.evidenceLabel}</span></li>)}
          </ul>
        )}
        {!holds.professional && learning !== null && learning.length === 0 && <p className="text-[13.5px] text-gray-600">Courses you complete in Competen Learning appear here.</p>}
      </Card>
    ),
    objectives: s => <Card key={s.card} spec={s}>{items(s)}</Card>,
    portfolio: s => (
      <Card key={s.card} spec={s}>
        <ul className="grid gap-2 text-[13.5px] text-gray-800">
          <li>Issued or verified by organisations: <span className="font-semibold">{passport.competencies === null || passport.credentials === null ? "could not be read" : passport.competencies.filter(c => c.current).length + passport.credentials.length}</span></li>
          <li>Recorded by you: <span className="font-semibold">{(cpd?.length ?? 0) + (record?.evidence?.length ?? 0) + Object.values(counts).reduce((a, b) => a + b, 0)}</span> <span className="text-gray-500">(self-declared, never verified by being entered)</span></li>
          {holds.scholar && <li>{EVIDENCE_LABEL.self_directed}: <span className="font-semibold">{passport.study.ok ? passport.study.data.length : "could not be read"}</span></li>}
          <li>Active Passport links: <span className="font-semibold">{links === null ? "could not be read" : activeLinks}</span></li>
        </ul>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <Link href={experienceHref(experience, "passport")} className={actionCls} style={{ color: x.accent }}>Your Passport</Link>
          <Link href={hub === "scholar" ? experienceHref("scholar", "passport/share") : experienceHref("professional", "share")} className={actionCls} style={{ color: x.accent }}>Share chosen records</Link>
          {holds.professional && <Link href={`${experienceHref("professional", "progress/documents")}?origin=passport`} className={actionCls} style={{ color: x.accent }}>Create a document</Link>}
        </p>
        <p className="mt-3 text-[12.5px] text-gray-500">Nothing here leaves your account unless you choose it, record by record, on a Passport link.</p>
      </Card>
    ),
    studies: s => <Card key={s.card} spec={s}>{study && <StudyContext accent={x.accent} options={study.options} current={study.current} periods={study.periods} historyNote={study.note} />}</Card>,
  };

  return (
    <>
      <header id="profile-header" className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <PhotoControl name={name} version={identity.photoPath ? identity.photoUpdatedAt ?? identity.photoPath : null} accent={x.accent} available={identityReady} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: x.accent }}>Profile &amp; history</p>
            <h1 className="mt-1 break-words text-[26px] font-bold leading-tight text-gray-900">{name}</h1>
            {identity.preferredName && ctx.profile.fullName && identity.preferredName !== ctx.profile.fullName && <p className="text-[13px] text-gray-500">{ctx.profile.fullName}</p>}
            <p className="mt-1 text-[15px] text-gray-800">{identity.headline ?? <span className="text-gray-500">Professional headline · Add your role or specialisation</span>}</p>
            {identity.location && <p className="text-[13.5px] text-gray-600">{identity.location}</p>}
            <ul className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start" aria-label="Your experiences">
              {ctx.live.map(e => <li key={e} className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: EXPERIENCES[e].accentSoft, color: EXPERIENCES[e].accent }}>{EXPERIENCES[e].name}</li>)}
            </ul>
            <div className="mt-3 flex justify-center sm:justify-start">
              <IdentityEditor fields={["preferred_name", "headline", "location"]} values={{ preferred_name: identity.preferredName, headline: identity.headline, location: identity.location }}
                accent={x.accent} editLabel="Edit profile" unavailable={identityReady ? undefined : "Editing your headline and photo is not set up here yet."} />
            </div>
          </div>
        </div>
        <div className="mt-4 border-t border-gray-100 pt-3 text-[13px] text-gray-600">
          <p>Your profile is {done.done} of {done.total} complete. Everything is optional{done.prompts.length ? ": next you could" : "."}</p>
          {done.prompts.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-2">
              {done.prompts.map(p => <li key={p.key}><a href={`#${p.target}`} className="inline-flex min-h-[32px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-full border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50">{p.text}</a></li>)}
            </ul>
          )}
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {cards.map(s => body[s.card](s))}
      </div>

      <section aria-labelledby="labels-h" className="mt-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 id="labels-h" className="text-[16px] font-bold text-gray-900">How your records are labelled</h2>
        <ul className="mt-2 flex flex-wrap gap-2">{RECORD_STATES.map(st => <li key={st}><StateBadge state={st} /></li>)}</ul>
        <p className="mt-3 text-[13.5px] text-gray-700">
          What you add is shown as recorded by you, and a document attached to it is shown as attached, not checked. Records an organisation issued or verified
          come from your Passport and say so. Only an independent verifier makes a record verified{holds.professional ? ", when you ask from My practice" : ""}.
          Changing a record keeps the earlier version, and withdrawing one keeps it in its history.
        </p>
      </section>

      <section id="history" aria-labelledby="history-h" className="mt-5 scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 id="history-h" className="text-[16px] font-bold text-gray-900">Development history</h2>
        <p className="mt-0.5 text-[12.5px] text-gray-500">Newest first, and read-only: kept apart from your editable profile, and kept when you graduate, add an experience or return to study.</p>
        {partial && <div className="mt-3"><Unreadable what="full history" /></div>}
        {history.length === 0 ? <p className="mt-3 text-[14px] text-gray-600">Nothing dated on your record yet.</p> : (
          <ol className="mt-4 space-y-4 border-l-2 pl-5" style={{ borderColor: x.accentSoft }}>
            {history.map((h, i) => (
              <li key={`${h.date}-${i}`} className="relative">
                <span aria-hidden className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-2 ring-white" style={{ background: x.accent }} />
                <p className="text-[12px] font-semibold text-gray-500"><time dateTime={h.date}>{fmt(h.date)}</time></p>
                <p className="text-[14.5px] font-semibold text-gray-900">{h.title}</p>
                <p className="text-[12.5px] text-gray-600">{[h.detail, h.source].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
