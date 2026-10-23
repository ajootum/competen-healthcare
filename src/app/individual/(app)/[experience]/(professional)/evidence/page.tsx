import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { loadSharedFrameworks, referenceNames } from "@/lib/individual/professional/frameworks";
import { EVIDENCE_KIND, REMINDER_HORIZON_DAYS } from "@/lib/individual/professional/vocabulary";
import { isExpired, isExpiringSoon } from "@/lib/engines/competency";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing } from "../../../../_components/chrome";
import { ApiButton, ApiForm, Field, inputCls } from "../../../../_components/professional/forms";
import FrameworkPicker from "../../../../_components/professional/FrameworkPicker";
import { ClassLabel, Empty, NotProvisioned, Section, fmtDate } from "../../../../_components/professional/bits";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// CREDENTIALS AND COMPETENCY EVIDENCE -- COMPETEN-IND-007 s4.
//
// What the person keeps themselves: credentials with renewal dates, and evidence of their own competence,
// optionally against a shared framework competency or one of their development needs. Each item states its
// class -- self-declared, or self-declared with a document attached. NEVER verified: nothing here checks a
// document or contacts an issuer. Credentials an ORGANISATION verified for the person are the estate's and
// appear in the Passport, labelled by issuer (owner ruling D3).
//
// Expiry uses the shared competency engine's date rules (src/lib/engines/competency.ts) over the
// reminder horizon, so this page and the emailed reminder agree on what "expires soon" means.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Credentials & evidence" }); }

