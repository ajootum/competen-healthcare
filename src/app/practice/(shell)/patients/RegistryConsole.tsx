"use client";

import { useState } from "react";
import SearchSection from "./SearchSection";
import RegistrationForm from "./RegistrationForm";
import { steps } from "@/lib/practice/registration-workspace";

// CPR-REG-002 v4 -- the registration workspace's main column.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE STEPPER IS A MAP, NOT A GATE.
//
// The comp draws five numbered steps. Making them a wizard -- one card at a time, Next between each --
// would fight the acceptance criterion directly above it: "Quick Registration completed in under 30
// seconds". Five Next clicks is not thirty seconds. So the steps are shown as a map of what this
// registration still needs, every card is on the page at once, and the numbers tell you where you are
// rather than deciding what you may see.
//
// QUICK VS FULL IS ABOUT HOW MUCH IS ASKED, not about how many screens. Quick hides the hospital
// identifiers card, which is the comp's own promise: "minimum information, save time, complete later".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function RegistryConsole({ canCreate, workspace }: {
  canCreate: boolean;
  workspace: any;
}) {
  const [showRegister, setShowRegister] = useState(false);
  const [mode, setMode] = useState<"quick" | "full">("quick");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const counts = workspace.counts;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Patient registration</h1>
        <p className="mt-0.5 text-[13px] text-gray-500">
          Search first. Register only when nobody matches.
        </p>
      </div>

      <SearchSection canCreate={canCreate} onRegisterClick={() => setShowRegister(true)} />

      {/* ── The four counts (comp: four tiles) ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Walk-ins today", counts.walkInsToday, "arrived without an appointment"],
          ["Registered today", counts.registeredToday, "new records"],
          ["Follow-ups due", counts.followUpsDueToday, "today or overdue"],
          ["Patients", counts.totalPatients, "on this practice's register"],
        ].map(([label, value, note]) => (
          <div key={String(label)} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-[11px] font-semibold text-gray-500">{label}</p>
            <p className="mt-0.5 text-2xl font-bold text-gray-900">{value as number}</p>
            <p className="text-[10px] text-gray-500">{note}</p>
          </div>
        ))}
      </div>

      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok"
          ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
          : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {/* ── Registration ───────────────────────────────────────────────────────────────────────── */}
      {canCreate && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[11px] font-bold text-white">2</span>
              <h2 className="text-[13px] font-bold text-gray-900">Register a patient</h2>
            </div>
            <button type="button" onClick={() => setShowRegister(v => !v)}
              className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              {showRegister ? "Close" : "Open"}
            </button>
          </div>

          {showRegister && (
            <>
              {/* ── The stepper (comp: 1..5 + Complete) ───────────────────────────────────────
                  A MAP, NOT A GATE -- see the header. It shows what this registration still needs and
                  which parts are done; nothing here hides a card or blocks a save. In quick mode the
                  hospital-identifiers step is absent rather than greyed, because in quick mode it is
                  genuinely not part of the job. */}
              <ol className="mt-3 flex items-center gap-1 flex-wrap text-[11px]">
                {steps(mode).map((s, i) => (
                  <li key={s.key} className="flex items-center gap-1">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-[10px] font-bold text-gray-500">
                      {i + 1}
                    </span>
                    <span className="text-gray-600">{s.label}</span>
                    {i < steps(mode).length - 1 && <span className="mx-1 text-gray-300">›</span>}
                  </li>
                ))}
              </ol>

              {/* ── Mode (comp: two cards) ────────────────────────────────────────────────── */}
              <div className="mt-3 grid sm:grid-cols-2 gap-2">
                {[
                  ["quick", "Quick registration", "The minimum a record needs. Hospital numbers and the rest can follow."],
                  ["full", "Full registration", "Everything, including hospital identifiers, in one sitting."],
                ].map(([k, title, blurb]) => (
                  <button key={k} type="button" onClick={() => setMode(k as "quick" | "full")}
                    className={`rounded-lg border p-3 text-left ${mode === k
                      ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/5"
                      : "border-gray-200 hover:bg-gray-50"}`}>
                    <p className={`text-[12px] font-bold ${mode === k ? "text-[var(--cp-primary-deep)]" : "text-gray-900"}`}>{title}</p>
                    <p className="mt-0.5 text-[10px] text-gray-500">{blurb}</p>
                  </button>
                ))}
              </div>

              <RegistrationForm
                form={{ template: workspace.template, fields: workspace.fields ?? [] }}
                majorityAge={workspace.majorityAge ?? 18}
                today={workspace.today}
                mode={mode}
                onNotice={setNotice}
                onRegistered={(r) => {
                  if (r.incomplete?.length) {
                    setNotice({ kind: "err", text: `Registered, but: ${r.incomplete.map((i: any) => i.reason).join("; ")}` });
                    setTimeout(() => window.location.assign(`/practice/patients/${r.patientId}`), 2500);
                    return;
                  }
                  window.location.assign(`/practice/patients/${r.patientId}`);
                }}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}
