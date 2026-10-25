/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { learningEnabled } from "@/lib/learning/policy";
import { ActionButton, AuthoriseCertificates, RevokeCertificate } from "../_components/LearningControls";
import { Alert, Header, Off, when } from "../_components/Bits";

// /super-admin/learning/certificates -- certificate issuance authority (COMPETEN-LEARNING-01 S2, migration 462, owner
// D6 and D8). Guarded by hq.learning.certificate.issue (the Learning Certificate Issuer position). An authorisation
// says which outcomes completed records of ONE version may be certified for -- course completion, assessed knowledge
// -- under the issuer the version names. The database refuses an author or submitter of the version, and anyone
// without an active appointment holding the capability. No certificate states competence or accreditation.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Learning certificates" };

export default async function LearningCertificatesPage() {
  const ctx = await requireHqCapability("hq.learning.certificate.issue");
  if (!(await learningEnabled(ctx.admin))) return <Off />;
  const { data: vs, error } = await ctx.admin.from("learning_offering_version").select("id, version_no, state, content, certificate_issuer_id, learning_offering!inner(code, title, delivery)")
    .in("state", ["submitted", "published"]).eq("learning_offering.delivery", "hosted").order("updated_at", { ascending: false }).limit(200);
  const offering = ((vs ?? []) as any[]).filter(v => v.content?.certificate?.offered === true);
  const ids = offering.map(v => v.id);
  const [{ data: auths }, { data: provs }, { data: certs }] = await Promise.all([
    ids.length ? ctx.admin.from("learning_certificate_authorisation").select("id, version_id, outcomes, authorised_at, withdrawn_at").in("version_id", ids) : Promise.resolve({ data: [] }),
    ctx.admin.from("learning_provider").select("id, name"),
    ctx.admin.from("learning_certificate").select("id, certificate_no, outcome, issued_at, revoked_at, snapshot").order("issued_at", { ascending: false }).limit(200),
  ]);
  const prov = new Map(((provs ?? []) as any[]).map(p => [p.id, p.name]));
  return (
    <div className="max-w-4xl space-y-8">
      <Header title="Learning certificates" intro="Authorise, on behalf of the named issuer, which outcomes each course version may be certified for. Certificates then issue when a learner completes that version. Revoke a certificate issued in error." />
      {error ? <Alert text="The versions could not be read just now." /> : (
        <section className="space-y-3"><h2 className="text-[15px] font-bold text-gray-900">Versions that offer a certificate</h2>
          {offering.length === 0 ? <p className="text-[13.5px] text-gray-700">None yet.</p> : offering.map(v => {
            const live = ((auths ?? []) as any[]).find(a => a.version_id === v.id && !a.withdrawn_at);
            return (
              <div key={v.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-[13.5px] font-semibold text-gray-900">{v.learning_offering.code} {v.learning_offering.title} · version {v.version_no} ({v.state})</p>
                <p className="text-[12.5px] text-gray-600">Issuer: {prov.get(v.certificate_issuer_id) ?? "not named"}. {live ? `Authorised for ${live.outcomes.join(" and ").replace(/_/g, " ")} on ${when(live.authorised_at)}.` : "Not authorised: completed records of this version receive no certificate."}</p>
                {live ? <ActionButton body={{ action: "withdraw_certificates", authorisationId: live.id }} label="Withdraw this authorisation" done="Withdrawn. Certificates already issued stay unless revoked." tone="ghost" /> : <AuthoriseCertificates versionId={v.id} />}
              </div>);
          })}
        </section>
      )}
      <section className="space-y-3"><h2 className="text-[15px] font-bold text-gray-900">Issued certificates</h2>
        {((certs ?? []) as any[]).length === 0 ? <p className="text-[13.5px] text-gray-700">None issued yet.</p> : ((certs ?? []) as any[]).map(c => (
          <div key={c.id} className="space-y-1 border-t border-gray-100 pt-2 text-[13px]">
            <p>{c.certificate_no} · {c.snapshot?.course ?? "Course"} v{c.snapshot?.version} · {c.snapshot?.outcomeLabel ?? c.outcome} · {c.snapshot?.learner ?? "Learner"} · {when(c.issued_at)}{c.revoked_at ? ` · revoked ${when(c.revoked_at)}` : ""}</p>
            {!c.revoked_at && <RevokeCertificate certificateId={c.id} />}
          </div>))}
      </section>
    </div>
  );
}
