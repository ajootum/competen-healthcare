"use client";

import { useState } from "react";
import { LEGAL_VERSIONS } from "@/lib/practice/catalogs";
import {
  Stepper, StepFindAccount, StepVerify, StepConfigure, StepAccess, StepDefaults, StepReview, StepResult,
  resolveAccessPeriod, type ProvAccess,
} from "./_provisioning-steps";

// The operator console. Four panels: the gate ledger, the launch ladder, pilot provisioning, and the
// record of what has been provisioned.
//
// PROVISIONING GENERATES ITS OWN IDEMPOTENCY KEY, once per form session, and shows it. PROV-001 s8 makes
// the key the arbiter of a replayed request; a UI that minted a fresh key on every click would turn a
// double-click into two workspaces, and one that hid the key would make a 409 IDEMPOTENCY_CONFLICT
// unexplainable. The key resets only when the form is cleared after a success.
//
// TURNING A FLAG ON ASKS FOR CONFIRMATION AND REPEATS THE CONSEQUENCE the API returns. These three
// toggles decide whether a public page offers a credential field; a one-click switch with no restatement
// of what changes publicly is how a launch posture moves by accident.

/* eslint-disable @typescript-eslint/no-explicit-any */

// The field styling moved to _provisioning-steps.tsx with the form it dresses.

const FLAG_LABEL: Record<string, string> = {
  practice_pilot_provisioning: "Pilot provisioning",
  practice_sign_in: "Sign-in open",
  practice_public_signup: "Public signup",
};

// PRACTICE_TYPES, PROFESSIONS and LEGAL_VERSIONS come from src/lib/practice/catalogs so this console and
// the public signup form offer the same world. Two copies drift the first time one gains an entry, and
// the drift is invisible: both forms keep working, they simply disagree.

const STATE_TONE: Record<string, string> = {
  pass: "text-[var(--cmp-text-success)]",
  fail: "text-[var(--cmp-text-critical)]",
  pending: "text-[var(--cmp-text-warning)]",
};
const STATE_MARK: Record<string, string> = { pass: "✓", fail: "✗", pending: "•" };

