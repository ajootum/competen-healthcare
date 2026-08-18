"use client";

import { useState } from "react";

// PLAT-GOV-MC-001 s8 - the context switcher.
//
// ⚠ IT RENDERS WITH ONE CONTEXT TOO, AND NOT AS A SWITCHER. With a single appointment there is nothing to
// choose, but "which authority am I acting under" is still the question the header exists to answer -- and
// it is the question somebody asks when a screen shows them less than they expected. One context reads as a
// statement, several as a control.
//
// ⚠ AND IT NEVER CLAIMS TO BE THE GATE. Switching changes what this identity may do because the SERVER
// re-resolves from the cookie on every request. Nothing here is trusted: a caller posting an appointment id
// they do not hold is refused by the route, not by this component being absent.

export type SwitcherContext = {
  appointmentId: string;
  positionName: string;
  productLine: string | null;
  capabilityCount: number;
};

export default function GovernanceContextSwitcher({ contexts, activeId, defaulted, compact = false }: {
  contexts: SwitcherContext[];
  activeId: string | null;
  defaulted: boolean;
  /**
   * ⚠ OPT-IN, DEFAULTING TO THE EXISTING LOOK, SO THE HQ COMPOSITION IS UNTOUCHED.
   *
   * ComposedMissionControl renders this in a column where a card is the right shape. The Product
   * Director's Mission Control renders it in the page header, where that same card spent a full-width
   * bordered box on one line of text -- the most valuable strip on the page, sitting above the first
   * KPI. This drops the card chrome and lets the caller place it.
   *
   * ⚠ IT CHANGES CHROME ONLY. No wording, no capability count and no behaviour: whoever is acting can
   * still see which appointment they hold and can still switch it. A "compact" that quietly removed the
   * switch would be hiding an authority control to save 40px, which is a bad trade at any size.
   */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = contexts.find(c => c.appointmentId === activeId) ?? null;

  if (!contexts.length) return null;

  async function switchTo(appointmentId: string) {
    if (appointmentId === activeId) return;
    setBusy(appointmentId);
    setError(null);
    try {
      const res = await fetch("/api/governance/context/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "That context could not be activated.");
        setBusy(null);
        return;
      }
      const { redirect } = await res.json();
      // Hard navigation: the sidebar, widgets and capability decisions are all server-computed from the
      // cookie, and a soft push would replay payloads rendered under the previous context.
      window.location.assign(redirect ?? "/super-admin");
    } catch {
      setError("The switch could not be completed.");
      setBusy(null);
    }
  }

  return (
    <div className={compact ? "" : "bg-white rounded-xl border border-gray-200 p-3"}>
      <p className="text-[11px] font-semibold text-gray-500">Acting as</p>

      {contexts.length === 1 ? (
        <p className="text-sm text-gray-900 mt-0.5">
          {active?.positionName ?? contexts[0].positionName}
          <span className="text-gray-400"> · {(active ?? contexts[0]).capabilityCount} capabilities</span>
        </p>
      ) : (
        <>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {contexts.map(c => {
              const isActive = c.appointmentId === activeId;
              return (
                <button
                  key={c.appointmentId}
                  onClick={() => switchTo(c.appointmentId)}
                  disabled={!!busy}
                  aria-current={isActive ? "true" : undefined}
                  className={isActive
                    ? "text-xs px-2.5 py-1.5 rounded-lg bg-gray-900 text-white font-medium"
                    : "text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"}
                >
                  {c.positionName}
                  <span className={isActive ? "text-white/60" : "text-gray-400"}> · {c.capabilityCount}</span>
                  {busy === c.appointmentId && <span className="text-[10px] ml-1">…</span>}
                </button>
              );
            })}
          </div>

          {/* ⚠ SAYS WHEN NOTHING WAS CHOSEN. Somebody holding two appointments who was silently placed in one
              would read the missing half as a defect rather than as a context they can change. */}
          {defaulted && (
            <p className="text-[11px] text-gray-400 mt-2">
              You hold {contexts.length} governance contexts and have not chosen one. This is the default,
              not a restriction — switching changes what this workspace shows and what you may do in it.
            </p>
          )}
        </>
      )}

      {error && <p className="text-[11px] text-[var(--cmp-text-error)] mt-2">{error}</p>}
    </div>
  );
}
