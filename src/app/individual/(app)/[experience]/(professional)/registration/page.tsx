import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable } from "../../../../_components/chrome";
import { ApiForm, Field, inputCls } from "../../../../_components/professional/forms";
import { ClassLabel, NotProvisioned, Section, fmtDate } from "../../../../_components/professional/bits";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadSuggestions } from "@/lib/individual/professional/suggestions";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { loadProfessionalProfile } from "@/lib/individual/professional/profile-store";
import { loadCatalogueSuggestions } from "@/lib/individual/professional/catalogue-suggestions";
import { loadVerifications } from "@/lib/individual/professional/profile-verification";
import { chainsOf } from "@/lib/individual/professional/profile-records";
import { itemTitleOptions, itemTypeOptions, registrationSteps } from "@/lib/individual/professional/profile-form";
import { FIELD_LABEL, ITEM_KINDS, OPTIONAL_FIELDS, RECORD_STATES, REQUIRED_FIELDS, SECTION_LABEL, type ItemKind, type ProfileSection } from "@/lib/individual/professional/profile-vocabulary";
import ContextField from "../../../../_components/professional/ContextField";
import SummaryAssist from "../../../../_components/professional/SummaryAssist";
import { fieldProps } from "../../../../_components/professional/registration";
import { ContextHistory, ItemBlock, OrganisationRecords, StateBadge, credentialRows, employmentRows, type SectionCtx } from "../../../../_components/professional/profile-sections";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// THE PROFESSIONAL PROFILE -- COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1 (GO s4, s5, s6, s9), on the segment the
// Professional MVP gave "Profession & registration" (COMPETEN-IND-007 s1, owner ruling D5).
//
// Six sections in the order configuration sets: overview, qualifications, registration and licensing,
// practice and employment, specialties and interests, career aspirations. Each record is self-declared (or
// document-supported) and says so. Changing one keeps the earlier version. What an organisation issued or
// verified is shown beside it from the Passport, read-only.
//
// ⚠ BEFORE MIGRATION 450 THIS PAGE IS THE MVP PAGE, UNCHANGED: the profession and primary registration form,
// and nothing that needs 450. The primary registration form stays the same either way, so 373/374's renewal
// reminders keep working on it.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "My practice" }); }

