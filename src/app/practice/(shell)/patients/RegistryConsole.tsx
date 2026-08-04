"use client";

import { useState } from "react";
import SearchSection from "./SearchSection";
import RegistrationForm from "./RegistrationForm";
import { steps } from "@/lib/practice/registration-workspace";
import { STEP_STATE } from "@/lib/practice/palette";

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
        <p className="mt-0.5 text-[14px] text-gray-500">
          Search first. Register only when nobody matches.
        </p>
      </div>

      <SearchSection canCreate={canCreate} onRegisterClick={() => setShowRegister(true)} />

      {/* ── The four counts (comp: four tiles with tinted icon badges) ─────────────────────────────
          THE BADGE IS THE COMP'S, AND IT IS NOT DECORATION: four identical white rectangles of digits
          take a moment to tell apart, and the colour is what makes each one findable at a glance from
          across a desk. The GLYPHS are text rather than an icon set, because this product has no icon
          library and adding one to draw four shapes would be a dependency for a decoration. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Walk-ins today", counts.walkInsToday, "arrived without an appointment", "◷", "var(--cp-info)"],
          ["Registered today", counts.registeredToday, "new records", "＋", "var(--cp-success)"],
          ["Follow-ups due", counts.followUpsDueToday, "today or overdue", "↻", "var(--cp-warning)"],
          ["Patients", counts.totalPatients, "on this practice's register", "☺", "var(--cp-primary)"],
        ].map(([label, value, note, glyph, colour]) => (
          <div key={String(label)} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[16px]"
                style={{ background: `color-mix(in srgb, ${colour} 12%, white)`, color: colour as string }}
              >
                {glyph as string}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-gray-500">{label as string}</span>
                {/* THE FIGURE TAKES THE TILE'S COLOUR. A tinted badge beside a black number leaves the
                    colour as decoration on the icon; the comp puts it on the number, which is the thing
                    being read. */}
                <span className="block text-[26px] font-bold leading-tight" style={{ color: colour as string }}>
                  {value as number}
                </span>
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">{note as string}</p>
          </div>
        ))}
      </div>

      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[13px] ${notice.kind === "ok"
          ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
          : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {/* ── Registration ───────────────────────────────────────────────────────────────────────── */}
      {canCreate && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[12px] font-bold text-white">2</span>
              <h2 className="text-[14px] font-bold text-gray-900">Register a patient</h2>
            </div>
            <button type="button" onClick={() => setShowRegister(v => !v)}
              className="text-[13px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
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
              {/* EVERY CIRCLE CARRIES THE SAME STATE, AND THAT IS THE HONEST ONE. The comp fills steps
                  1 and 2 and outlines 3-5, which is a claim about progress through a wizard. This is not
                  a wizard -- nothing is gated and every card is on screen at once -- so filling two and
                  outlining three would tell somebody they had completed a stage they had not started.
                  They are coloured because the comp's colour is right; they are uniform because the
                  progress it encodes is not true here. */}
              <ol className="mt-3 flex items-center gap-1 flex-wrap text-[12px]">
                {steps(mode).map((s, i) => (
                  <li key={s.key} className="flex items-center gap-1">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${STEP_STATE.done}`}>
                      {i + 1}
                    </span>
                    <span className="font-semibold text-[var(--cp-primary-deep)]">{s.label}</span>
                    {i < steps(mode).length - 1 && <span className="mx-1 text-[var(--cp-primary)]/30">›</span>}
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
