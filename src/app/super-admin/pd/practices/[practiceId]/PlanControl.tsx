"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACCESS_STATE_LABEL, type EntitlementReading } from "@/lib/hq/entitlement";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-PD-PROV-001 §7 -- THE PRACTICE ACCESS MANAGEMENT CARD.
//
// ⚠ IT OFFERS PRESETS AND CHOOSES NOTHING. §9 asks for +7/+30/+90 and Custom; the owner's decision and
// §2 are that the PRODUCT DIRECTOR determines the period. So a preset FILLS THE FIELD and leaves the
// confirm to a person -- nothing is pre-selected, because a prefilled default is this file quietly
// making the decision every time somebody accepts what was already in the box.
//
// ⚠ AND THE PROPOSED EXPIRY IS SHOWN BEFORE THE WRITE (§5, §9, AC-08). Current end and proposed new end
// side by side, with the calculated duration -- the consequence of this control is whether a clinician
// can open their diary tomorrow, so it is stated in advance rather than reported afterwards.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const INPUT =
  "w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[13px] outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10";

/** §9's approved presets. Days, because that is the unit the spec and a Director both use. */
const PRESETS = [7, 14, 30, 60, 90] as const;

const STATE_TONE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  expiring_soon: "bg-amber-100 text-amber-900",
  scheduled: "bg-sky-100 text-sky-800",
  expired: "bg-rose-100 text-rose-800",
  paused: "bg-slate-200 text-slate-700",
  none: "bg-slate-100 text-slate-600",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export default function PlanControl({ workspaceId, practiceName, reading, mayManage }: {
  workspaceId: string;
  practiceName: string;
  reading: EntitlementReading;
  mayManage: boolean;
}) {
  const router = useRouter();
  const current = reading.state === "ok" ? reading.current : null;

  const [basis, setBasis] = useState<"trial" | "active">("trial");
  const [days, setDays] = useState<number | null>(null);
  const [customEnd, setCustomEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ⚠ EXTENSION RUNS FROM NOW WHEN ACCESS HAS LAPSED, AND FROM THE CURRENT END WHEN IT HAS NOT.
  // Adding 30 days to an end date that passed last week would produce a period that is already over --
  // the server refuses it, and a Director should not have to discover that from a refusal.
  const currentEndMs = current?.endsAt ? Date.parse(current.endsAt) : null;
  const anchorMs = currentEndMs !== null && currentEndMs > Date.now() ? currentEndMs : Date.now();
  const proposedEnd = days !== null
    ? new Date(anchorMs + days * 86_400_000).toISOString()
    : customEnd ? `${customEnd}T23:59:59.000Z` : null;

  const proposedValid = proposedEnd !== null && Date.parse(proposedEnd) > Date.now();
  const proposedDays = proposedEnd
    ? Math.ceil((Date.parse(proposedEnd) - Date.now()) / 86_400_000)
    : null;

  async function send(body: Record<string, unknown>, describe: (data: any) => string) {
    setBusy(true); setResult(null);
    const res = await fetch("/api/v1/practice/entitlement", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, reason, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setResult({ kind: "err", text: data.error ?? `Refused (${res.status}).` }); return; }
    setResult({ kind: "ok", text: describe(data) });
    setReason(""); setDays(null); setCustomEnd("");
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[14px] font-bold text-gray-900">Practice access</h2>

      {reading.state === "unreadable" && (
        <p className="mt-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-700">
          {reading.reason} That is not the same as this practice having no access period &mdash; nothing
          was read, so nothing is known either way, and changing it from here would be writing over an
          answer nobody has seen.
        </p>
      )}

      {reading.state === "none" && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-gray-700">
          This practice has no access period at all, so nobody can use it. Granting one below creates the
          first.
        </p>
      )}

      {/* ── §7's card: status, plan, started, ends, days remaining ───────────────────────────────── */}
      {reading.state === "ok" && current && (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${STATE_TONE[current.state] ?? STATE_TONE.none}`}>
              {ACCESS_STATE_LABEL[current.state]}
            </span>
            <span className="text-[12.5px] text-gray-700">
              <span className="font-semibold">{current.planCode}</span>
              {current.daysRemaining !== null && (
                <> &middot; {current.daysRemaining} day{current.daysRemaining === 1 ? "" : "s"} remaining</>
              )}
            </span>
          </div>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-gray-500">Started</dt>
              <dd className="font-semibold text-gray-800">{fmtDate(current.startsAt)}</dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-gray-500">Ends</dt>
              <dd className="font-semibold text-gray-800">
                {current.endsAt ? fmtDate(current.endsAt) : "open-ended"}
              </dd>
            </div>
          </dl>
          {/* The gate's own reason, so this card cannot disagree with the product turning them away. */}
          {current.whyNot && (
            <p className="mt-1.5 text-[12px] font-semibold text-rose-800">
              Locked out because {current.whyNot}.
            </p>
          )}
          {/* §9: history is preserved, and a Director can see it rather than being told it exists. */}
          {reading.periods.length > 1 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11.5px] font-semibold text-violet-700">
                {reading.periods.length} access periods
              </summary>
              <ul className="mt-1 space-y-1">
                {reading.periods.map(p => (
                  <li key={p.id} className="text-[11.5px] text-gray-600">
                    {fmtDate(p.startsAt)} → {p.endsAt ? fmtDate(p.endsAt) : "open-ended"}
                    {" · "}{p.planCode} · {p.status}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* ── §9's extension and reactivation ──────────────────────────────────────────────────────── */}
      {!mayManage ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] text-slate-600">
          You can see this. Changing it needs commercial administration.
        </p>
      ) : reading.state === "unreadable" ? null : (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <h3 className="text-[12.5px] font-bold text-gray-900">
            {current?.grantsAccessNow ? "Extend access" : "Restore access"}
          </h3>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map(d => (
              <button key={d} type="button"
                onClick={() => { setDays(days === d ? null : d); setCustomEnd(""); }}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${
                  days === d ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                +{d} days
              </button>
            ))}
            <input type="date" value={customEnd}
              onChange={e => { setCustomEnd(e.target.value); setDays(null); }}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-[12px]" />
          </div>

          <label className="mt-3 block max-w-xs">
            <span className="text-[12px] font-semibold text-gray-800">Access basis</span>
            <select value={basis} onChange={e => setBasis(e.target.value as "trial" | "active")}
              className={`mt-1 ${INPUT}`}>
              <option value="trial">Trial &mdash; evaluation access</option>
              <option value="active">Active &mdash; a commercial plan</option>
            </select>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500">
              {basis === "trial"
                ? "Honest about what it is while nothing is billed."
                : "Says a subscription exists. Nothing in this product bills for one yet."}
            </span>
          </label>

          {/* ⚠ CURRENT AND PROPOSED, SIDE BY SIDE, BEFORE THE WRITE (§9, AC-08). */}
          {proposedEnd && (
            <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-[12px]">
              <p className="text-gray-700">
                <span className="text-gray-500">Now </span>
                {current?.endsAt ? fmtDate(current.endsAt) : "no period"}
                <span className="mx-2 text-gray-400">→</span>
                <span className="font-bold text-violet-900">{fmtDate(proposedEnd)}</span>
              </p>
              <p className="mt-0.5 text-[11.5px] text-gray-600">
                {proposedValid
                  ? <>{practiceName} would have {proposedDays} day{proposedDays === 1 ? "" : "s"} of access from today.</>
                  : "That end has already passed, so it would not restore access."}
              </p>
            </div>
          )}

          <label className="mt-3 block">
            <span className="text-[12px] font-semibold text-gray-800">Reason</span>
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="recorded in this practice's audit trail with the before and after"
              className={`mt-1 ${INPUT}`} />
          </label>

          {result && (
            <p role="status" className={`mt-2 rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
              result.kind === "ok"
                ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200"
                : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"}`}>
              {result.text}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !proposedValid || reason.trim().length < 8}
              onClick={() => send(
                { action: "grant", status: basis, planCode: basis === "trial" ? "practice_trial" : "practice_standard", endsAt: proposedEnd },
                d => d.grantsAccessNow
                  ? `${practiceName} can open the practice again, until ${fmtDate(d.after.endsAt)}.`
                  : `Saved, and access is still closed.`)}
              className="rounded-lg bg-violet-600 px-4 py-2.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
              {busy ? "Saving…" : current?.grantsAccessNow ? "Extend access" : "Open access"}
            </button>

            {/* §7's high-consequence action, and it names the practice and the effect (§16). */}
            {current?.grantsAccessNow && (
              <button type="button" disabled={busy || reason.trim().length < 8}
                onClick={() => send(
                  { action: "end", status: "expired" },
                  () => `${practiceName} is locked out. Their data is retained.`)}
                className="rounded-lg border border-rose-300 bg-white px-4 py-2.5 text-[12.5px] font-semibold text-rose-800 disabled:opacity-50">
                End access now
              </button>
            )}
          </div>

          {reason.trim().length < 8 && (
            <p className="mt-1.5 text-[11px] text-gray-500">A reason of at least 8 characters is required.</p>
          )}
        </div>
      )}
    </section>
  );
}
