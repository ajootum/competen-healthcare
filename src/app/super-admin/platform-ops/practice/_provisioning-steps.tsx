"use client";

import { PRACTICE_TYPES, PROFESSIONS } from "@/lib/practice/catalogs";

/**
 * CPR-PD-014 §7.2 C — the guided provisioning flow.
 *
 * §7.2 C: "Replace the development-style single form with a guided operator flow: Find account. Verify
 * eligibility and existing Practice ownership. Configure workspace… Review consequences and idempotency
 * key. Provision and show result."
 *
 * !! STEP 2 IS THE ONE THAT EARNS THE REWRITE. The old form let an operator type a practice name,
 * market, timezone and profession for somebody who already owned a Practice, and told them at submit.
 * The search endpoint already returned `existingPracticeStatus` on every result — the information was
 * present and simply arrived after the work.
 *
 * !! ONE INDIVIDUAL PRACTICE PER PERSON IS ENFORCED BY THE ENGINE, NOT BY THIS COMPONENT. §7.2 C: "A
 * duplicate-safe request returns the existing workspace rather than creating another." So this does not
 * block the operator — it tells them plainly what a request will do, and the API remains the thing that
 * decides. A client-side block would be a rule nobody can rely on and a second place to disagree.
 */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10";

export type ProvTarget = { id: string; name: string; existingPracticeStatus: string | null };
export type ProvForm = {
  displayName: string; countryCode: string; timezone: string;
  professionCode: string; defaultPracticeType: string; locale: string;
};

const STEPS = ["Find account", "Verify eligibility", "Configure", "Review", "Provision"];

