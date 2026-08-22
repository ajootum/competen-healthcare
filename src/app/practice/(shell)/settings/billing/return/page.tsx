import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";

// /practice/settings/billing/return — where Flutterwave sends the practitioner back to.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS PAGE GRANTS NOTHING, AND ITS QUERY STRING IS NOT EVIDENCE.
//
// The redirect lands in the practitioner's browser, so every parameter on it is attacker-controlled:
// anyone can type ?status=successful into the address bar. Access is granted by the WEBHOOK, which
// verifies server-to-server against our own recorded amount. All this page does is READ what the webhook
// has already written, and say so.
//
// WHICH MEANS THE HONEST ANSWER IS OFTEN "NOT YET". A redirect can beat its webhook by a few seconds, so
// "we have not seen the payment yet" is a real and common state -- and it is NOT the same as failure. It
// is stated as pending, with what to do, rather than dressed up as either outcome.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const CARD = "rounded-xl border border-gray-200 bg-white p-5";

export default async function BillingReturnPage({ searchParams }: {
  searchParams: Promise<{ tx_ref?: string; status?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");

  const { tx_ref: txRef } = await searchParams;
  const admin = createAdminClient();

  // Read OUR record of the attempt, keyed by our own reference, scoped to this workspace so a reference
  // belonging to another practice cannot be inspected by pasting it into the URL.
  const { data: checkout, error } = txRef
    ? await admin.from("practice_checkout")
        .select("status, currency, amount_minor, channel, settled_at")
        .eq("tx_ref", txRef).eq("workspace_id", shell.ctx.workspaceId).maybeSingle()
    : { data: null, error: null };

  const state: "paid" | "pending" | "failed" | "mismatched" | "unknown" | "unreadable" =
    error ? "unreadable"
      : !txRef || !checkout ? "unknown"
      : checkout.status === "paid" ? "paid"
      : checkout.status === "mismatched" ? "mismatched"
      : checkout.status === "failed" ? "failed"
      : "pending";

  const COPY: Record<typeof state, { tone: string; title: string; body: string }> = {
    paid: {
      tone: "border-emerald-300 bg-emerald-50 text-emerald-900",
      title: "Payment received",
      body: "Your subscription is active. Nothing else is needed.",
    },
    pending: {
      tone: "border-amber-300 bg-amber-50 text-amber-900",
      title: "We have not seen your payment yet",
      body: "This is normal for the first minute or two — confirmation reaches us separately from your browser. Your subscription updates on its own; there is no need to pay again.",
    },
    failed: {
      tone: "border-rose-300 bg-rose-50 text-rose-900",
      title: "That payment did not go through",
      body: "Nothing was charged. You can try again from your settings.",
    },
    mismatched: {
      tone: "border-amber-300 bg-amber-50 text-amber-900",
      title: "Your payment was received but does not match the plan price",
      body: "It has NOT been applied and nothing further has been charged. Please contact us before paying again — do not retry.",
    },
    unknown: {
      tone: "border-gray-200 bg-gray-50 text-gray-700",
      title: "We could not match this to a payment",
      body: "If you were charged, it will still be applied when confirmation reaches us. Your settings show the current state.",
    },
    unreadable: {
      tone: "border-rose-300 bg-rose-50 text-rose-900",
      title: "Your payment record could not be read",
      body: "This is not a statement that the payment failed — we simply could not look. Reload, and check your settings before paying again.",
    },
  };

  const c = COPY[state];

  return (
    <div className="mx-auto max-w-2xl">
      <div className={CARD}>
        <p role="status" className={`rounded-lg border px-4 py-3 ${c.tone}`}>
          <strong className="block text-[14px]">{c.title}</strong>
          <span className="mt-1 block text-[12px] leading-relaxed">{c.body}</span>
        </p>

        {state === "paid" && checkout?.settled_at && (
          <p className="mt-3 text-[11px] text-gray-500">
            Paid {new Date(checkout.settled_at).toLocaleString()}
            {checkout.channel && checkout.channel !== "unknown"
              ? ` by ${checkout.channel.replace(/_/g, " ")}`
              : ""}.
          </p>
        )}

        <Link href="/practice/settings?tab=practice"
          className="mt-4 inline-block rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90">
          Back to settings
        </Link>
      </div>
    </div>
  );
}
