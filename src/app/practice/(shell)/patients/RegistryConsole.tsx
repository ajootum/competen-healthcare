"use client";

import { useCallback, useState } from "react";
import SearchSection from "./SearchSection";
import RegistrationForm from "./RegistrationForm";
import { steps } from "@/lib/practice/registration-workspace";
import { STEP_STATE } from "@/lib/practice/palette";

// CPR-REG-002 v4 / CPR-V5-006 s5 -- the registration console, now the contents of the drawer.
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
//
// WHAT MOVED OUT OF HERE, AND WHY. The page title and the four count tiles are gone: the title belongs to
// the workspace, and the counts are now the six worklist tiles on the screen behind this drawer -- where
// each of them OPENS THE LIST it counts, which these four never could. Nothing that wrote anything moved.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function RegistryConsole({ canCreate, canStartEncounter, workspace }: {
  canCreate: boolean;
  /** encounter.create. Gates "Register and start the consultation" -- see RegistrationForm. */
  canStartEncounter: boolean;
  workspace: any;
}) {
  const [mode, setMode] = useState<"quick" | "full">("quick");
  // ⚠ THE BIRTH DATE IS HELD HERE BECAUSE THE STEP LIST IS DRAWN HERE. steps() takes it and decides
  // whether the contacts step reads "Guardian" or "Next of kin" -- a distinction that matters, because a
  // guardian holds legal authority and a next of kin is somebody to ring. It was being called with no
  // date at all, so `minor` was permanently null and every registration, newborn to pensioner, showed
  // the same hedged "Guardian or next of kin". The adaptive workflow was real in the engine and had
  // never once fired on screen.
  const [birthDate, setBirthDate] = useState("");
  // Stable, so the effect that reports the date upward does not re-run on every render of this console.
  const onBirthDateChange = useCallback((d: string) => setBirthDate(d), []);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {/* STEP ONE IS STILL SEARCH, INSIDE THE DRAWER AS WELL AS ON THE SCREEN BEHIND IT. The drawer
          covers the workspace's own search box, and "check before you register" is the only reliable
          defence against a duplicate record -- so it travels with the form rather than being left on a
          surface the person registering cannot see. */}
      <SearchSection canCreate={canCreate} />

      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[13px] ${notice.kind === "ok"
          ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
          : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {canCreate && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-baseline gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[12px] font-bold text-white">2</span>
            <h2 className="text-[14px] font-bold text-gray-900">Register a patient</h2>
          </div>

          {/* ── The stepper (comp: 1..5 + Complete) ───────────────────────────────────────
              A MAP, NOT A GATE -- see the header. It shows what this registration still needs and
              which parts are done; nothing here hides a card or blocks a save. In quick mode the
              hospital-identifiers step is absent rather than greyed, because in quick mode it is
              genuinely not part of the job. */}
          {/* EVERY CIRCLE CARRIES THE SAME STATE, AND THAT IS THE HONEST ONE. The comp fills steps
              1 and 2 and outlines 3-5, which is a claim about progress through a wizard. This is not
              a wizard -- nothing is gated and every card is on screen at once -- so filling two and
              outlining three would tell somebody they had completed a stage they had not started.
              They are coloured because the comp's colour is right; they are uniform because the
              progress it encodes is not true here. */}
          <ol className="mt-3 flex flex-wrap items-center gap-1 text-[12px]">
            {steps(mode, birthDate, workspace.today).map((s, i) => (
              <li key={s.key} className="flex items-center gap-1">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${STEP_STATE.done}`}>
                  {i + 1}
                </span>
                <span className="font-semibold text-[var(--cp-primary-deep)]">{s.label}</span>
                {i < steps(mode, birthDate, workspace.today).length - 1 && <span className="mx-1 text-[var(--cp-primary)]/30">›</span>}
              </li>
            ))}
          </ol>

          {/* ── Mode (comp: two cards) ────────────────────────────────────────────────── */}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              ["quick", "Quick registration", "The minimum a record needs. Hospital numbers and the rest can follow."],
              ["full", "Full registration", "Everything, including hospital identifiers, in one sitting."],
            ].map(([k, title, blurb]) => (
              <button key={k} type="button" onClick={() => setMode(k as "quick" | "full")}
                className={`rounded-lg border p-3 text-left ${mode === k
                  ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/5"
                  : "border-gray-200 hover:bg-gray-50"}`}>
                <p className={`text-[13px] font-bold ${mode === k ? "text-[var(--cp-primary-deep)]" : "text-gray-900"}`}>{title}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">{blurb}</p>
              </button>
            ))}
          </div>

          <RegistrationForm
            form={{ template: workspace.template, fields: workspace.fields ?? [] }}
            majorityAge={workspace.majorityAge ?? 18}
            today={workspace.today}
            mode={mode}
            canStartEncounter={canStartEncounter}
            onNotice={setNotice}
            onBirthDateChange={onBirthDateChange}
            onRegistered={(r) => {
              if (r.incomplete?.length) {
                setNotice({ kind: "err", text: `Registered, but: ${r.incomplete.map((i: any) => i.reason).join("; ")}` });
                setTimeout(() => window.location.assign(`/practice/patients/${r.patientId}`), 2500);
                return;
              }
              window.location.assign(`/practice/patients/${r.patientId}`);
            }}
          />
        </section>
      )}
    </div>
  );
}
