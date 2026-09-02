"use client";

import { PRACTICE_TYPES, PROFESSIONS } from "@/lib/practice/catalogs";
import { ACCESS_PRESET_DAYS } from "@/lib/practice/entitlement-period";

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

/**
 * CPR-PD-PROV-001 §4 step 2 -- the access period, as a FORM. The instants the server stores are derived
 * from this by resolveAccessPeriod below, in one place, so the figure on this step, the figure on Review
 * and the value posted cannot be three roundings of the same arithmetic.
 */
export type ProvAccess = {
  planCode: string;
  basis: "trial" | "active";
  /** §5: "Starts now or an explicitly selected future start date/time where policy permits." */
  startMode: "now" | "later";
  startDate: string;
  /** §5's duration, custom end date, or the open-ended state the basis has to permit explicitly. */
  endMode: "days" | "date" | "open";
  days: number;
  endDate: string;
};

export type ResolvedPeriod = {
  startsAt: string | null;
  endsAt: string | null;
  days: number | null;
  /** What is wrong with the form as it stands. Null when it is ready. */
  problem: string | null;
};

/**
 * The form's instants, resolved once.
 *
 * ⚠ A DATE INPUT GIVES A DAY, AND AN ENTITLEMENT NEEDS AN INSTANT. A chosen end date means "through the
 * end of that day", so it resolves to 23:59:59 rather than midnight -- resolving it to midnight would
 * quietly cut the last day off every custom period. The instant is canonical (UTC, §5: "persist
 * canonical timestamps") and the Review step renders it in the PRACTICE's timezone, so the Director
 * reads the local moment it ends rather than a Z-suffixed string.
 *
 * ⚠ AND AN UNPARSEABLE DATE RETURNS A PROBLEM RATHER THAN THROWING. `new Date("").toISOString()` throws
 * a RangeError, and an empty date field is the normal state of a form nobody has finished filling in.
 */
export function resolveAccessPeriod(a: ProvAccess): ResolvedPeriod {
  const bad = (problem: string): ResolvedPeriod => ({ startsAt: null, endsAt: null, days: null, problem });

  let startMs: number;
  if (a.startMode === "now") startMs = Date.now();
  else {
    startMs = Date.parse(`${a.startDate}T00:00:00.000Z`);
    if (Number.isNaN(startMs)) return bad("Choose the date access starts.");
  }
  const startsAt = new Date(startMs).toISOString();

  if (a.endMode === "open") return { startsAt, endsAt: null, days: null, problem: null };

  let endMs: number;
  if (a.endMode === "days") {
    if (!Number.isFinite(a.days) || a.days < 1) return bad("Choose how many days of access.");
    endMs = startMs + a.days * 86_400_000;
  } else {
    endMs = Date.parse(`${a.endDate}T23:59:59.999Z`);
    if (Number.isNaN(endMs)) return bad("Choose the date access ends.");
  }

  if (endMs <= startMs) return bad("The end must be after the start.");
  if (endMs <= Date.now()) return bad("That end has already passed, so the practice would be created locked out.");

  return {
    startsAt, endsAt: new Date(endMs).toISOString(),
    days: Math.ceil((endMs - startMs) / 86_400_000),
    problem: null,
  };
}

