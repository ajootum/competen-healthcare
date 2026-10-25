import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { createAdminClientOrNull } from "@/lib/supabase/server";
import { learningEnabled } from "@/lib/learning/policy";
import { CERTIFICATE_DISCLAIMER, verifyCertificate } from "@/lib/learning/record";

// Request-time only: it reads the release gate, and must never be prerendered at build.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Certificate verification · Competen Learning", robots: { index: false, follow: false } };

// /learning/verify/[code] -- PUBLIC CERTIFICATE VERIFICATION (COMPETEN-LEARNING-01 S2, owner D6).
//
// Anyone holding the 24-character code the learner chose to share sees what the certificate states and whether it
// stands (or was revoked). Nothing else about the person: no record, no other certificate, no account. A wrong code is
// 404, so codes cannot be told apart from absent ones. Dark while learning_app is off.

export default async function VerifyLearningCertificate({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  const admin = createAdminClientOrNull();
  if (!admin || !(await learningEnabled(admin))) notFound();
  const { code } = await params;
  const v = await verifyCertificate(admin, code);
  if (!v) notFound();
  const s = v.snapshot ?? {};
  const d = (t: string | null | undefined) => (t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <article className="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-8">
        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-teal-800">Competen Learning · certificate verification</p>
        <h1 className={`mt-2 text-xl font-bold ${v.revoked ? "text-red-800" : "text-gray-900"}`}>{v.revoked ? "This certificate was revoked" : "This certificate is valid"}</h1>
        <dl className="mt-4 space-y-2 text-[14.5px] text-gray-800">
          <div><dt className="inline font-semibold">Certificate: </dt><dd className="inline">{v.no}</dd></div>
          <div><dt className="inline font-semibold">States: </dt><dd className="inline">{s.outcomeLabel ?? "Course completion"}</dd></div>
          <div><dt className="inline font-semibold">Learner: </dt><dd className="inline">{s.learner ?? "Not shown"}</dd></div>
          <div><dt className="inline font-semibold">Course: </dt><dd className="inline">{s.course} ({s.code}, version {s.version})</dd></div>
          <div><dt className="inline font-semibold">Completed: </dt><dd className="inline">{d(s.completedAt)}</dd></div>
          <div><dt className="inline font-semibold">Issued by: </dt><dd className="inline">{s.issuer ?? "Not shown"}, on {d(v.issuedAt)}</dd></div>
          {v.revoked && <div><dt className="inline font-semibold">Revoked: </dt><dd className="inline">{d(v.revoked.at)}{v.revoked.reason ? `: ${v.revoked.reason}` : ""}</dd></div>}
        </dl>
        <p className="mt-5 text-[12.5px] text-gray-500">{s.disclaimer ?? CERTIFICATE_DISCLAIMER}</p>
      </article>
    </main>
  );
}
