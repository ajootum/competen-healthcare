import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { individualShell, gatedMetadata } from "../../../_components/shell-context";
import { StatePanel, primaryBtn, secondaryBtn } from "../../../_components/chrome";
import { learningCommerceEnabled } from "@/lib/learning/policy";
import { isLearningTxRef } from "@/lib/learning/commerce";
import { LearningShell } from "../_components/LearningShell";

// Request-time only: it reads the release gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /individual/learning/return -- WHERE THE PAYMENT PROVIDER SENDS A COURSE BUYER BACK (COMPETEN-LEARNING-01 S3).
//
// ⚠ THIS PAGE DECIDES NOTHING. The provider appends ?status=...&tx_ref=..., and a page that believed it could be made
// to say anybody had paid. Access is opened by settlement's three checks on the webhook. This page only reads the
// person's own checkout row, and whether a course entitlement exists for it.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Your payment", robots: { index: false, follow: false } }); }

export default async function LearningReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const shell = await individualShell();
  if (shell.state === "DISABLED") notFound();
  if (shell.state !== "READY") redirect("/individual/access");
  const { admin, userId, live } = shell.ctx;
  if (!(await learningCommerceEnabled(admin))) notFound();
  const raw = (await searchParams).tx_ref;
  const txRef = typeof raw === "string" && isLearningTxRef(raw) ? raw : null;
  const { data: co } = txRef ? await admin.from("individual_checkout").select("id, status, offering_id, learning_offering(code, title)").eq("tx_ref", txRef).eq("user_id", userId).eq("item_kind", "course").maybeSingle() : { data: null };
  const { data: ent } = co ? await admin.from("individual_course_entitlement").select("id").eq("checkout_id", co.id).maybeSingle() : { data: null };
  const course = (co as { learning_offering?: { code: string; title: string } } | null)?.learning_offering;
  return (
    <LearningShell live={live} current={null}>
      <div className="max-w-xl">
        {!co ? (
          <StatePanel title="No course payment to show" actions={<Link href="/individual/learning" className={secondaryBtn}>Learning catalogue</Link>}><p>This link does not name one of your course payments.</p></StatePanel>
        ) : ent ? (
          <StatePanel title="Your access is open" actions={course && <Link href={`/individual/learning/${course.code}`} className={`${primaryBtn} bg-[var(--cmp-theme-accent)]`}>Go to {course.title}</Link>}><p>The payment provider confirmed your payment to Competen, and your access to the course is open.</p></StatePanel>
        ) : co.status === "paid" ? (
          <StatePanel tone="warning" title="Your payment is confirmed, and your access is being opened"><p>If the course does not open within a few minutes, contact Competen: the payment is recorded and access will be granted.</p></StatePanel>
        ) : co.status === "failed" || co.status === "mismatched" || co.status === "abandoned" ? (
          <StatePanel tone="warning" title="This payment did not complete" actions={course && <Link href={`/individual/learning/${course.code}`} className={secondaryBtn}>Back to the course</Link>}><p>No access was opened. If money left your account, contact Competen with the reference {txRef}.</p></StatePanel>
        ) : (
          <StatePanel title="Waiting for the payment provider" actions={<Link href={`/individual/learning/return?tx_ref=${encodeURIComponent(txRef ?? "")}`} className={secondaryBtn}>Check again</Link>}><p>Access opens only when the provider confirms the payment to Competen, which can take a moment. Your browser cannot confirm it.</p></StatePanel>
        )}
      </div>
    </LearningShell>
  );
}
