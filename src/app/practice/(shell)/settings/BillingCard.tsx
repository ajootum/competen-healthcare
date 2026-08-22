"use client";

import { useState } from "react";
import type { SubscriptionState } from "@/lib/practice/subscription-state";

// The subscription card on /practice/settings (Practice tab).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// IT REFUSES TO DRAW A STATUS IT COULD NOT READ. `unavailable` from the loader short-circuits everything
// below: a billing card that says "Trial, 12 days left" because the entitlement row errored is how a
// practitioner finds out on a Monday that their workspace lapsed a week ago. An unread status is stated
// as unread, and the pay button is withheld -- charging against a state we cannot see is worse than
// making somebody reload.
//
// AND IT NEVER PRINTS A PRICE IT CANNOT FORMAT. The amount comes from the server already formatted
// against the same exponent table the gateway is charged in, so the figure on this button and the figure
// Flutterwave receives cannot disagree.
//
// NO NEW NAV ITEM. CPR-HFE-001 freezes the sidebar at eleven items in five sections and the doctrine
// harness enforces it, so subscription lives INSIDE settings where the other practice-wide settings are.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type Props = {
  state: SubscriptionState;
  /** Server-formatted, so the client never does money arithmetic. null = currency we cannot format. */
  prices: Record<string, string | null>;
  canManage: boolean;
};

const CARD = "rounded-xl border border-gray-200 bg-white p-4";

export default function BillingCard({ state, prices, canManage }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function subscribe(planCode: string) {
    setBusy(planCode); setError(null);
    try {
      const res = await fetch("/api/v1/practice/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.link) {
        // The server's message is already practitioner-safe; the gateway's own words stay in the log.
        setError(data.error ?? "The checkout could not be started. Nothing was charged.");
        setBusy(null);
        return;
      }
      // Leaving for the gateway. `busy` is deliberately not cleared -- the button must not become
      // pressable again during the navigation, or a double-tap starts two checkouts.
      window.location.assign(data.link);
    } catch {
      setError("Could not reach Competen to start the checkout. Nothing was charged.");
      setBusy(null);
    }
  }

  // ── The status could not be read ──────────────────────────────────────────────────────────────────
  if (state.unavailable.length > 0) {
    return (
      <section className={CARD} aria-labelledby="billing-h">
        <h2 id="billing-h" className="text-[13px] font-bold text-gray-900">Subscription</h2>
        <p role="status" className="mt-2 rounded-lg border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] px-3 py-2 text-[12px] text-rose-800">
          <strong>Your subscription status could not be read.</strong>{" "}
          {state.unavailable.join(" and ")} did not load, so nothing here describes this workspace. Reload
          before acting on it — and no payment can be started until it can be read.
        </p>
      </section>
    );
  }

  const ent = state.entitlement;
  const sub = state.subscription;
  const paid = sub?.status === "active";

  return (
    <section className={CARD} aria-labelledby="billing-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="billing-h" className="text-[13px] font-bold text-gray-900">Subscription</h2>
        {ent ? (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            paid ? "bg-emerald-100 text-emerald-800"
              : ent.status === "trial" ? "bg-amber-100 text-amber-800"
              : "bg-rose-100 text-rose-800"}`}>
            {paid ? "Paid" : ent.status === "trial" ? "Free trial" : ent.status}
          </span>
        ) : (
          // No row is a fact worth printing, and it is NOT the same as "free trial".
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">No plan on file</span>
        )}
      </div>

      <p className="mt-1 text-[12px] text-gray-600">
        {paid && sub
          ? `Paid to ${new Date(sub.periodEnd).toLocaleDateString()}.`
          : ent?.status === "trial" && ent.endsAt
            ? `Your free trial runs to ${new Date(ent.endsAt).toLocaleDateString()}.`
            : ent?.status === "trial"
              ? "You are on the free trial."
              : "This workspace has no active plan."}
      </p>

      {state.lastAttempt?.status === "mismatched" && (
        <p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          Your last payment was received but did not match the plan price, so it has not been applied.
          Nothing further has been charged — please contact us before paying again.
        </p>
      )}

      {/* ── The pay path ──────────────────────────────────────────────────────────────────────────── */}
      <div className="mt-3 border-t border-gray-100 pt-3">
        {!canManage ? (
          <p className="text-[11px] text-gray-500">
            Whoever manages this practice&apos;s settings handles the subscription.
          </p>
        ) : !state.gatewayReady ? (
          // Named, not hidden: a missing pay button with no explanation reads as a broken page.
          <p className="text-[11px] text-amber-700">
            Payments are not switched on for this deployment yet, so there is nothing to pay here.
          </p>
        ) : state.offers.length === 0 ? (
          <p className="text-[11px] text-amber-700">
            No priced plan is on offer yet. Nothing can be paid for until a price is published.
          </p>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {state.offers.map(o => {
                const price = prices[o.planCode];
                return (
                  <li key={o.planCode} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold text-gray-900">{o.name}</span>
                      <span className="block text-[11px] text-gray-500">
                        {/* A price we cannot format is stated, never guessed. */}
                        {price ? `${price} per ${o.interval}` : "Price unavailable in this currency"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => subscribe(o.planCode)}
                      disabled={!!busy || !price}
                      className="rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === o.planCode ? "Opening…" : paid ? "Renew" : "Subscribe"}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[10px] text-gray-500">
              Pay by mobile money or card. You will be taken to our payment provider and returned here.
            </p>
          </>
        )}

        {error && (
          <p role="alert" className="mt-2 rounded-lg border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] px-3 py-2 text-[11px] text-rose-800">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
