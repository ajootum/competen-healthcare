import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { createClient, createAdminClientOrNull } from "@/lib/supabase/server";
import { individualCommerceEnabled, isIndividualTxRef } from "@/lib/individual/commerce";
import { EXPERIENCES, isExperienceKey } from "@/lib/individual/experiences";
import { signInHref } from "@/lib/individual/entry";
import { gatedMetadata } from "../../_components/shell-context";
import { StatePanel, IndividualMark, primaryBtn, secondaryBtn } from "../../_components/chrome";

// Request-time only: it reads two gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /individual/billing/return -- WHERE THE PAYMENT PROVIDER SENDS A PAYER BACK (P1 Commercial, migration 399).
//
// ⚠ THIS PAGE DECIDES NOTHING. The provider appends ?status=successful&tx_ref=... and a page that believed it
// could be made to say anybody had paid. Payment is settled by the webhook's three checks; this page only
// reads the checkout row that settlement wrote -- and only one belonging to the signed-in person.
//
// ⚠ DARK unless BOTH the Individual release gate and the individual_commerce flag are on: 404 otherwise, the
// same answer as a page that does not exist. It sits outside the shell because a first purchase may come
// from a person who holds no membership yet.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Your payment", robots: { index: false, follow: false } });
}

export default async function IndividualBillingReturnPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const admin = createAdminClientOrNull();
  if (!admin || !(await individualCommerceEnabled(admin))) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const raw = (await searchParams).tx_ref;
  const txRef = typeof raw === "string" && isIndividualTxRef(raw) ? raw : null;

  if (!user) {
    return <Frame><StatePanel title="Sign in to see your payment" actions={<Link href={signInHref(null)} className={`${primaryBtn} bg-gray-900`}>Sign in</Link>}>
      <p>Your payment is confirmed with the provider whether or not you are signed in. Sign in to see where it stands.</p>
    </StatePanel></Frame>;
  }
  if (!txRef) {
    return <Frame><StatePanel title="No payment to show" actions={<Link href="/individual/home" className={secondaryBtn}>Competen Individual</Link>}>
      <p>This link does not name a Competen Individual payment.</p>
    </StatePanel></Frame>;
  }

  const { data: checkout, error } = await admin.from("individual_checkout")
    .select("status, experience_code").eq("tx_ref", txRef).eq("user_id", user.id).maybeSingle();
  const product = checkout && isExperienceKey(checkout.experience_code) ? EXPERIENCES[checkout.experience_code].name : "Competen Individual";

  if (error) {
    return <Frame><StatePanel tone="warning" title="We could not check your payment just now"
      actions={<Link href={`/individual/billing/return?tx_ref=${encodeURIComponent(txRef)}`} className={`${primaryBtn} bg-gray-900`}>Try again</Link>}>
      <p>Something went wrong while reading it. This does not mean the payment failed.</p>
    </StatePanel></Frame>;
  }
  if (!checkout) {
    return <Frame><StatePanel title="No payment to show" actions={<Link href="/individual/home" className={secondaryBtn}>Competen Individual</Link>}>
      <p>We have no payment with this reference on your account.</p>
    </StatePanel></Frame>;
  }
  if (checkout.status === "paid") {
    return <Frame><StatePanel title={`Payment confirmed`} actions={<Link href="/individual/home" className={`${primaryBtn} bg-gray-900`}>Open {product}</Link>}>
      <p>Your payment for {product} has been confirmed.</p>
    </StatePanel></Frame>;
  }
  if (checkout.status === "pending") {
    return <Frame><StatePanel title="Confirming your payment"
      actions={<Link href={`/individual/billing/return?tx_ref=${encodeURIComponent(txRef)}`} className={`${primaryBtn} bg-gray-900`}>Check again</Link>}>
      <p>We are waiting for the payment provider to confirm your payment for {product}. This usually takes a minute. Access opens once it is confirmed.</p>
    </StatePanel></Frame>;
  }
  return <Frame><StatePanel tone="warning" title="This payment did not complete" actions={<Link href="/individual/home" className={secondaryBtn}>Competen Individual</Link>}>
    <p>{checkout.status === "mismatched"
      ? "The amount the provider confirmed did not match the price, so no access was opened. Contact Competen support with your payment reference."
      : "No access was opened. If you were charged, contact Competen support with your payment reference."}</p>
    <p className="mt-2 font-mono text-sm">{txRef}</p>
  </StatePanel></Frame>;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-6"><IndividualMark /></div>
        {children}
      </div>
    </main>
  );
}
