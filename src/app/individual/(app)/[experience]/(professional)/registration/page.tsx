import { EXPERIENCES } from "@/lib/individual/experiences";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable } from "../../../../_components/chrome";
import { ApiForm, Field, inputCls } from "../../../../_components/professional/forms";
import { ClassLabel, NotProvisioned, Section, fmtDate } from "../../../../_components/professional/bits";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// PROFESSION AND REGISTRATION -- COMPETEN-IND-007 s1, owner ruling D5.
//
// The person's own professional identity record, every field self-declared (migration 270's vocabulary
// carried into migration 373). The page says plainly that nothing here was checked against a register,
// because no regulator lookup is connected: that is a governed empty state, not a missing button.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Profession & registration" }); }

export default async function RegistrationPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "registration");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const record = await loadProfessionalRecord(ctx.admin, ctx.userId);
  const p = record.profile;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your professional record" title="Profession & registration"
        intro="Who you are professionally, in your own words. This record is yours: it stays with you between organisations, and no employer can see it unless you share your Passport." />
      {!record.provisioned && <NotProvisioned />}

      <Section title="Your details" note="Self-declared. Competen has not checked these against any register.">
        {p === null ? <Unreadable what="professional details" /> : !record.provisioned ? null : (
          <>
            <div className="mb-4"><ClassLabel value="self_declared" /></div>
            <ApiForm action="/api/individual/professional/profile" method="PUT" submitLabel="Save my details" accent={x.accent} reset={false}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Profession" htmlFor="pr-prof" hint="For example: Registered nurse, Midwife, Clinical officer.">
                  <input id="pr-prof" name="profession" maxLength={120} defaultValue={p?.self_declared_profession ?? ""} className={inputCls} />
                </Field>
                <Field label="Country of registration" htmlFor="pr-country">
                  <input id="pr-country" name="country" maxLength={80} defaultValue={p?.self_declared_registration_country ?? ctx.profile.country ?? ""} className={inputCls} autoComplete="country-name" />
                </Field>
                <Field label="Registration body" htmlFor="pr-body" hint="The council or board you are registered with.">
                  <input id="pr-body" name="registrationBody" maxLength={160} defaultValue={p?.self_declared_registration_body ?? ""} className={inputCls} />
                </Field>
                <Field label="Registration number" htmlFor="pr-num">
                  <input id="pr-num" name="registrationNumber" maxLength={60} defaultValue={p?.self_declared_registration_number ?? ""} className={inputCls} autoComplete="off" />
                </Field>
                <Field label="Registration renewal date (optional)" htmlFor="pr-exp" hint="You are reminded 60 days before: in Competen, and by email if you turn that on under Credentials & evidence → Reminders.">
                  <input id="pr-exp" name="registrationExpiresOn" type="date" defaultValue={p?.self_declared_registration_expires_on ?? ""} className={inputCls} />
                </Field>
              </div>
            </ApiForm>
            {p?.updated_at && <p className="mt-3 text-[12.5px] text-gray-500">Last changed {fmtDate(p.updated_at)}.</p>}
          </>
        )}
      </Section>

      <Section title="Checking your registration">
        <p className="text-[14px] text-gray-700">
          Competen does not yet check registrations with any regulator, so your registration is shown everywhere,
          including your Passport and any link you share, as declared by you. When independent verification exists,
          it will appear here as a separate, labelled record.
        </p>
      </Section>
    </>
  );
}
