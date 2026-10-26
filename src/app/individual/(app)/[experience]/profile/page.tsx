import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { buildHistory, loadEntitlementHistory } from "@/lib/individual/history";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadProfessionalProfile } from "@/lib/individual/professional/profile-store";
import { loadVerifications } from "@/lib/individual/professional/profile-verification";
import { chainsOf } from "@/lib/individual/professional/profile-records";
import { itemTitleOptions, itemTypeOptions } from "@/lib/individual/professional/profile-form";
import { ITEM_KINDS, RECORD_STATES } from "@/lib/individual/professional/profile-vocabulary";
import { completion, hubSections, toHubExperience } from "@/lib/individual/profile-hub";
import { loadJoinOptions, contextHistory } from "@/lib/individual/scholar/context";
import { learnerContextPointer } from "@/lib/individual/scholar/store";
import { experiencePage, gatedMetadata } from "../../../_components/shell-context";
import type { Metadata } from "next";
import { PageHeader, Unreadable } from "../../../_components/chrome";
import { ItemBlock, StateBadge, type SectionCtx } from "../../../_components/professional/profile-sections";
import { OwnProfileInline } from "@/components/account/OwnProfileCard";
import StudyContext, { type StudyOptions, type StudyPeriod } from "../../../_components/profile/StudyContext";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// PROFILE & HISTORY -- COMPETEN-IND-003 s2(4), redesigned as the shared, editable personal profile and development
// hub (COMPETEN-INDIVIDUAL-PROFILE-HFE, owner directive 26 Oct).
//
//   1. Your details    the one Competen identity (profiles), edited in place through /api/account/profile. Email
//                      only through Supabase's verified change flow.
//   2. The experience's own context: Scholar studies (387/402, with history) or the Professional overview (450).
//   3. Repeatable sections (450 records, either experience), in the configured order: edited in place through
//      /api/individual/profile-items. Self-declared or document-supported, never verified by being entered.
//   4. Development history  src/lib/individual/history.ts: read-only, kept apart from everything editable.
//
// Nothing is required here. Every section can be left empty and filled in whenever the person wants.

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Profile & history" }); }