const newKey = () => `ops-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;

export default function PracticeOpsConsole({ callerId, callerName, initial, plans, baseline, canRetry, canProvision, canManageFlags }: {
  callerId: string; callerName: string; initial: any;
  /**
   * CPR-PD-PROV-001 §3: the ACTIVE plans, read from `practice_plans` on the server.
   *
   * ⚠ NOT A CONSTANT IN THIS FILE. §3: "Do not hard-code commercial plans in the provisioning
   * component." An empty array is a real answer -- the Access step refuses to invent a plan code and
   * says the catalogue could not be read, rather than defaulting to one that may have been withdrawn.
   */
  plans: { planCode: string; name: string; trialDays: number | null }[];
  /** CPR-PD-PROV-001 §4 step 3: the canonical template, read from CP_STANDARD_V1 on the server. */
  baseline: { version: string; areas: { key: string; value: string; enforcement: string; where: string }[] };
  /**
   * Whether this caller holds hq.practice.provision.execute, resolved on the SERVER.
   *
   * !! DISPLAY ONLY. CPR-PD-014 section 9: client-side hiding is not authorisation. The retry endpoint
   * gates itself on the same capability, so a caller who reached this prop by other means still gets a
   * 403. What it prevents is offering somebody a control that would refuse them.
   */
  canRetry: boolean;
  /** CPR-PD-014 s6.2. Both gate a real API capability -- see the page for why provisioning reuses retry. */
  canProvision: boolean;
  canManageFlags: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newKey());
  /**
   * CPR-PD-014 §7.2 C — the guided operator flow, replacing the development-style single form.
   *
   * !! THE STEP IS STATE, NOT DECORATION. §7.2 C names five stages, and the one that earns its place is
   * step 2: eligibility is checked BEFORE the operator fills in a practice name, timezone and market for
   * somebody who already owns a Practice. The old form let them type all of it and learn at submit.
   */
  const [step, setStep] = useState(1);
  const [target, setTarget] = useState<
    { id: string; name: string; existingPracticeStatus: string | null } | null
  >({ id: callerId, name: `${callerName} (you)`, existingPracticeStatus: null });
  const [result, setResult] = useState<{ workspaceId: string; status: string; created: boolean; nextUrl: string } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [form, setForm] = useState({
    displayName: "", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
  });

  // CPR-PD-PROV-001 §4 step 2. The plan defaults to the first ACTIVE plan the catalogue returned and the
  // duration to that plan's own trial length -- a starting point the Director changes, not a decision
  // this component makes on their behalf.
  const [access, setAccess] = useState<ProvAccess>({
    planCode: plans[0]?.planCode ?? "",
    basis: "trial",
    startMode: "now",
    startDate: "",
    endMode: "days",
    days: plans[0]?.trialDays ?? 30,
    endDate: "",
  });

  // ⚠ RESOLVED ONCE, HERE, and handed to both the step that shows it and the request that posts it. The
  // alternative -- each of the three computing its own end date -- is how a screen promises one date and
  // stores another.
  const period = resolveAccessPeriod(access);

  const reload = () => window.location.reload();

  async function search() {
    setResults(null);
    const res = await fetch(`/api/v1/practice/operations/users?q=${encodeURIComponent(query)}`);
    const data = await res.json().catch(() => ({ results: [] }));
    setResults(data.results ?? []);
  }

  async function provision() {
    if (!target) { setNotice({ kind: "err", text: "Choose who the workspace is for." }); return; }
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/provisioning/individual", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        ...form, targetUserId: target.id,
        termsVersion: LEGAL_VERSIONS.terms, privacyNoticeVersion: LEGAL_VERSIONS.privacy, source: "pilot",
        // §4 step 2 / AC-04. The route refuses this field unless the caller has passed the capability
        // gate, and re-validates the interval before anything is written.
        access: {
          planCode: access.planCode, basis: access.basis,
          startsAt: period.startsAt, endsAt: period.endsAt,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = data?.error?.code;
      setNotice({
        kind: code === "PRACTICE_ALREADY_EXISTS" ? "warn" : "err",
        text: `${data?.error?.message ?? "Provisioning failed."}${code ? ` (${code})` : ""}${data?.nextUrl ? ` — ${data.nextUrl}` : ""}`,
      });
      setBusy(false); return;
    }
    // §7.2 C step 5: show the result. The reload is deliberately NOT immediate — the operator needs to
    // read what happened, and a page that refreshes under them loses the one screen that says whether a
    // workspace was created or an existing one returned.
    setResult({
      workspaceId: data.workspaceId, status: data.status,
      created: !!data.created, nextUrl: data.nextUrl,
    });
    setStep(7);
    setIdempotencyKey(newKey());
    setBusy(false);
  }

  /**
   * CPR-PD-014 section 8.3 / section 7.2 D — resume a stalled or failed provisioning run.
   *
   * !! THE BUTTON EXISTS ONLY BECAUSE THE ENDPOINT DOES. Section 12 makes that the order:
   * "Retry is real and idempotent before any retry UI is enabled." Until this build the honest option
   * was a sentence explaining that no endpoint existed, and that sentence is what this replaces.
   *
   * !! AND THE RESULT IS READ BACK, NOT ASSUMED. Section 7.4: "The UI confirms the post-mutation state
   * from a fresh read rather than assuming success." The endpoint returns the status it re-read from the
   * database, and the page reloads so every panel reflects the same fresh state rather than one
   * optimistically patched row.
   */
  async function retryRun(requestId: string, who: string) {
    if (!confirm(
      `Resume provisioning for ${who}?\n\n`
      + "Each step re-checks its own resource before creating it, so a resumed run completes the "
      + "remainder rather than duplicating what already exists. This is recorded in the audit trail.",
    )) return;
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/v1/practice/provisioning/${requestId}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error ?? `Retry failed (${res.status}).` });
      setBusy(false); return;
    }
    setNotice({
      kind: data.ok ? "ok" : "warn",
      text: data.ok
        ? `Run resumed and completed. Status is now ${data.status}.`
        : `Run resumed but stopped again at ${data.failedStep ?? "an unrecorded step"} (${data.errorCode ?? "no code"}).`,
    });
    location.reload();
  }

  async function toggleFlag(flag: string, enabled: boolean) {
    /**
     * ⚠ CONFIRMATION ON BOTH DIRECTIONS NOW, AND A REASON FOR THE PUBLIC-FACING ONES.
     *
     * CPR-PD-014 §7.2 B: "Public-impacting changes require confirmation showing consequences before
     * execution", and a reason is "required for consequential changes". Confirming only the ON
     * direction was the older reading — but turning sign-in OFF takes a working front door away from
     * people mid-session, which is every bit as consequential as opening it.
     *
     * The reason is not decoration and not validated only here: the API returns 400 without one, so a
     * caller that skips this prompt is refused rather than silently recording a blank. That is the
     * difference between a form convention and a rule.
     */
    const PUBLIC_IMPACTING = ["practice_sign_in", "practice_public_signup"];
    const direction = enabled ? "ON" : "OFF";
    if (!confirm(`Turn ${FLAG_LABEL[flag]} ${direction}? This changes what the PUBLIC site does.`)) return;

    let reason = "";
    if (PUBLIC_IMPACTING.includes(flag)) {
      reason = (prompt(
        `Why are you turning ${FLAG_LABEL[flag]} ${direction}?\n\n`
        + "This is recorded in the audit trail alongside the before and after values.",
      ) ?? "").trim();
      if (reason.length < 8) {
        setNotice({ kind: "err", text: "A reason of at least 8 characters is required for this flag. Nothing was changed." });
        return;
      }
    }

    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/flags", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag, enabled, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: "err", text: data?.error ?? "That did not work." }); setBusy(false); return; }
    // ALWAYS RELOAD ON SUCCESS. This previously returned early to display the consequence message, so a
    // flag with a consequence -- which is every flag worth worrying about -- flipped in the database and
    // left the toggle showing its old value. It read as "the switch is broken", and the honest reading of
    // a broken switch is to press it again, which is how the launch posture moved three times unnoticed.
    // The consequence is now a STANDING banner rendered from the flag state, so nothing is lost by
    // repainting: see FLAG_CONSEQUENCE in src/lib/practice/operations.ts.
    reload();
  }

  return (
    <div className="space-y-4">
      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[12px] ${
          notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : notice.kind === "warn" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"
              : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Gate: a pointer, not a second checklist ──────────────────────────────────────────── */}
        {/*
          ⚠ THE FULL CHECKLIST USED TO BE HERE AND ITS REMOVAL IS THE POINT. CPR-PD-014 §7.3: "Do not
          repeat the full Launch Readiness checklist." Launch Readiness now presents the gate as a
          DECISION — satisfied over total, the blockers named, automatic and human counted separately,
          and human controls carrying owner, evidence and audit provenance. Rendering the same twelve
          items here left two surfaces answering the same question, and the one with less context was
          the one an operator happened to be looking at.

          What stays is the summary a control-plane operator needs before touching a toggle: how many
          controls are outstanding, and whether any automatic check is failing right now.
        */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Cutover gate</h2>
          {(() => {
            const gate = (initial.gate as any[]) ?? [];
            const failing = gate.filter(g => g.state === "fail");
            const outstanding = gate.filter(g => g.state !== "pass").length;
            return (
              <>
                <p className="mt-1 text-[12px] text-gray-700">
                  <span className="font-bold tabular-nums">{gate.length - outstanding}/{gate.length}</span>{" "}
                  controls satisfied.
                  {failing.length > 0 && (
                    <span className="ml-1 font-semibold text-[var(--cmp-text-critical)]">
                      {failing.length} automatic check{failing.length === 1 ? "" : "s"} failing.
                    </span>
                  )}
                </p>
                {/* Only the FAILING items appear here, because a failing automatic check is a fact about
                    the deployment an operator may be about to change. Passing and pending items belong
                    to the observational screen. */}
                {failing.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {failing.map(g => (
                      <li key={g.id} className="text-[11px] text-gray-600">
                        <span className={`mr-1 font-bold ${STATE_TONE[g.state]}`}>{STATE_MARK[g.state]}</span>
                        {g.label}
                      </li>
                    ))}
                  </ul>
                )}
                <a href="/super-admin/pd/operations/launch-readiness"
                  className="mt-2 inline-block text-[11px] font-semibold text-teal-700 hover:underline">
                  Launch Readiness — the full gate, blockers and attestations →
                </a>
              </>
            );
          })()}
        </section>

        {/* ── Launch ladder ───────────────────────────────────────────── */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Launch ladder (§14.1)</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Every change is written to the Practice audit log with who and when. Turning a flag back off is
            the rollback path — no account is lost.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {(initial.flagRows as any[]).map(f => (
              <li key={f.flag} className="flex items-start gap-3 rounded-lg border border-gray-100 px-3 py-2">
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-gray-900">{FLAG_LABEL[f.flag] ?? f.flag}</p>
                  <p className="text-[11px] text-gray-500">{f.note}</p>
                </div>
                {/* !! THE STATE STAYS, THE ACTION GOES. ON/OFF is INFORMATION -- it is what the flag
                    currently is -- and this button was carrying both jobs at once. Hiding it from a
                    reader who may not flip it would hide the state as well, leaving them unable to see
                    what is live on the public site. So the badge renders either way and only the
                    ability to press it is conditioned (CPR-PD-014 s6.2). */}
                {canManageFlags ? (
                  <button type="button" disabled={busy} onClick={() => toggleFlag(f.flag, !f.enabled)}
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${
                      f.enabled ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-gray-100 text-gray-600"}`}>
                    {f.enabled ? "ON" : "OFF"}
                  </button>
                ) : (
                  <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                    f.enabled ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-gray-100 text-gray-600"}`}>
                    {f.enabled ? "ON" : "OFF"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ── CPR-PD-014 §7.2 C — guided provisioning ──────────────────────────────────────────── */}
      {/* The anchor the PD register's "Provision a practice" button lands on -- AC-01's route in. */}
      <section id="provisioning" className="scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Provision a practice</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          PROV-001 §4 platform-assisted pilot. One individual Practice per person, enforced by the
          engine: a duplicate-safe request returns the first workspace rather than creating a second.
        </p>

        {/* !! A WHOLE PANEL IS NOT A ROW ACTION. Omission is the right answer for the Retry link on
            one run -- a missing link beside a finished row reads as "nothing to do here". A missing
            five-step wizard reads as a broken screen, and this product has been reported broken over
            exactly that before. So the section keeps its heading and says why it is empty. */}
        {!canProvision && (
          <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700">
            Provisioning is not offered to you. It needs the provisioning capability, which this
            position does not hold; the launch flags above and the register below are read-only for the
            same reason. Nothing here is broken and nothing is hidden.
          </p>
        )}
        {canProvision && (<>
        <Stepper step={step} />

        {step === 1 && (
          <StepFindAccount
            query={query} setQuery={setQuery} results={results}
            onSearch={search}
            onPick={t => { setTarget(t); setResults(null); }}
            onUseSelf={() => { setTarget({ id: callerId, name: `${callerName} (you)`, existingPracticeStatus: null }); setResults(null); }}
            target={target} />
        )}
        {step === 2 && target && <StepVerify target={target} />}
        {step === 3 && <StepConfigure form={form} setForm={setForm} />}
        {/* CPR-PD-PROV-001 §4 step 2 — the access period, before the review that quotes it. */}
        {step === 4 && <StepAccess access={access} setAccess={setAccess} plans={plans} timezone={form.timezone} />}
        {step === 5 && <StepDefaults baseline={baseline} />}
        {step === 6 && target && (
          <StepReview target={target} form={form} access={access} plans={plans} idempotencyKey={idempotencyKey} />
        )}
        {step === 7 && result && <StepResult result={result} />}

        {/* Navigation. Each step names what it needs before it will advance, rather than disabling a
            button with no explanation. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {step > 1 && step < 7 && (
            <button type="button" onClick={() => setStep(s => s - 1)} disabled={busy}
              className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Back
            </button>
          )}
          {step < 6 && (
            <button type="button"
              disabled={busy || (step === 1 && !target) || (step === 3 && !form.displayName.trim())
                || (step === 4 && (period.problem !== null || plans.length === 0))}
              onClick={() => setStep(s => s + 1)}
              className="rounded-lg bg-teal-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
              Continue
            </button>
          )}
          {step === 6 && (
            // §6: "This is an explicit write action and must not occur merely by navigating away from
            // the review screen." So the only control that writes lives on the review step, and every
            // other button on this wizard moves between steps.
            <button type="button"
              disabled={busy || !target || !form.displayName.trim() || period.problem !== null}
              onClick={provision}
              className="rounded-lg bg-teal-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
              {busy ? "Provisioning…" : "Provision practice"}
            </button>
          )}
          {step === 7 && (
            <>
              <button type="button" onClick={reload}
                className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                Refresh this page
              </button>
              <button type="button"
                onClick={() => { setStep(1); setResult(null); setForm(f => ({ ...f, displayName: "" })); setResults(null); setQuery(""); }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                Provision another
              </button>
            </>
          )}
          {step === 1 && !target && <span className="text-[11px] text-gray-500">Choose who the workspace is for.</span>}
          {step === 3 && !form.displayName.trim() && <span className="text-[11px] text-gray-500">A practice name is required.</span>}
          {step === 4 && period.problem && <span className="text-[11px] text-gray-500">{period.problem}</span>}
        </div>
        </>)}
      </section>


      {/* ── Workspaces ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Practice workspaces</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Counts only. No patient name, note or diagnosis is read into this page — SEC-001 puts the record
          under the practitioner&apos;s ownership, and there is deliberately no way in from here.
        </p>
        {initial.workspaces.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-500">None provisioned yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="py-1 pr-3">Practice</th><th className="py-1 pr-3">Owner</th>
                  <th className="py-1 pr-3">Status</th><th className="py-1 pr-3 text-right">Team</th>
                  <th className="py-1 pr-3 text-right">Appts</th><th className="py-1 pr-3 text-right">Patients</th>
                  <th className="py-1 pr-3 text-right">Encounters</th><th className="py-1 pr-3 text-right">Signed</th>
                  {/* Banded counts, never amounts -- "is the money loop alive", not "how much". */}
                  <th className="py-1 pr-3 text-right">Invoices</th><th className="py-1 pr-3 text-right">Payments</th>
                  <th className="py-1">Created</th>
                </tr>
              </thead>
              <tbody>
                {(initial.workspaces as any[]).map(w => (
                  <tr key={w.id} className="border-t border-gray-100">
                    <td className="py-1.5 pr-3 text-gray-900">{w.name}</td>
                    {/* ⚠ D1: the owner's NAME, and their email is not in this payload to fall back to.
                        Reach an address through the lookup below, which answers one query at a time. */}
                    <td className="py-1.5 pr-3 text-gray-600">{w.ownerName ?? "—"}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        w.status === "ACTIVE" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                          : w.status === "ONBOARDING" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"
                            : "bg-gray-100 text-gray-600"}`}>{w.status}</span>
                    </td>
                    {/* ⚠ D2: BANDS, NOT NUMBERS. These arrive banded from the loader -- the exact figure
                        is never sent, so it cannot be read out of the payload either. "Is this practice
                        alive" is answered; "how big is her book" is not.
                        ⚠ The signed column compares against "0" rather than testing truthiness: the
                        string "0" is truthy, so `w.counts.signed ? ...` would colour every practice as
                        having closed the loop, including those that have signed nothing. */}
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.members ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.appointments ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.patients ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.encounters ?? "0"}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${(w.counts.signed ?? "0") !== "0" ? "text-[var(--cmp-text-success)]" : "text-gray-500"}`}>{w.counts.signed ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.invoices ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.payments ?? "0"}</td>
                    <td className="py-1.5 font-mono text-gray-500">{String(w.created_at).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Requests + step ledger ────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Provisioning requests</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          The saga step ledger. Provisioning is resumable rather than transactional, so a partial failure
          must be legible — a saga you cannot see is just a hang.
        </p>
        {initial.requests.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-500">No requests recorded.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {(initial.requests as any[]).map(r => (
              <li key={r.id} className="rounded-lg border border-gray-100 px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap text-[12px]">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    r.status === "COMPLETED" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                      : r.status === "FAILED" ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
                        : "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>{r.status}</span>
                  {/* D1 applies here too: a provisioning failure is identified by who it was for, not by
                      their address. The id remains as the last resort so a row is never nameless. */}
                  <span className="text-gray-800">{r.targetName ?? r.target_user_id}</span>
                  <span className="text-gray-500">{r.request_type}</span>
                  {r.error_code && <span className="text-[var(--cmp-text-critical)]">{r.error_code}</span>}
                  <span className="ml-auto font-mono text-[11px] text-gray-500">{String(r.created_at).slice(0, 16).replace("T", " ")}</span>
                  {/* Section 7.2 D: the action column. Offered only for a run that has somewhere left to
                      go -- a COMPLETED run has nothing to resume, and saying so by omission is clearer
                      than a disabled button. */}
                  {canRetry && r.status !== "COMPLETED" && (
                    <button type="button" disabled={busy} onClick={() => retryRun(r.id, r.targetName ?? r.target_user_id)}
                      className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:border-teal-600 hover:text-teal-700 disabled:opacity-50">
                      Retry
                    </button>
                  )}
                </div>
                {r.steps.length > 0 && (
                  <div className="mt-1 flex gap-1 flex-wrap">
                    {r.steps.map((s: any, i: number) => (
                      <span key={i} title={s.error_code ?? s.status}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                          s.status === "succeeded" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                            : s.status === "failed" ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
                              : "bg-gray-100 text-gray-600"}`}>
                        {s.step_code}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
