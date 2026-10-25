import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { ITEM_LABEL, type ItemKind } from "@/lib/individual/professional/profile-vocabulary";
import { METHOD_LABEL, VERIFICATION_LABEL, VERIFICATION_METHODS, loadOpenRequests, loadStandingVerifications } from "@/lib/individual/professional/profile-verification";
import VerdictForm from "./VerdictForm";

// /super-admin/individual/verification -- COMPETEN-PROFESSIONAL-PROFILE-01 part B (migration 451).
//
// The Professional Credential Verifier's queue. Guarded by hq.individual.professional.verify, which only that
// position holds -- and nobody holds the position until the owner appoints someone (no automatic appointment).
//
// ⚠ ONLY WHAT A PERSON ASKED TO HAVE CHECKED. The queue lists record versions with an OPEN request or dispute,
// current, and never the verifier's own. The record's document opens only through the request (GET on the
// verification route), and every view is audited. Nothing here lists anyone's profile otherwise.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Professional verification" };

const fmt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

export default async function ProfessionalVerificationPage() {
  const ctx = await requireHqCapability("hq.individual.professional.verify");
  const today = new Date().toISOString().slice(0, 10);
  const [open, standing] = await Promise.all([loadOpenRequests(ctx.admin, ctx.userId, today), loadStandingVerifications(ctx.admin, ctx.userId, today)]);

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Professional</p>
        <h1 className="text-xl font-bold text-gray-900">Professional verification</h1>
        <p className="mt-1 text-sm text-gray-600">
          Records people have asked Competen to verify. Check each against its source, then record the outcome and how you checked it.
          The person sees the outcome and any reason you give. You cannot act on your own records, and every outcome is kept as history.
        </p>
      </header>

      <section aria-labelledby="open-h" className="space-y-3">
        <h2 id="open-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Waiting for a verifier</h2>
        {open === null ? <p role="alert" className="text-[13.5px] text-red-700">The queue could not be read just now.</p>
          : open.length === 0 ? <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[13.5px] text-gray-600">No open requests.</p>
          : open.map(r => (
            <article key={r.itemId} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-bold text-gray-900">{r.title}</h3>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[12px] font-semibold text-gray-700">{ITEM_LABEL[r.section as ItemKind] ?? r.section} · {VERIFICATION_LABEL[r.verification.state]}</span>
              </div>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13.5px] md:grid-cols-2">
                <div><dt className="text-[12px] font-semibold text-gray-500">Person</dt><dd>{r.personName ?? "Name not recorded"}{r.personEmail ? ` · ${r.personEmail}` : ""}</dd></div>
                {r.typeLabel && <div><dt className="text-[12px] font-semibold text-gray-500">Type</dt><dd>{r.typeLabel}</dd></div>}
                {r.organisation && <div><dt className="text-[12px] font-semibold text-gray-500">Organisation</dt><dd>{r.organisation}</dd></div>}
                {r.jurisdiction && <div><dt className="text-[12px] font-semibold text-gray-500">Jurisdiction</dt><dd>{r.jurisdiction}</dd></div>}
                {r.identifier && <div><dt className="text-[12px] font-semibold text-gray-500">Number, as the person recorded it</dt><dd>{r.identifier}</dd></div>}
                {(r.startedOn || r.endedOn) && <div><dt className="text-[12px] font-semibold text-gray-500">Dates</dt><dd>{fmt(r.startedOn) ?? "?"} – {fmt(r.endedOn) ?? (r.section === "employment" ? "present" : "")}</dd></div>}
                {r.expiresOn && <div><dt className="text-[12px] font-semibold text-gray-500">Expires</dt><dd>{fmt(r.expiresOn)}</dd></div>}
                {r.detail && <div className="md:col-span-2"><dt className="text-[12px] font-semibold text-gray-500">Details</dt><dd className="whitespace-pre-wrap">{r.detail}</dd></div>}
                <div><dt className="text-[12px] font-semibold text-gray-500">Supporting document</dt><dd>{r.documentName
                  ? <a href={`/api/hq/individual/verification?item=${r.itemId}`} className="font-semibold text-teal-800 underline">{r.documentName}</a> : "None attached"}</dd></div>
                {r.verification.reason && r.verification.state === "disputed" && <div className="md:col-span-2"><dt className="text-[12px] font-semibold text-gray-500">The person&apos;s dispute</dt><dd>{r.verification.reason}</dd></div>}
              </dl>
              <div className="mt-3 border-t border-gray-100 pt-3"><VerdictForm itemId={r.itemId} userId={r.userId} methods={VERIFICATION_METHODS} /></div>
            </article>
          ))}
      </section>

      <section aria-labelledby="standing-h" className="space-y-3">
        <h2 id="standing-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Standing verifications</h2>
        <p className="text-[13px] text-gray-600">Revoke one if you learn it no longer holds, with the reason. The record stays; its verification is withdrawn.</p>
        {standing === null ? <p role="alert" className="text-[13.5px] text-red-700">These could not be read just now.</p>
          : standing.length === 0 ? <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[13.5px] text-gray-600">None.</p>
          : standing.map(s => (
            <details key={s.itemId} className="rounded-xl border border-gray-200 bg-white p-4">
              <summary className="cursor-pointer text-[14px] font-semibold text-gray-900">{s.title} · {s.personName ?? "Name not recorded"} · {VERIFICATION_LABEL[s.verification.state]}
                {s.verification.method ? ` (${METHOD_LABEL[s.verification.method]}, ${fmt(s.verification.verifiedAt)})` : ""}</summary>
              <div className="mt-3"><VerdictForm itemId={s.itemId} userId={s.userId} methods={VERIFICATION_METHODS} revokeOnly /></div>
            </details>
          ))}
      </section>
    </div>
  );
}