function Card({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mb-5 scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id={`${id}-h`} className="text-[16px] font-bold text-gray-900">{title}</h2>
      {note && <p className="mt-0.5 text-[12.5px] text-gray-500">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function ProfilePage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experiencePage((await params).experience);
  if (!page) return null;
  const { ctx, experience } = page;
  const x = EXPERIENCES[experience];
  const hub = toHubExperience(experience)!;
  const today = new Date().toISOString().slice(0, 10);
  const [passport, entitlements, policy, view] = await Promise.all([
    loadIndividualPassport(ctx.admin, ctx.userId, today),
    loadEntitlementHistory(ctx.admin, ctx.userId),
    loadIndividualPolicy(ctx.admin),
    loadProfessionalProfile(ctx.admin, ctx.userId),
  ]);
  const history = buildHistory({ joinedAt: ctx.membership.grantedAt, entitlements, passport });
  const partial = entitlements === null || passport.competencies === null || passport.credentials === null || passport.employment === null;
  const pp = policy.professionalProfile;
  const sections = hubSections(pp.sections, hub);

  // The experience's own context.
  let study: { options: StudyOptions | null; current: { programme: string | null; level: string | null; institution: string | null }; periods: StudyPeriod[] | null; note: string | null } | null = null;
  const holds = (e: "scholar" | "professional") => ctx.live.includes(e);
  if (holds("scholar")) {
    const [opts, ptr, hist] = await Promise.all([loadJoinOptions(ctx.admin, policy), learnerContextPointer(ctx.admin, ctx.userId), contextHistory(ctx.admin, ctx.userId)]);
    const options = opts.ok ? opts.options : null;
    const name = (code: string) => options?.programmes.find(p => p.code === code)?.label ?? code;
    study = {
      options,
      current: ptr.ok && ptr.data ? { programme: ptr.data.programme_code, level: ptr.data.level_code, institution: ptr.data.institution_code } : { programme: null, level: null, institution: null },
      periods: hist.ok ? hist.periods.map(p => ({ programmeLabel: name(p.programmeCode), levelLabel: p.levelLabel, institutionLabel: p.institutionLabel, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo })) : null,
      note: hist.ok ? null : hist.notProvisioned ? "Earlier study contexts are not kept here yet." : "Earlier study contexts could not be read just now.",
    };
  }
  const verifications = hub === "professional" && view.provisioned ? await loadVerifications(ctx.admin, ctx.userId, today) : null;

  const sc: SectionCtx = {
    accent: x.accent, today, verifications, verificationKinds: hub === "professional" ? pp.verificationKinds : [],
    // Documents are Professional records' only (their store and download are Professional's).
    documentKinds: hub === "professional" ? pp.documentKinds : [],
    typeOptions: Object.fromEntries(ITEM_KINDS.map(k => [k, [...itemTypeOptions(pp, k)]])) as SectionCtx["typeOptions"],
    titleOptions: Object.fromEntries(ITEM_KINDS.map(k => [k, [...itemTitleOptions(pp, k)]])) as SectionCtx["titleOptions"],
    orgSuggestions: { registration: pp.registrationBodies.map(o => o.label) },
    endpoint: "/api/individual/profile-items", experience: hub,
  };
  const counts = Object.fromEntries(ITEM_KINDS.map(k => [k, chainsOf(view.items, k).live.length]));
  const done = completion(sections, counts);
  const ptr = view.pointer;
  const proFacts: [string, string | null][] = ptr ? [
    ["Profession", ptr.self_declared_profession ?? null], ["Primary specialty", ptr.self_declared_primary_specialty ?? null],
    ["Professional title", ptr.self_declared_professional_title ?? null], ["Current role", ptr.self_declared_current_role ?? null],
  ] : [];

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your foundation" title="Profile & history"
        intro="One Competen identity, one profile and one history, shared by every experience on your account. Fill it in whenever you like: nothing here is required." />

      <nav aria-label="Profile sections" className="mb-5 flex flex-wrap gap-2">
        {[["details", "Your details"], ...sections.map(s => [`sec-${s.section}`, s.title]), ["history", "Development history"]].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-full border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50">{label}</a>
        ))}
      </nav>

      {done.total > 0 && (
        <p className="mb-5 text-[13px] text-gray-600">
          You have started {done.started} of {done.total} profile sections. Add more whenever it suits you: every section is optional.
        </p>
      )}

      <Card id="details" title="Your details">
        <OwnProfileInline accent={x.accent} />
      </Card>

      {sections.map(s => s.section === "overview" ? (
        <div key="overview">
          {(hub === "scholar" ? ["scholar", "professional"] as const : ["professional", "scholar"] as const).filter(holds).map(e => e === "scholar" ? (
            <Card key="studies" id={e === hub ? "sec-overview" : "sec-studies"} title="Your studies" note="What and where you study. Changing it later keeps your earlier study in the context it was done in.">
              {study && <StudyContext accent={x.accent} options={study.options} current={study.current} periods={study.periods} historyNote={study.note} />}
            </Card>
          ) : (
            <Card key="practice" id={e === hub ? "sec-overview" : "sec-practice"} title="Your practice" note="Self-declared. Your full overview and primary registration are in My practice.">
              {!view.provisioned ? <p className="text-[13.5px] text-gray-600">The professional profile is not set up here yet.</p>
                : ptr === null ? <Unreadable what="professional overview" />
                : ptr === undefined ? (
                  <p className="text-[13.5px] text-gray-700">
                    No professional overview yet.{" "}
                    <Link href={experienceHref("professional", "registration")} className="font-semibold underline-offset-2 hover:underline" style={{ color: x.accent }}>Add it in My practice</Link>, whenever you like.
                  </p>
                ) : (
                <>
                  <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                    {proFacts.map(([k, v]) => (
                      <div key={k}><dt className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{k}</dt>
                        <dd className="text-[14.5px] text-gray-900">{v ?? <span className="italic text-gray-500">Not recorded</span>}</dd></div>
                    ))}
                  </dl>
                  <p className="mt-3 text-[13px]">
                    <Link href={`${experienceHref("professional", "registration")}#sec-overview`} className="font-semibold underline-offset-2 hover:underline" style={{ color: x.accent }}>
                      Change your overview or primary registration
                    </Link>
                  </p>
                </>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card key={s.section} id={`sec-${s.section}`} title={s.title} note={s.note}>
          {!view.provisioned ? <p className="text-[13.5px] text-gray-600">Profile records are not set up here yet.</p> : s.section === "registrations" ? (
            // HFE-01 Wave 3 (D2): registrations and licences have one home, My practice.
            <p className="text-[13.5px] text-gray-700">Your registrations and licences are kept in{" "}
              <Link href={`${experienceHref("professional", "registration")}#sec-reg`} className="font-semibold underline-offset-2 hover:underline" style={{ color: x.accent }}>My practice</Link>. Add, change or ask for verification there.</p>
          ) : s.kinds.map((k, i) => (
            <div key={k.kind} className={i ? "mt-6" : ""}>
              {k.heading && <h3 className="mb-1 text-[14px] font-bold text-gray-900">{k.heading}</h3>}
              <ItemBlock items={view.items} kind={k.kind} sc={sc} addLabel={k.add} emptyText={k.empty} unreadable={view.items === null} />
            </div>
          ))}
        </Card>
      ))}

      <Card id="labels" title="How your records are labelled">
        <ul className="flex flex-wrap gap-2">{RECORD_STATES.map(st => <li key={st}><StateBadge state={st} /></li>)}</ul>
        <p className="mt-3 text-[13.5px] text-gray-700">
          Everything you add here is shown as recorded by you. Attaching a document does not verify it, and nothing becomes verified by being entered.
          {hub === "professional" ? " You can ask Competen to verify a qualification, registration or role: an independent verifier checks that version, and only then is it shown as verified." : ""}
          {" "}Changing a record keeps the earlier version, and withdrawing one keeps it in its history.
        </p>
      </Card>

      <Card id="history" title="Development history" note="Newest first, and read-only: it is kept apart from your editable profile, and keeps everything when you graduate, add an experience or return to study.">
        {partial && <div className="mb-3"><Unreadable what="full history" /></div>}
        {history.length === 0 ? (
          <p className="text-[14px] text-gray-600">Nothing dated on your record yet.</p>
        ) : (
          <ol className="mt-1 space-y-4 border-l-2 pl-5" style={{ borderColor: x.accentSoft }}>
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
      </Card>
    </>
  );
}