// ⚠ A SUPERSET OF TWO SPECIFICATIONS, NOT A COMPROMISE BETWEEN THEM. CPR-PD-014 §7.2 C asks for Find
// account / Verify eligibility / Configure / Review / Provision; CPR-PD-PROV-001 §4 asks for Practice /
// Access / Defaults / Review / Provision. PD-014's first three ARE §4's "Practice" step, taken further,
// so the two lists compose rather than conflict -- and neither is satisfied by dropping a stage from the
// other.
const STEPS = ["Find account", "Verify eligibility", "Configure", "Access", "Defaults", "Review", "Provision"];

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
                  : "bg-gray-100 text-gray-600"}`}>
              {state === "done" ? "✓" : n}
            </span>
            <span className={`text-[11px] ${state === "todo" ? "text-gray-500" : "text-gray-700 font-medium"}`}>
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
          ? <p className="mt-2 text-[11px] text-gray-500">No match in the measured scope.</p>
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
                    {r.email && <span className="ml-1.5 text-gray-500">{r.email}</span>}
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
      <p className="mt-2 text-[11px] text-gray-500">
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

/**
 * CPR-PD-PROV-001 §4 step 2 / AC-03 / AC-04 — the access period.
 *
 * ⚠ THE PLANS ARE READ FROM `practice_plans`, NEVER LISTED HERE. §3: "Plan codes and names must come
 * from canonical commercial configuration. Do not hard-code commercial plans in the provisioning
 * component." An empty list is therefore a real answer and this step says so, rather than falling back
 * to a code it made up.
 *
 * ⚠ AND THE EXPIRY IS SHOWN AS THE DURATION CHANGES (§16, AC-05), not held back for the Review step.
 * The point of a duration control is the date it produces; a Director choosing "90 days" is really
 * choosing a day in December, and making them press Next to find out which one is the whole complaint
 * §16 is making about dense administrative forms.
 */
export function StepAccess({ access, setAccess, plans, timezone }: {
  access: ProvAccess;
  setAccess: (fn: (p: ProvAccess) => ProvAccess) => void;
  plans: { planCode: string; name: string; trialDays: number | null }[];
  timezone: string;
}) {
  const resolved = resolveAccessPeriod(access);
  const plan = plans.find(p => p.planCode === access.planCode) ?? null;

  return (
    <div className="mt-3 space-y-3">
      {plans.length === 0 ? (
        <p className="rounded-lg border border-[var(--cmp-text-warning)]/40 bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-gray-800">
          No active plan could be read from the commercial catalogue, so there is nothing to create this
          practice on. Provisioning without a plan is what leaves a workspace nobody can open.
        </p>
      ) : (
        <>
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-700">Plan</span>
            <select value={access.planCode} className={`mt-1 ${input}`}
              onChange={e => {
                const code = e.target.value;
                const p = plans.find(x => x.planCode === code);
                // The plan's own trial length becomes the SUGGESTED duration. It is not imposed: the
                // owner's decision is that the Director determines the period, so this fills the field
                // and the Director can change it.
                setAccess(a => ({ ...a, planCode: code, days: p?.trialDays ?? a.days }));
              }}>
              {plans.map(p => (
                <option key={p.planCode} value={p.planCode}>
                  {p.name}{p.trialDays ? ` — ${p.trialDays}-day default` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold text-gray-700">Access basis</span>
            <select value={access.basis} className={`mt-1 ${input}`}
              onChange={e => setAccess(a => ({ ...a, basis: e.target.value as "trial" | "active" }))}>
              <option value="trial">Trial — evaluation access</option>
              <option value="active">Active — a commercial plan</option>
            </select>
            <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-500">
              {access.basis === "trial"
                ? "Honest about what it is while nothing is billed."
                : "Says a subscription exists. Nothing in this product bills for one yet, so this records a commercial arrangement made elsewhere."}
            </span>
          </label>

          <fieldset>
            <legend className="text-[11px] font-semibold text-gray-700">Starts</legend>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {(["now", "later"] as const).map(m => (
                <label key={m} className="flex items-center gap-1.5 text-[12px] text-gray-700">
                  <input type="radio" name="startMode" checked={access.startMode === m}
                    onChange={() => setAccess(a => ({ ...a, startMode: m }))} />
                  {m === "now" ? "Now" : "On a chosen date"}
                </label>
              ))}
              {access.startMode === "later" && (
                <input type="date" value={access.startDate}
                  onChange={e => setAccess(a => ({ ...a, startDate: e.target.value }))}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-[12px]" />
              )}
            </div>
            {access.startMode === "later" && (
              // §15: "Future-start entitlement shows Scheduled and must not permit early access."
              <p className="mt-1 text-[11px] text-gray-500">
                The practice exists immediately and stays closed until this date. Its owner sees a
                scheduled state, not a fault.
              </p>
            )}
          </fieldset>

          <fieldset>
            <legend className="text-[11px] font-semibold text-gray-700">Ends</legend>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {ACCESS_PRESET_DAYS.map(d => (
                <button key={d} type="button"
                  onClick={() => setAccess(a => ({ ...a, endMode: "days", days: d }))}
                  className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${
                    access.endMode === "days" && access.days === d
                      ? "bg-teal-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                  {d} days
                </button>
              ))}
              <input type="date" value={access.endDate}
                onChange={e => setAccess(a => ({ ...a, endMode: "date", endDate: e.target.value }))}
                className={`rounded-lg border px-2 py-1 text-[12px] ${
                  access.endMode === "date" ? "border-teal-600" : "border-gray-200"}`} />
              <button type="button" onClick={() => setAccess(a => ({ ...a, endMode: "open" }))}
                className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${
                  access.endMode === "open" ? "bg-teal-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                Open-ended
              </button>
            </div>
            {access.endMode === "open" && (
              // §5: "Do not treat a missing end date as unlimited access unless the selected entitlement
              // type explicitly permits open-ended access." So it is a button somebody presses, and it
              // says what it means rather than being the state a blank field falls into.
              <p className="mt-1 text-[11px] font-semibold text-[var(--cmp-text-warning)]">
                No end date. This practice stays open until somebody ends it by hand.
              </p>
            )}
          </fieldset>

          {/* ⚠ §16 / AC-05: THE CALCULATED EXPIRY, HERE, AS THE DURATION CHANGES. */}
          <div className={`rounded-lg px-3 py-2 text-[12px] ${
            resolved.problem
              ? "border border-[var(--cmp-text-critical)]/30 bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
              : "border border-teal-200 bg-teal-50/60 text-gray-800"}`}>
            {resolved.problem
              ? resolved.problem
              : resolved.endsAt === null
                ? <>Access starts {whenIn(resolved.startsAt, timezone)} and does not expire.</>
                : <>Access runs from {whenIn(resolved.startsAt, timezone)} to{" "}
                  <span className="font-bold">{whenIn(resolved.endsAt, timezone)}</span>
                  {resolved.days !== null && <> — {resolved.days} day{resolved.days === 1 ? "" : "s"}</>}.</>}
          </div>

          {plan && access.basis === "active" && plan.trialDays !== null && (
            // §12: "Billing-authoritative subscriptions must not be silently overwritten by a PD manual
            // entitlement action." Nothing bills here yet, so this names the mismatch instead of hiding it.
            <p className="text-[11px] text-gray-500">
              {plan.name} defines a {plan.trialDays}-day trial. You are recording it as a commercial plan
              instead, which is a decision made outside this product.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** An instant, in the practice's own timezone, with the zone named so the reader can check it. */
function whenIn(iso: string | null, timeZone: string): string {
  if (!iso) return "(not set)";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone,
    }) + ` (${timeZone})`;
  } catch {
    // An unrecognised timezone must not take the step down; the instant is still true.
    return new Date(iso).toISOString();
  }
}

/**
 * CPR-PD-PROV-001 §4 step 3 — the defaults, shown rather than re-entered.
 *
 * §4: "Apply canonical CP default settings/provisioning template; show exceptions rather than requiring
 * repetitive setup." So this step asks for nothing. Its whole job is to let a Director see what the new
 * practice will come up with, and notice when that is not what they wanted BEFORE it is created.
 *
 * ⚠ IT DISTINGUISHES `materialised` FROM `inherited`, AND THAT IS THE USEFUL PART. A materialised
 * default is a record the practice can find and change from its own settings. An inherited one is
 * nothing at all -- no row is written, and the behaviour is simply what the enforcement point does when
 * a practice has configured nothing. Reading "walk-ins: off" without that distinction tells a Director
 * a switch exists somewhere that does not.
 */
export function StepDefaults({ baseline }: {
  baseline: { version: string; areas: { key: string; value: string; enforcement: string; where: string }[] };
}) {
  return (
    <div className="mt-3">
      <p className="text-[12px] text-gray-700">
        This practice will be created with the <span className="font-semibold">{baseline.version}</span>{" "}
        template. Nothing here needs setting up now, and its owner can change any of it afterwards.
      </p>
      <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
        {baseline.areas.map(a => (
          <li key={a.key} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
            <span className="text-[12px] font-medium text-gray-900">{a.key.replace(/_/g, " ")}</span>
            <span className="text-[12px] text-gray-600">{a.value}</span>
            <span className={`ml-auto rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${
              a.enforcement === "materialised" ? "bg-teal-100 text-teal-800" : "bg-gray-100 text-gray-600"}`}
              title={a.enforcement === "materialised"
                ? `A record is written for this during provisioning (${a.where}), so the practice can see and change it.`
                : `Nothing is written. This is simply how ${a.where} behaves when a practice has configured nothing.`}>
              {a.enforcement === "materialised" ? "written" : "inherited"}
            </span>
          </li>
        ))}
      </ul>
      {/* Honest about the one thing this step cannot promise. */}
      <p className="mt-2 text-[11px] text-gray-500">
        Seeding these does not fail provisioning: a practice that comes up without its starter rule is
        recoverable from Practice Setup in minutes, and a run halted here would leave a half-built
        practice behind instead. The result step reports what actually happened.
      </p>
    </div>
  );
}

/** §7.2 C step 4 — review consequences and the idempotency key, before anything is created. */
export function StepReview({ target, form, access, plans, idempotencyKey }: {
  target: ProvTarget; form: ProvForm; idempotencyKey: string;
  access: ProvAccess;
  plans: { planCode: string; name: string; trialDays: number | null }[];
}) {
  // CPR-PD-PROV-001 §6 / AC-05: plan, exact start, exact end, calculated duration -- resolved by the
  // SAME function the Access step displayed, so this card cannot promise a different date from the one
  // the Director just chose.
  const resolved = resolveAccessPeriod(access);
  const planName = plans.find(p => p.planCode === access.planCode)?.name ?? access.planCode;

  const rows: [string, string][] = [
    ["For", target.name],
    ["Practice name", form.displayName || "(not set)"],
    ["Profession", PROFESSIONS.find(([k]) => k === form.professionCode)?.[1] ?? form.professionCode],
    ["Practice type", PRACTICE_TYPES.find(([k]) => k === form.defaultPracticeType)?.[1] ?? form.defaultPracticeType],
    ["Market", form.countryCode],
    ["Timezone", form.timezone],
    ["Plan", planName],
    ["Access basis", access.basis === "trial" ? "Trial — evaluation access" : "Active — a commercial plan"],
    ["Access starts", whenIn(resolved.startsAt, form.timezone)],
    ["Access ends", resolved.endsAt === null ? "Open-ended — no expiry" : whenIn(resolved.endsAt, form.timezone)],
    ["Duration", resolved.days === null ? (resolved.endsAt === null ? "unlimited until ended by hand" : "—") : `${resolved.days} days`],
    // §6 asks for renewal: automatic / manual / billing-managed / not applicable. Answered honestly.
    ["Renewal", "Manual — nothing in this product renews or bills a Practice plan"],
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
          default configuration, create the access period above, apply the Competen standard defaults and
          open onboarding. It does not create their account and it does not sign them in.
        </p>
        {/* §6: "What happens at expiry." Said before the write, because it is the consequence of the
            number chosen two steps ago and the one nobody thinks about while choosing it. */}
        <p className="mt-1.5 text-[12px] text-gray-700">
          {resolved.endsAt === null
            ? "This access period has no end, so nothing will close it: the practice stays open until somebody ends it deliberately."
            : "At that moment the practice closes. Its owner sees the end date and a route to ask for more time, "
              + "nothing is deleted, and a Product Director can extend or reopen it from the practice's own record."}
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