export function Stepper({ step }: { step: number }) {
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <li key={label} className="flex items-center gap-1.5">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
              state === "done" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                : state === "current" ? "bg-teal-700 text-white"
                  : "bg-gray-100 text-gray-400"}`}>
              {state === "done" ? "✓" : n}
            </span>
            <span className={`text-[11px] ${state === "todo" ? "text-gray-400" : "text-gray-700 font-medium"}`}>
              {label}
            </span>
            {n < STEPS.length && <span className="ml-1 text-gray-300" aria-hidden>&rarr;</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** §7.2 C step 1 — find the account. The practice is created for an identity that already exists. */
export function StepFindAccount({ query, setQuery, results, onSearch, onPick, onUseSelf, target }: {
  query: string; setQuery: (v: string) => void;
  results: { id: string; name: string; email: string | null; existingPracticeStatus: string | null }[] | null;
  onSearch: () => void;
  onPick: (t: ProvTarget) => void;
  onUseSelf: () => void;
  target: ProvTarget | null;
}) {
  return (
    <div className="mt-3">
      <p className="text-[11px] text-gray-500">
        This creates a Practice, not an identity. The person must already have a Competen account.
      </p>
      <div className="mt-2 flex gap-2">
        <input placeholder="Search name or email" value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onSearch(); } }}
          className={input} />
        <button type="button" onClick={onSearch} disabled={query.trim().length < 2}
          className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Find
        </button>
        <button type="button" onClick={onUseSelf}
          className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          Use my account
        </button>
      </div>
      {results !== null && (
        results.length === 0
          ? <p className="mt-2 text-[11px] text-gray-400">No match in the measured scope.</p>
          : (
            <ul className="mt-2 flex flex-col gap-1">
              {results.map(r => (
                <li key={r.id}>
                  <button type="button"
                    onClick={() => onPick({
                      id: r.id,
                      name: `${r.name}${r.email ? ` · ${r.email}` : ""}`,
                      existingPracticeStatus: r.existingPracticeStatus,
                    })}
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
      {target && <p className="mt-2 text-[11px] text-gray-500">Selected: <span className="font-medium text-gray-800">{target.name}</span></p>}
    </div>
  );
}

/** §7.2 C step 2 — eligibility and existing ownership, BEFORE any configuration is typed. */
export function StepVerify({ target }: { target: ProvTarget }) {
  const owns = target.existingPracticeStatus !== null;
  return (
    <div className="mt-3">
      <p className="text-[12px] text-gray-800">
        <span className="font-semibold">{target.name}</span>
      </p>
      <div className={`mt-2 rounded-lg border px-3 py-2 ${owns
        ? "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)]"
        : "border-[var(--cmp-text-success)]/30 bg-[var(--cmp-surface-success)]"}`}>
        {owns ? (
          <>
            <p className="text-[12px] font-semibold text-[var(--cmp-text-warning)]">
              This person already owns a Practice ({target.existingPracticeStatus}).
            </p>
            <p className="mt-1 text-[12px] text-gray-700">
              One individual Practice per person is enforced by the provisioning engine. Continuing will
              return the EXISTING workspace rather than creating a second one — which is safe, and is
              probably not what you came here to do.
            </p>
          </>
        ) : (
          <p className="text-[12px] text-[var(--cmp-text-success)]">
            No existing Practice is recorded against this account, so a request will create one.
          </p>
        )}
      </div>
      {/* §10: an absence is stated as an absence. The search reads workspaces not in CLOSED or FAILED,
          so a closed practice does not block a new one and is not silently counted as one either. */}
      <p className="mt-2 text-[11px] text-gray-400">
        Ownership is read from practices that are not CLOSED or FAILED.
      </p>
    </div>
  );
}

/** §7.2 C step 3 — configure the workspace. */
export function StepConfigure({ form, setForm }: {
  form: ProvForm; setForm: (fn: (p: ProvForm) => ProvForm) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
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
    </div>
  );
}

/** §7.2 C step 4 — review consequences and the idempotency key, before anything is created. */
export function StepReview({ target, form, idempotencyKey }: {
  target: ProvTarget; form: ProvForm; idempotencyKey: string;
}) {
  const rows: [string, string][] = [
    ["For", target.name],
    ["Practice name", form.displayName || "(not set)"],
    ["Profession", PROFESSIONS.find(([k]) => k === form.professionCode)?.[1] ?? form.professionCode],
    ["Practice type", PRACTICE_TYPES.find(([k]) => k === form.defaultPracticeType)?.[1] ?? form.defaultPracticeType],
    ["Market", form.countryCode],
    ["Timezone", form.timezone],
  ];
  return (
    <div className="mt-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500">{k}</dt>
            <dd className="font-medium text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
        <p className="text-[11px] font-semibold text-gray-600">What this will do</p>
        <p className="mt-1 text-[12px] text-gray-700">
          Create the workspace, make this person its owner, assign the owner capabilities, write the
          default configuration and entitlement, and open onboarding. It does not create their account
          and it does not sign them in.
        </p>
        {/* PROV-001 §8: the key is the arbiter of a replayed request, so it is shown rather than hidden.
            A UI that minted a fresh key per click would turn a double-click into two workspaces. */}
        <p className="mt-1.5 text-[10px] text-gray-500">
          Idempotency-Key <span className="font-mono">{idempotencyKey}</span> — reused until this request
          succeeds, so a double click returns the first workspace instead of creating a second.
        </p>
      </div>
      {target.existingPracticeStatus && (
        <p className="mt-2 text-[12px] font-semibold text-[var(--cmp-text-warning)]">
          Reminder: this person already owns a Practice ({target.existingPracticeStatus}). The engine will
          return it rather than create another.
        </p>
      )}
    </div>
  );
}

/** §7.2 C step 5 — provision and show the result. */
export function StepResult({ result }: {
  result: { workspaceId: string; status: string; created: boolean; nextUrl: string };
}) {
  return (
    <div className="mt-3 rounded-lg border border-[var(--cmp-text-success)]/30 bg-[var(--cmp-surface-success)] px-3 py-2">
      {/* created vs replayed is the distinction an operator needs and the one a success toast usually
          loses. Both are a 200, and only one of them made a workspace. */}
      <p className="text-[12px] font-semibold text-[var(--cmp-text-success)]">
        {result.created ? "Workspace created." : "An existing workspace was returned — nothing new was created."}
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <dt className="text-gray-500">Workspace</dt>
        <dd className="font-mono text-[11px] text-gray-900">{result.workspaceId}</dd>
        <dt className="text-gray-500">Status</dt>
        <dd className="font-medium text-gray-900">{result.status}</dd>
        <dt className="text-gray-500">Owner continues at</dt>
        <dd className="font-mono text-[11px] text-gray-900">{result.nextUrl}</dd>
      </dl>
    </div>
  );
}