export default async function EvidencePage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "evidence");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  const [record, frameworks] = await Promise.all([loadProfessionalRecord(ctx.admin, ctx.userId), loadSharedFrameworks(ctx.admin)]);
  const evidence = record.evidence;
  const names = evidence ? await referenceNames(ctx.admin,
    [...new Set(evidence.map(e => e.framework_id).filter((v): v is string => !!v))],
    [...new Set(evidence.map(e => e.framework_competency_id).filter((v): v is string => !!v))]) : new Map<string, string>();
  const needTitle = new Map((record.needs ?? []).map(n => [n.id, n.title]));
  const openNeeds = (record.needs ?? []).filter(n => n.status === "open");
  const due = (evidence ?? []).filter(e => e.kind === "credential" && e.expires_on && (isExpired(e.expires_on) || isExpiringSoon(e.expires_on, REMINDER_HORIZON_DAYS)));
  const reg = record.profile?.self_declared_registration_expires_on ?? null;
  const regDue = reg && (isExpired(reg) || isExpiringSoon(reg, REMINDER_HORIZON_DAYS)) ? reg : null;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your evidence" title="Credentials & evidence"
        intro="Your qualifications, licences and certificates, and the evidence you keep of your own competence. Items you add are recorded by you and are not verified." />
      {!record.provisioned && <NotProvisioned />}

      {(due.length > 0 || regDue) && (
        <section aria-label="Renewals due" className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-[15px] font-bold text-amber-900">Renewals due</h2>
          <ul className="mt-2 space-y-1 text-[14px] text-amber-900">
            {regDue && <li>Your registration {regDue < today ? "expired" : "renews"} on {fmtDate(regDue)}. <Link href={experienceHref("professional", "registration")} className={`font-semibold underline ${focusRing}`}>Update it</Link></li>}
            {due.map(e => <li key={e.id}>{e.title} {e.expires_on! < today ? "expired" : "expires"} on {fmtDate(e.expires_on)}.</li>)}
          </ul>
          <p className="mt-2 text-[12.5px] text-amber-900/80">From the dates you recorded. Competen has not checked them with the issuer.</p>
        </section>
      )}

      {EVIDENCE_KIND.map(([kind, label]) => {
        const items = evidence?.filter(e => e.kind === kind) ?? [];
        return (
          <Section key={kind} title={kind === "credential" ? "Credentials & registrations" : "Competency evidence"}
            note={kind === "credential" ? "Qualifications, licences and certificates you hold." : "What you have done that shows your competence, in your own words."}>
            {evidence === null ? <Unreadable what="evidence" /> : items.length === 0 ? <Empty>No {label.toLowerCase()} recorded yet.</Empty> : (
              <ul className="divide-y divide-gray-100">
                {items.map(e => (
                  <li key={e.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-semibold text-gray-900">{e.title}</p>
                        <p className="text-[12.5px] text-gray-500">
                          {[e.issuing_body, e.issued_on ? `issued ${fmtDate(e.issued_on)}` : null, e.expires_on ? `${e.expires_on < today ? "expired" : "expires"} ${fmtDate(e.expires_on)}` : null,
                            e.framework_competency_id && names.get(e.framework_competency_id) ? names.get(e.framework_competency_id) : null,
                            e.need_id && needTitle.get(e.need_id) ? `for: ${needTitle.get(e.need_id)}` : null].filter(Boolean).join(" · ")}
                        </p>
                        {e.detail && <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-gray-700">{e.detail}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ClassLabel value={e.evidence_class} />
                        {e.document_name && (
                          <a href={`/api/individual/professional/documents?type=evidence&id=${e.id}`} target="_blank" rel="noopener noreferrer"
                            className={`text-[12.5px] font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>
                            Open {e.document_name}
                          </a>
                        )}
                        <ApiButton action={`/api/individual/professional/evidence?id=${e.id}`} method="DELETE" label="Remove" confirm="Remove this item and its document?" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        );
      })}

      {evidence !== null && record.provisioned && (
        <Section title="Add a credential or evidence" note="Attach a document if you have one. It is stored privately and only you can open it.">
          <ApiForm action="/api/individual/professional/evidence" multipart submitLabel="Add to my record" accent={x.accent} savedText="Added.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor="ev-kind">
                <select id="ev-kind" name="kind" required className={inputCls} defaultValue="credential">
                  {EVIDENCE_KIND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label="Title" htmlFor="ev-title"><input id="ev-title" name="title" required minLength={3} maxLength={200} className={inputCls} placeholder="e.g. Basic Life Support certificate" /></Field>
              <Field label="Issuing body (credentials)" htmlFor="ev-body"><input id="ev-body" name="issuingBody" maxLength={160} className={inputCls} /></Field>
              <Field label="Date issued or done (optional)" htmlFor="ev-issued"><input id="ev-issued" name="issuedOn" type="date" max={today} className={inputCls} /></Field>
              <Field label="Expiry date (credentials, optional)" htmlFor="ev-exp" hint={`We email you ${REMINDER_HORIZON_DAYS} days before, if email is set up.`}><input id="ev-exp" name="expiresOn" type="date" className={inputCls} /></Field>
              <Field label="Development need (optional)" htmlFor="ev-need">
                <select id="ev-need" name="needId" className={inputCls} defaultValue="">
                  <option value="">Not linked to a need</option>
                  {openNeeds.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Description (optional)" htmlFor="ev-detail" hint="Never include patient-identifiable details."><textarea id="ev-detail" name="detail" rows={4} maxLength={5000} className={inputCls} /></Field>
            <FrameworkPicker idPrefix="ev" frameworks={frameworks?.map(f => ({ id: f.id, name: f.name })) ?? null} />
            <Field label="Document (optional)" htmlFor="ev-doc" hint="PDF or image, up to 10 MB. Attaching it does not verify the item.">
              <input id="ev-doc" name="document" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className={`${inputCls} py-2.5`} />
            </Field>
          </ApiForm>
        </Section>
      )}

      <Section title="Verified by an organisation">
        <p className="text-[14px] text-gray-700">
          Credentials an organisation verified for you, and competencies it assessed, are in{" "}
          <Link href={experienceHref("professional", "passport")} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>your Passport</Link>,
          labelled by who issued them. Nothing you add here can be marked verified: no independent verification service is connected yet.
        </p>
      </Section>
    </>
  );
}