export default async function RegistrationPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "registration");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  // Suggestions only: both fields stay free text (COMPETEN-CONFIG-002 item 8, migration 013 vocabularies).
  const [record, policy, suggestions, view, passport] = await Promise.all([
    loadProfessionalRecord(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin), loadSuggestions(ctx.admin),
    loadProfessionalProfile(ctx.admin, ctx.userId), loadIndividualPassport(ctx.admin, ctx.userId, today),
  ]);
  const p = record.profile;
  const pp = policy.professionalProfile;

  const primaryRegistration = (
    <>
      {p === null ? <Unreadable what="professional details" /> : !record.provisioned ? null : (
        <>
          <div className="mb-4"><ClassLabel value="self_declared" /></div>
          <ApiForm action="/api/individual/professional/profile" method="PUT" submitLabel="Save my registration" accent={x.accent} reset={false}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Profession" htmlFor="pr-prof" hint="For example: Registered nurse, Midwife, Clinical officer.">
                <input id="pr-prof" name="profession" maxLength={120} defaultValue={p?.self_declared_profession ?? ""} className={inputCls} list={suggestions.profession.length ? "pr-prof-options" : undefined} autoComplete="off" />
                {suggestions.profession.length > 0 && <datalist id="pr-prof-options">{suggestions.profession.map(v => <option key={v} value={v} />)}</datalist>}
              </Field>
              <Field label="Country of registration" htmlFor="pr-country">
                <input id="pr-country" name="country" maxLength={80} defaultValue={p?.self_declared_registration_country ?? ctx.profile.country ?? ""} className={inputCls} autoComplete="country-name" />
              </Field>
              <Field label="Registration body" htmlFor="pr-body" hint="The council or board you are registered with.">
                <input id="pr-body" name="registrationBody" maxLength={160} defaultValue={p?.self_declared_registration_body ?? ""} className={inputCls} list={suggestions.registrationBody.length ? "pr-body-options" : undefined} autoComplete="off" />
                {suggestions.registrationBody.length > 0 && <datalist id="pr-body-options">{suggestions.registrationBody.map(v => <option key={v} value={v} />)}</datalist>}
              </Field>
              <Field label="Registration number" htmlFor="pr-num">
                <input id="pr-num" name="registrationNumber" maxLength={60} defaultValue={p?.self_declared_registration_number ?? ""} className={inputCls} autoComplete="off" />
              </Field>
              <Field label="Registration renewal date (optional)" htmlFor="pr-exp" hint={`You are reminded ${policy.reminderHorizonDays} days before: in Competen, and by email if you turn that on under Credentials & evidence → Reminders.`}>
                <input id="pr-exp" name="registrationExpiresOn" type="date" defaultValue={p?.self_declared_registration_expires_on ?? ""} className={inputCls} />
              </Field>
            </div>
          </ApiForm>
          {p?.updated_at && <p className="mt-3 text-[12.5px] text-gray-500">Last changed {fmtDate(p.updated_at)}.</p>}
        </>
      )}
    </>
  );

  // ── Before 450: the MVP page, unchanged ──
  if (!view.provisioned) {
    return (
      <>
        <PageHeader accent={x.accent} eyebrow="Your professional record" title="Profession & registration"
          intro="Who you are professionally, in your own words. This record is yours: it stays with you between organisations, and no employer can see it unless you share your Passport." />
        {!record.provisioned && <NotProvisioned />}
        <Section title="Your details" note="Self-declared. Competen has not checked these against any register.">{primaryRegistration}</Section>
        <VerificationNote />
      </>
    );
  }

  const ptr = view.pointer;
  const unreadable = view.items === null;
  const specialties = [ptr?.self_declared_primary_specialty, ...chainsOf(view.items, "specialty").live.map(c => c.current.title), ...chainsOf(view.items, "interest").live.map(c => c.current.title)]
    .filter((v): v is string => !!v);
  const [catalogues, verifications] = await Promise.all([
    loadCatalogueSuggestions(ctx.admin, { profession: ptr?.self_declared_profession ?? null, specialties }),
    loadVerifications(ctx.admin, ctx.userId, today),
  ]);

  const sc: SectionCtx = {
    accent: x.accent, today, documentKinds: pp.documentKinds, verifications, verificationKinds: pp.verificationKinds,
    typeOptions: Object.fromEntries(ITEM_KINDS.map(k => [k, [...itemTypeOptions(pp, k)]])) as SectionCtx["typeOptions"],
    titleOptions: Object.fromEntries(ITEM_KINDS.map(k => [k, [...itemTitleOptions(pp, k)]])) as SectionCtx["titleOptions"],
    orgSuggestions: { registration: [...pp.registrationBodies.map(o => o.label), ...suggestions.registrationBody] },
  };
  const block = (kind: ItemKind, addLabel: string, emptyText: string) =>
    <ItemBlock items={view.items} kind={kind} sc={sc} addLabel={addLabel} emptyText={emptyText} unreadable={unreadable} />;
  const overviewFields = registrationSteps({ ...pp, registrationFields: [...OPTIONAL_FIELDS], registrationRequired: [] }).flatMap(s => s.fields);
  const facts = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map(f => {
    const spec = overviewFields.find(s => s.key === f)!;
    const v = fieldProps(spec, ptr, suggestions).value;
    return [FIELD_LABEL[f], v === null || v === "" ? null : f === "years" ? `${v} (as of ${fmtDate(ptr?.updated_at) ?? "when recorded"})` : String(v)] as const;
  });

  const SECTIONS: Record<ProfileSection, React.ReactNode> = {
    overview: (
      <Section key="overview" id="sec-overview" title={SECTION_LABEL.overview} note="Self-declared. Change any of it at any time: the earlier version is kept.">
        {ptr === null ? <Unreadable what="professional overview" /> : (
          <>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k}><dt className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{k}</dt>
                  <dd className="text-[14.5px] text-gray-900">{v ?? <span className="text-gray-500">Not recorded</span>}</dd></div>
              ))}
            </dl>
            {ptr?.self_declared_summary && <p className="mt-4 whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">{ptr.self_declared_summary}</p>}
            {!ptr?.registration_completed_at && (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
                Your registration is not finished. <Link href={experienceHref("professional")} className="font-semibold underline">Continue on your Professional home</Link>.
              </p>
            )}
            <details className="mt-4 rounded-xl border border-gray-200 p-4">
              <summary className="cursor-pointer text-[14px] font-semibold" style={{ color: x.accent }}>Change my overview</summary>
              <div className="mt-4">
                <ApiForm action="/api/individual/professional/context" method="PUT" submitLabel="Save my overview" accent={x.accent} reset={false} savedText="Saved. Your earlier details are kept in your history.">
                  <input type="hidden" name="step" value="overview" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    {overviewFields.map(f => <ContextField key={f.key} {...fieldProps({ ...f, required: (REQUIRED_FIELDS as readonly string[]).includes(f.key) }, ptr, suggestions)} />)}
                  </div>
                  <Field label="Professional summary (optional)" htmlFor="ov-summary" hint="A few lines about you as a professional, in your own words.">
                    <textarea id="ov-summary" name="summary" rows={5} maxLength={2000} defaultValue={ptr?.self_declared_summary ?? ""} className={inputCls} />
                  </Field>
                </ApiForm>
                {pp.ai === "on" && <div className="mt-4"><SummaryAssist accent={x.accent} targetId="ov-summary" /></div>}
              </div>
            </details>
            <ContextHistory history={view.history} />
          </>
        )}
      </Section>
    ),
    qualifications: (
      <Section key="qualifications" id="sec-qual" title={SECTION_LABEL.qualifications} note="Add as many as you hold. A document makes a record document-supported, never verified.">
        {block("qualification", "Add a qualification", "No qualifications recorded yet. Add them whenever you like: nothing in Competen Professional waits on them.")}
        <OrganisationRecords title="Credentials on your Passport" rows={credentialRows(passport.credentials)} />
      </Section>
    ),
    registrations: (
      <Section key="registrations" id="sec-reg" title={SECTION_LABEL.registrations} note="Self-declared. Competen does not check registrations with any regulator.">
        <h3 className="text-[14px] font-bold text-gray-900">Primary registration</h3>
        <p className="mb-3 text-[12.5px] text-gray-500">The one your renewal reminders follow. Changing it keeps the earlier one in your history.</p>
        {primaryRegistration}
        <h3 className="mt-6 text-[14px] font-bold text-gray-900">Other registrations and licences</h3>
        {block("registration", "Add a registration or licence", "None recorded. Add another country's registration, a specialist register or a licence here.")}
      </Section>
    ),
    employment: (
      <Section key="employment" id="sec-emp" title={SECTION_LABEL.employment} note="Every role keeps its own period. Ending one or starting another never removes the earlier record.">
        {block("employment", "Add a role or employment period", "No roles recorded yet.")}
        <OrganisationRecords title="Employment recorded by organisations" rows={employmentRows(passport.employment)} />
      </Section>
    ),
    specialties: (
      <Section key="specialties" id="sec-spec" title={SECTION_LABEL.specialties} note={ptr?.self_declared_primary_specialty ? `Primary specialty: ${ptr.self_declared_primary_specialty} (change it in the overview).` : "Set a primary specialty in the overview, and add others here."}>
        <h3 className="text-[14px] font-bold text-gray-900">Specialties and practice areas</h3>
        {block("specialty", "Add a specialty", "No further specialties recorded.")}
        <h3 className="mt-6 text-[14px] font-bold text-gray-900">Professional interests</h3>
        {block("interest", "Add an interest", "No interests recorded.")}
      </Section>
    ),
    aspirations: (
      <Section key="aspirations" id="sec-asp" title={SECTION_LABEL.aspirations} note="Where you want your career to go. Private to you.">
        {block("aspiration", "Add an aspiration", "No aspirations recorded yet.")}
        <p className="mt-3 text-[12.5px] text-gray-500">To work towards one, add a development need and goals under <Link href={experienceHref("professional", "development")} className="font-semibold underline">Needs &amp; plan</Link>.</p>
      </Section>
    ),
  };

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your professional record" title="My practice"
        intro="Your professional identity, built up over time and in your own words. It stays with you between organisations, keeps every earlier version, and no employer can see it unless you share your Passport." />
      <nav aria-label="Profile sections" className="mb-5 flex flex-wrap gap-2">
        {pp.sections.map(s => <a key={s} href={`#sec-${{ overview: "overview", qualifications: "qual", registrations: "reg", employment: "emp", specialties: "spec", aspirations: "asp" }[s]}`}
          className="rounded-full border border-gray-300 bg-white px-3 py-1 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50">{SECTION_LABEL[s]}</a>)}
      </nav>
      {pp.sections.map(s => SECTIONS[s])}

      <Section title="Competency catalogues for you" note="Suggested from your profession and specialties. Optional: nothing in Competen Professional requires one.">
        {catalogues === null ? <Unreadable what="catalogue suggestions" />
          : catalogues.length === 0 ? <p className="text-[14px] text-gray-600">No competency catalogue is offered for your profile yet. Everything else works without one.</p>
          : (
            <ul className="space-y-2">
              {catalogues.map(c => (
                <li key={c.frameworkId} className="text-[14px] text-gray-800">
                  <span className="font-semibold">{c.name}</span> <span className="text-[12.5px] text-gray-600">· {c.reasons.join(" · ")}</span>
                </li>
              ))}
              <li className="pt-1 text-[12.5px] text-gray-500">Link a development need or evidence to one of its competencies under <Link href={experienceHref("professional", "development")} className="font-semibold underline">Needs &amp; plan</Link>.</li>
            </ul>
          )}
      </Section>
      <VerificationNote />
    </>
  );
}

function VerificationNote() {
  return (
    <Section title="How your records are labelled">
      <ul className="flex flex-wrap gap-2">{RECORD_STATES.map(s => <li key={s}><StateBadge state={s} /></li>)}</ul>
      <p className="mt-3 text-[14px] text-gray-700">
        Everything you add is shown as recorded by you, and attaching a document does not verify it. You can ask Competen to verify a qualification,
        registration or role: a Competen verifier, independent of you, checks that version and records the outcome, and only then is it shown as
        independently verified. If you change the record later, the new version starts unverified. Records an organisation issued or verified come
        from your Passport and are labelled as such. Verification is optional and never stops you using Competen Professional.
      </p>
    </Section>
  );
}
