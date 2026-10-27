import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { individualShell, gatedMetadata } from "../../../../_components/shell-context";
import { learningEnabled } from "@/lib/learning/policy";
import { CERTIFICATE_DISCLAIMER } from "@/lib/learning/record";
import { LearningShell, day } from "../../_components/LearningShell";

// Request-time only: it reads the release gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /individual/learning/certificate/[no] -- the person's OWN certificate (COMPETEN-LEARNING-01 S2, owner D6). It names
// the issuer, the course, the version and the evidence, and states the outcome only: course completion or assessed
// knowledge. The verification link is the person's to share; nothing is disclosed automatically.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Certificate" }); }

export default async function CertificatePage({ params }: { params: Promise<{ no: string }> }) {
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  if (shell.state !== "READY") redirect("/individual/access");
  const { admin, userId, live } = shell.ctx;
  if (!(await learningEnabled(admin))) notFound();
  const { no } = await params;
  if (!/^LC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(no)) notFound();
  const { data: c } = await admin.from("learning_certificate").select("certificate_no, verification_code, snapshot, issued_at, revoked_at, revoked_reason").eq("certificate_no", no).eq("user_id", userId).maybeSingle();
  if (!c) notFound();
  const s = c.snapshot ?? {};
  const evidence = s.evidence?.basis;
  return (
    <LearningShell live={live} current="mine">
      <article className="mx-auto max-w-2xl rounded-2xl border-2 border-[var(--cmp-theme-accent)] bg-white p-8 text-center">
        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[var(--cmp-theme-ink)]">Competen Learning certificate</p>
        <h1 className="mt-3 text-2xl font-bold text-gray-900">{s.outcomeLabel ?? "Certificate"}</h1>
        <p className="mt-4 text-[15px] text-gray-700">This records that</p>
        <p className="mt-1 text-[20px] font-bold text-gray-900">{s.learner ?? "the learner"}</p>
        <p className="mt-1 text-[15px] text-gray-700">{s.outcome === "assessed_knowledge" ? "completed and passed the assessment of" : "completed"}</p>
        <p className="mt-1 text-[18px] font-semibold text-gray-900">{s.course} <span className="text-[14px] font-normal text-gray-600">({s.code}, version {s.version})</span></p>
        <p className="mt-3 text-[14px] text-gray-700">on {day(s.completedAt)}. Issued by {s.issuer ?? "the named issuer"} on {day(c.issued_at)}.</p>
        {Array.isArray(evidence?.checks) && evidence.checks.length > 0 && <p className="mt-2 text-[13px] text-gray-600">Evidence: {evidence.satisfied} of {evidence.required} required activities; {evidence.checks.map((x: { id: string; score: number; max: number }) => `${x.id} ${x.score}/${x.max}`).join(", ")}.</p>}
        <p className="mt-4 text-[13px] text-gray-600">Certificate {c.certificate_no}{c.revoked_at ? ` · REVOKED ${day(c.revoked_at)}: ${c.revoked_reason ?? ""}` : ""}</p>
        <p className="mt-4 text-[12.5px] text-gray-500">{s.disclaimer ?? CERTIFICATE_DISCLAIMER}</p>
      </article>
      <div className="mx-auto mt-4 max-w-2xl text-[13.5px] text-gray-700">
        <p>Anyone you give this link to can check the certificate: <Link className="font-semibold text-[var(--cmp-theme-ink)] underline" href={`/learning/verify/${c.verification_code}`}>/learning/verify/{c.verification_code}</Link>. Share it only if you choose to.</p>
      </div>
    </LearningShell>
  );
}
