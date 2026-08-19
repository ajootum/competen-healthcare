"use client";

import { useState } from "react";
import { PRACTICE_TYPES, PROFESSIONS, LEGAL_VERSIONS } from "@/lib/practice/catalogs";

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

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10";

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

export default function PracticeOpsConsole({ callerId, callerName, initial, canRetry }: {
  callerId: string; callerName: string; initial: any;
  /**
   * Whether this caller holds hq.practice.provision.execute, resolved on the SERVER.
   *
   * !! DISPLAY ONLY. CPR-PD-014 section 9: client-side hiding is not authorisation. The retry endpoint
   * gates itself on the same capability, so a caller who reached this prop by other means still gets a
   * 403. What it prevents is offering somebody a control that would refuse them.
   */
  canRetry: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newKey());
  const [target, setTarget] = useState<{ id: string; name: string } | null>({ id: callerId, name: `${callerName} (you)` });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [form, setForm] = useState({
    displayName: "", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
  });

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
    setNotice({
      kind: "ok",
      text: `Workspace ${data.workspaceId} is ${data.status}. ${data.created ? "Created" : "Replayed the original result"}. The owner continues at ${data.nextUrl}.`,
    });
    setIdempotencyKey(newKey());
    setTimeout(reload, 1200);
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
        {/* ── Gate ledger ─────────────────────────────────────────────── */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">IAM-001 §14 cutover gate</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Auto items are evaluated against the live database on every load. Manual items are attested by
            a person and are never turned green by this page.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {(initial.gate as any[]).map(g => (
              <li key={g.id} className="flex gap-2 text-[12px]">
                <span className={`shrink-0 font-bold ${STATE_TONE[g.state]}`}>{STATE_MARK[g.state]}</span>
                <span className="flex-1">
                  <span className="text-gray-800">{g.label}</span>
                  {g.kind === "manual" && <span className="ml-1.5 rounded bg-gray-100 px-1 py-0.5 text-[9px] font-bold text-gray-500">MANUAL</span>}
                  <span className="block text-[11px] text-gray-500">{g.detail}</span>
                </span>
              </li>
            ))}
          </ul>
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
                <button type="button" disabled={busy} onClick={() => toggleFlag(f.flag, !f.enabled)}
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${
                    f.enabled ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-gray-100 text-gray-500"}`}>
                  {f.enabled ? "ON" : "OFF"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ── Provision ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Provision a pilot workspace</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          PROV-001 §4 platform-assisted pilot. The person must already have a Competen account; this creates
          their Practice, not their identity. One individual Practice per person — a second attempt returns
          the first.
        </p>

        <div className="mt-3 grid lg:grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] font-semibold text-gray-600">Who is it for?</p>
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
              <span className="text-[12px] text-gray-800">{target ? target.name : "nobody selected"}</span>
              {target?.id !== callerId && (
                <button type="button" onClick={() => setTarget({ id: callerId, name: `${callerName} (you)` })}
                  className="ml-auto text-[11px] font-semibold text-teal-700 hover:underline">Use my account</button>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <input placeholder="Search name or email" value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
                className={input} />
              <button type="button" onClick={search} disabled={query.trim().length < 2}
                className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Find
              </button>
            </div>
            {results !== null && (
              results.length === 0 ? (
                <p className="mt-2 text-[11px] text-gray-400">No match.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {results.map(r => (
                    <li key={r.id}>
                      <button type="button" onClick={() => { setTarget({ id: r.id, name: `${r.name}${r.email ? ` · ${r.email}` : ""}` }); setResults(null); }}
                        className="w-full rounded-lg border border-gray-100 px-3 py-1.5 text-left text-[12px] hover:bg-gray-50">
                        <span className="text-gray-800">{r.name}</span>
                        {r.email && <span className="ml-1.5 text-gray-400">{r.email}</span>}
                        {r.existingPracticeStatus && (
                          <span className="ml-1.5 rounded bg-[var(--cmp-surface-warning)] px-1 py-0.5 text-[9px] font-bold text-[var(--cmp-text-warning)]">
                            already has a Practice ({r.existingPracticeStatus})
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>

          <form className="grid grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); provision(); }}>
            <input required placeholder="Practice name" value={form.displayName}
              onChange={e => setForm(p => ({ ...p, displayName: e.target.value }))} className={`${input} col-span-2`} />
            <select value={form.professionCode} onChange={e => setForm(p => ({ ...p, professionCode: e.target.value }))} className={input}>
              {PROFESSIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select value={form.defaultPracticeType} onChange={e => setForm(p => ({ ...p, defaultPracticeType: e.target.value }))} className={input}>
              {PRACTICE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input required placeholder="Country (ISO-2)" maxLength={2} value={form.countryCode}
              onChange={e => setForm(p => ({ ...p, countryCode: e.target.value.toUpperCase() }))} className={input} />
            <input required placeholder="Timezone" value={form.timezone}
              onChange={e => setForm(p => ({ ...p, timezone: e.target.value }))} className={input} />
            <button type="submit" disabled={busy || !form.displayName.trim() || !target}
              className="col-span-2 rounded-lg bg-teal-700 py-2 text-[12px] font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
              Provision
            </button>
            <p className="col-span-2 text-[10px] text-gray-400">
              Idempotency-Key <span className="font-mono">{idempotencyKey}</span> — reused until this
              request succeeds, so a double click returns the first workspace instead of creating a second.
            </p>
          </form>
        </div>
      </section>

      {/* ── Workspaces ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Practice workspaces</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Counts only. No patient name, note or diagnosis is read into this page — SEC-001 puts the record
          under the practitioner&apos;s ownership, and there is deliberately no way in from here.
        </p>
        {initial.workspaces.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">None provisioned yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
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
                            : "bg-gray-100 text-gray-500"}`}>{w.status}</span>
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
                    <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${(w.counts.signed ?? "0") !== "0" ? "text-[var(--cmp-text-success)]" : "text-gray-300"}`}>{w.counts.signed ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.invoices ?? "0"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{w.counts.payments ?? "0"}</td>
                    <td className="py-1.5 font-mono text-gray-400">{String(w.created_at).slice(0, 10)}</td>
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
          <p className="mt-2 text-[12px] text-gray-400">No requests recorded.</p>
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
                  <span className="text-gray-400">{r.request_type}</span>
                  {r.error_code && <span className="text-[var(--cmp-text-critical)]">{r.error_code}</span>}
                  <span className="ml-auto font-mono text-[11px] text-gray-400">{String(r.created_at).slice(0, 16).replace("T", " ")}</span>
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
                              : "bg-gray-100 text-gray-500"}`}>
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
