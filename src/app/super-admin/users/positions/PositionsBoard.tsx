"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Read } from "@/lib/hq/appointments";
import { SPACE_LABEL } from "@/lib/hq/appointments";
import { HQ_SPACES, type HqSpace } from "@/lib/hq/spaces";
import {
  HQ_CAPABILITY_PAIRS, MIN_REASON, POSITION_CODE_RE, SENSITIVE_LABEL, effectiveExclusions, exclusionConflict,
  type HqCatalogueEntry, type HqGrantView, type HqPositionAdminView, type HqPositionBoard, type HqSensitiveClass, type HqSodPolicy,
} from "@/lib/hq/positions";

/**
 * The HQ positions screen. Every button posts one action to /api/hq/positions, and every refusal shown is
 * the database's own sentence. Three states everywhere: a section that could not be read says so and is
 * never drawn as empty.
 */

type Props = {
  board: HqPositionBoard;
  migrationApplied: boolean;
  canAdminister: boolean;
  isOwner: boolean;
  viewerName: string | null;
};

type Say = (k: "ok" | "err", t: string) => void;
type Post = (body: Record<string, unknown>, key: string, okText: string) => Promise<boolean>;

const input = "border border-gray-300 rounded-lg px-2 py-1 text-sm min-h-9 pointer-coarse:min-h-11";
const btn = "text-[12px] font-medium rounded-lg px-3 py-1.5 min-h-9 pointer-coarse:min-h-11 disabled:opacity-40";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const danger = `${btn} border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] hover:bg-[var(--cmp-surface-error)]`;
const quiet = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`;

const Unreadable = ({ what, error }: { what: string; error: string }) => (
  <p className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">
    <span className="font-semibold">{what} could not be read.</span> This is not a zero. <span className="text-amber-800/80">({error})</span>
  </p>
);

const SensitiveBadge = ({ c }: { c: HqSensitiveClass | null }) => c && (
  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--cmp-surface-warning)] text-amber-900" title="Its grant needs the owner, a reason and an explicit acknowledgement">
    {SENSITIVE_LABEL[c]}
  </span>
);

const day = (s: string | null) => (s ? s.slice(0, 10) : "date not recorded");

function ReasonField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-[12px] text-gray-600 w-full">
      Reason (written to the audit trail, at least {MIN_REASON} characters)
      <input id={id} value={value} onChange={e => onChange(e.target.value)} className={`${input} w-full`} maxLength={500} />
    </label>
  );
}

// ── Create ───────────────────────────────────────────────────────────────────
function CreatePosition({ post, busy }: { post: Post; busy: string | null }) {
  const [code, setCode] = useState("");
  const [space, setSpace] = useState<HqSpace>("quality");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const codeOk = POSITION_CODE_RE.test(code);
  const ready = codeOk && name.trim() && reason.trim().length >= MIN_REASON;
  return (
    <details className="rounded-xl border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold text-gray-900">Create a position</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] text-gray-600">
          Code (permanent, lower-case, e.g. competency_author)
          <input value={code} onChange={e => setCode(e.target.value.trim())} className={input} maxLength={63} aria-invalid={!!code && !codeOk} />
          {code && !codeOk && <span className="text-[var(--cmp-text-error)]">3 to 63 lower-case letters, digits or underscores, starting with a letter.</span>}
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-gray-600">
          Space (permanent)
          <select value={space} onChange={e => setSpace(e.target.value as HqSpace)} className={input}>
            {HQ_SPACES.map(s => <option key={s} value={s}>{SPACE_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-gray-600">
          Name
          <input value={name} onChange={e => setName(e.target.value)} className={input} maxLength={120} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-gray-600">
          Description
          <input value={description} onChange={e => setDescription(e.target.value)} className={input} maxLength={500} />
        </label>
        <div className="sm:col-span-2"><ReasonField id="create-reason" value={reason} onChange={setReason} /></div>
      </div>
      <p className="mt-2 text-[12px] text-gray-500">
        The new position gets the HQ landing page and nothing else. Grant its capabilities below once it exists.
        Nobody is appointed to it until you do that on the appointments screen.
      </p>
      <button
        className={`${primary} mt-3`} disabled={!ready || busy === "create"}
        onClick={async () => {
          if (await post({ action: "create", code, space, name, description, reason }, "create", `Created ${name}. It holds the HQ landing page only.`)) {
            setCode(""); setName(""); setDescription(""); setReason("");
          }
        }}
      >
        Create position
      </button>
    </details>
  );
}

// ── Catalogue sync ───────────────────────────────────────────────────────────
function RegisterRow({ c, post, busy, canAdminister }: { c: HqCatalogueEntry; post: Post; busy: string | null; canAdminister: boolean }) {
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  return (
    <li className="rounded-lg border border-gray-100 px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-[12px] text-gray-800">{c.code}</code>
        <span className="text-[11px] text-gray-500">{SPACE_LABEL[c.space]} space (from code)</span>
        <SensitiveBadge c={c.sensitive} />
      </div>
      {canAdminister && (
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] items-end">
          <label className="flex flex-col gap-1 text-[12px] text-gray-600">Label
            <input value={label} onChange={e => setLabel(e.target.value)} className={input} maxLength={120} />
          </label>
          <ReasonField id={`reg-${c.code}`} value={reason} onChange={setReason} />
          <button
            className={quiet} disabled={!label.trim() || reason.trim().length < MIN_REASON || busy === `reg-${c.code}`}
            onClick={() => post({ action: "register", capability: c.code, label, reason }, `reg-${c.code}`, `Registered ${c.code}. It grants nothing until you grant it to a position.`)}
          >
            Register
          </button>
        </div>
      )}
    </li>
  );
}

function CatalogueSync({ board, post, busy, canAdminister }: { board: HqPositionBoard; post: Post; busy: string | null; canAdminister: boolean }) {
  if (!board.catalogue.ok) return <Unreadable what="The capability catalogue" error={board.catalogue.error} />;
  const missing = board.catalogue.value.filter(c => !c.applied);
  const extra = board.appliedNotInCode.ok ? board.appliedNotInCode.value : [];
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold text-gray-900">Capability catalogue</h2>
      <p className="text-[12px] text-gray-600 max-w-3xl">
        Capabilities are defined in code, because routes enforce them. This screen can only grant a capability the
        code defines and the database holds. {board.catalogue.value.length - missing.length} of {board.catalogue.value.length} code-defined
        capabilities are in the database.
      </p>
      {missing.length > 0 && (
        <details className="rounded-xl border border-gray-200 bg-white p-4" open>
          <summary className="cursor-pointer text-sm text-gray-800">
            <span className="font-bold text-lg text-gray-900">{missing.length}</span> code-defined capabilit{missing.length === 1 ? "y is" : "ies are"} not in the database yet
          </summary>
          <p className="mt-2 text-[12px] text-gray-500">
            Registering inserts the catalogue row only. It grants nothing, and it does not apply the migration that
            introduced the capability, so any table or rule that migration adds is still missing until it is applied.
          </p>
          <ul className="mt-2 space-y-2">
            {missing.map(c => <RegisterRow key={c.code} c={c} post={post} busy={busy} canAdminister={canAdminister} />)}
          </ul>
        </details>
      )}
      {!board.appliedNotInCode.ok
        ? <Unreadable what="The applied catalogue" error={board.appliedNotInCode.error} />
        : extra.length > 0 && (
          <p className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">
            The database holds {extra.length} capabilit{extra.length === 1 ? "y" : "ies"} the code does not define ({extra.join(", ")}). No route enforces
            {extra.length === 1 ? " it" : " them"}, and hq-guard B1 is red until the code or the database is corrected.
          </p>
        )}
    </section>
  );
}

// ── One position ─────────────────────────────────────────────────────────────
function GrantRow({ g, canAdminister, onEnd, busy }: { g: HqGrantView; canAdminister: boolean; busy: string | null; onEnd: (g: HqGrantView) => void }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5 border-t border-gray-50 first:border-0 text-[12px]">
      <code className={g.live ? "text-gray-900" : "text-gray-500 line-through"}>{g.capability}</code>
      {g.label && <span className="text-gray-500">{g.label}</span>}
      <SensitiveBadge c={g.sensitive} />
      {!g.inCodeCatalogue && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--cmp-surface-warning)] text-amber-900">Not defined in code</span>}
      <span className="text-gray-500">
        from {day(g.effectiveFrom)}{g.effectiveTo ? ` to ${day(g.effectiveTo)}` : ""}
        {g.source !== "position_default" ? ` · ${g.source.replace("_", " ")}` : " · set by migration"}
        {g.grantReason ? ` · why: ${g.grantReason}` : ""}
        {g.endReason ? ` · ended because: ${g.endReason}` : ""}
      </span>
      {canAdminister && g.live && (
        <button className={`${danger} ml-auto`} disabled={busy === `end-${g.id}`} onClick={() => onEnd(g)}>End grant</button>
      )}
    </li>
  );
}

function PositionCard({ p, catalogue, exclusions, canAdminister, post, busy, say }: {
  p: HqPositionAdminView; catalogue: Read<HqCatalogueEntry[]>; exclusions: readonly { a: string; b: string; reason: string }[];
  canAdminister: boolean; post: Post; busy: string | null; say: Say;
}) {
  const [reason, setReason] = useState("");
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description ?? "");
  const [cap, setCap] = useState("");
  const [ack, setAck] = useState(false);
  const reasonOk = reason.trim().length >= MIN_REASON;

  const grants = p.grants.ok ? p.grants.value : [];
  const live = grants.filter(g => g.live);
  const ended = grants.filter(g => !g.live);
  const liveCodes = live.map(g => g.capability);
  const everHeld = new Set(grants.map(g => g.capability));

  /** Why a capability cannot be granted here, or null when it can. The database refuses the same set. */
  const blocked = (c: HqCatalogueEntry): string | null => {
    if (!c.applied) return "not in the database yet: register it first";
    if (liveCodes.includes(c.code)) return "already held";
    if (everHeld.has(c.code)) return "held before and ended: kept as history, not reopened";
    const x = exclusionConflict(c.code, liveCodes, exclusions);
    return x ? `separation of duties: ${x.reason}` : null;
  };
  const chosen = catalogue.ok ? catalogue.value.find(c => c.code === cap) ?? null : null;
  const guard = (ok: boolean) => { if (!reasonOk) say("err", `Give a reason of at least ${MIN_REASON} characters first. It is written to the audit trail.`); return ok && reasonOk; };

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
        <span className="font-semibold text-gray-900">{p.name}</span>
        <code className="text-[10px] text-gray-500 bg-gray-50 rounded px-1.5 py-0.5">{p.code}</code>
        {!p.isActive && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--cmp-surface-warning)] text-amber-900">Deactivated: grants nothing</span>
        )}
        <span className="text-[11px] text-gray-500 ml-auto">{p.grants.ok ? `${live.length} live grant${live.length === 1 ? "" : "s"}` : ""}</span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {p.description && <p className="text-[12px] text-gray-600">{p.description}</p>}
        {p.rules && (
          <p className="text-[12px] text-gray-600">
            Holders: {p.rules.maxHolders === null ? "unlimited" : `at most ${p.rules.maxHolders}`} · Primary coordinator: {PRIMARY_LABEL[p.rules.primaryPolicy]}
            {" · "}{p.rules.scopedAppointments ? "each appointment names the capabilities it carries" : "an appointment carries the whole position unless scoped"}
            {p.rules.productLine ? ` · Product line: ${p.rules.productLine}` : ""}
          </p>
        )}
        {!p.grants.ok ? <Unreadable what="This position's grants" error={p.grants.error} /> : (
          <>
            {live.length === 0
              ? <p className="text-[12px] text-gray-500">No live grant. Anyone appointed to it reaches nothing.</p>
              : <ul>{live.map(g => (
                  <GrantRow key={g.id} g={g} canAdminister={canAdminister} busy={busy}
                    onEnd={gr => guard(true) && post({ action: "end_grant", code: p.code, capability: gr.capability, reason }, `end-${gr.id}`,
                      `Ended ${gr.capability} on ${p.name}. The grant row is kept with when and why it ended.`).then(ok => ok && setReason(""))} />
                ))}</ul>}
            {ended.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[12px] text-gray-600">{ended.length} ended grant{ended.length === 1 ? "" : "s"} (history)</summary>
                <ul className="mt-1">{ended.map(g => <GrantRow key={g.id} g={g} canAdminister={false} busy={busy} onEnd={() => {}} />)}</ul>
              </details>
            )}
          </>
        )}

        {canAdminister && (
          <div className="rounded-lg bg-gray-50 p-3 space-y-3">
            <ReasonField id={`reason-${p.code}`} value={reason} onChange={setReason} />

            {p.isActive && p.grants.ok && catalogue.ok && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[12px] text-gray-600 grow min-w-0">
                  Grant a capability
                  <select value={cap} onChange={e => { setCap(e.target.value); setAck(false); }} className={`${input} w-full`}>
                    <option value="">Choose a code-defined capability</option>
                    {catalogue.value.map(c => {
                      const why = blocked(c);
                      return <option key={c.code} value={c.code} disabled={!!why}>{c.code}{c.sensitive ? ` [${SENSITIVE_LABEL[c.sensitive]}]` : ""}{why ? `: ${why}` : ""}</option>;
                    })}
                  </select>
                </label>
                {chosen?.sensitive && (
                  <label className="flex items-center gap-2 text-[12px] text-amber-900">
                    <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="size-4" />
                    I am granting a {SENSITIVE_LABEL[chosen.sensitive].toLowerCase()}
                  </label>
                )}
                <button
                  className={primary} disabled={!cap || (!!chosen?.sensitive && !ack) || busy === `grant-${p.code}`}
                  onClick={() => guard(true) && post({ action: "grant", code: p.code, capability: cap, reason, acknowledge_sensitive: ack }, `grant-${p.code}`,
                    `Granted ${cap} to ${p.name}. Everyone appointed to it holds it now.`).then(ok => { if (ok) { setCap(""); setAck(false); setReason(""); } })}
                >
                  Grant
                </button>
              </div>
            )}

            {p.rules && <AppointmentRules p={p} rules={p.rules} reason={reason} guard={guard} post={post} busy={busy} onDone={() => setReason("")} />}

            <details>
              <summary className="cursor-pointer text-[12px] text-gray-600">Edit name and description</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr_auto] items-end">
                <label className="flex flex-col gap-1 text-[12px] text-gray-600">Name
                  <input value={name} onChange={e => setName(e.target.value)} className={input} maxLength={120} />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-gray-600">Description
                  <input value={description} onChange={e => setDescription(e.target.value)} className={input} maxLength={500} />
                </label>
                <button className={quiet} disabled={!name.trim() || busy === `edit-${p.code}`}
                  onClick={() => guard(true) && post({ action: "update", code: p.code, name, description, reason }, `edit-${p.code}`, `Saved ${name}.`).then(ok => ok && setReason(""))}>
                  Save
                </button>
              </div>
            </details>

            <button
              className={p.isActive ? danger : quiet} disabled={busy === `active-${p.code}`}
              onClick={() => guard(true) && post({ action: "set_active", code: p.code, active: !p.isActive, reason }, `active-${p.code}`,
                p.isActive ? `${p.name} is deactivated. Its holders reach nothing through it. It can be reactivated.` : `${p.name} is active again.`).then(ok => ok && setReason(""))}
            >
              {p.isActive ? "Deactivate position" : "Reactivate position"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Appointment rules (migration 641) ────────────────────────────────────────
const PRIMARY_LABEL: Record<"not_used" | "optional" | "required", string> = {
  not_used: "not used", optional: "optional", required: "required",
};

/** Many holders by default. The owner may cap a role, require a primary coordinator, or require scoped appointments. */
function AppointmentRules({ p, rules, reason, guard, post, busy, onDone }: {
  p: HqPositionAdminView; rules: NonNullable<HqPositionAdminView["rules"]>; reason: string;
  guard: (ok: boolean) => boolean; post: Post; busy: string | null; onDone: () => void;
}) {
  const [max, setMax] = useState(rules.maxHolders === null ? "" : String(rules.maxHolders));
  const [primary, setPrimary] = useState(rules.primaryPolicy);
  const [scoped, setScoped] = useState(rules.scopedAppointments);
  const [line, setLine] = useState(rules.productLine ?? "");
  const maxOk = max.trim() === "" || (/^\d+$/.test(max.trim()) && Number(max) >= 1);
  return (
    <details>
      <summary className="cursor-pointer text-[12px] text-gray-600">Appointment rules</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 items-end text-[12px] text-gray-600">
        <label className="flex flex-col gap-1">Maximum concurrent holders (empty = unlimited)
          <input value={max} onChange={e => setMax(e.target.value)} className={input} inputMode="numeric" aria-invalid={!maxOk} />
        </label>
        <label className="flex flex-col gap-1">Primary coordinator or accountable owner
          <select value={primary} onChange={e => setPrimary(e.target.value as typeof primary)} className={input}>
            <option value="not_used">Not used</option>
            <option value="optional">Optional</option>
            <option value="required">Required by policy</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={scoped} onChange={e => setScoped(e.target.checked)} className="size-4" />
          Each appointment must name the capabilities it carries (a broad role grants nothing by default)
        </label>
        <label className="flex flex-col gap-1">Product line code (empty = all of HQ)
          <input value={line} onChange={e => setLine(e.target.value.trim())} className={input} maxLength={63} />
        </label>
      </div>
      <button className={`${quiet} mt-2`} disabled={!maxOk || busy === `rules-${p.code}`}
        onClick={() => guard(true) && post({ action: "set_rules", code: p.code, max_holders: max.trim() === "" ? null : Number(max), primary_policy: primary,
          scoped_appointments: scoped, product_line: line || null, reason }, `rules-${p.code}`, `Saved the appointment rules of ${p.name}.`).then(ok => ok && onDone())}>
        Save rules
      </button>
    </details>
  );
}

// ── Separation of duties (migration 640) ─────────────────────────────────────
/**
 * The no-code separation-of-duties settings: which pairs may sit on one position, strict separation, multiple
 * appointments, and extra rules per content type. ⚠ THE ITEM-LEVEL PROTECTIONS ARE NOT HERE BECAUSE THEY ARE
 * NOT SWITCHABLE. The panel says what they are, so nobody reads an allowed pair as permission to approve their
 * own work.
 */
function SeparationOfDuties({ sod, post, busy, canAdminister, say }: {
  sod: Read<HqSodPolicy> | undefined; post: Post; busy: string | null; canAdminister: boolean; say: Say;
}) {
  const [reason, setReason] = useState("");
  const reasonOk = reason.trim().length >= MIN_REASON;
  const send = (body: Record<string, unknown>, key: string, okText: string) => {
    if (!reasonOk) { say("err", `Give a reason of at least ${MIN_REASON} characters first. It is written to the audit trail.`); return; }
    void post({ ...body, reason }, key, okText).then(ok => ok && setReason(""));
  };
  const policy = sod?.ok ? sod.value : null;

  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold text-gray-900">Separation of duties</h2>
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
        <div className="rounded-lg bg-[var(--cmp-surface-success)] px-3 py-2 text-[12px] text-green-900 max-w-3xl">
          <p className="font-semibold">Always on, for every content item and version, whatever positions a person holds:</p>
          <ul className="list-disc ml-5 mt-1 space-y-0.5">
            <li>Nobody approves content they, or any earlier version of it, authored, edited or submitted. Resubmitting, reassigning, delegating or a second appointment does not change that.</li>
            <li>Nobody publishes content they authored, edited, submitted or reviewed as its educator.</li>
            <li>Nobody sets or widens their own reviewer scope. Only the platform owner lowers the number of independent approvals.</li>
            <li>Each version needs its own approvals, and a changed version needs new ones. Every change is audited.</li>
          </ul>
        </div>

        {!policy ? (
          <p className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">
            The separation settings could not be read{sod && !sod.ok ? ` (${sod.error})` : ""}. Until migration 640 is applied every pair
            below is blocked on positions, exactly as before.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2 text-[12px]">
              <div className="rounded-lg border border-gray-100 p-3 space-y-1">
                <p className="font-semibold text-gray-900">Strict position-level separation: {policy.strict ? "On" : "Off"}</p>
                <p className="text-gray-600">{policy.strict
                  ? "Every pair below is blocked on a position, whatever its own setting."
                  : "Each pair follows its own setting. Turn this on as the organisation grows. It is refused while a position or person still holds a pair."}</p>
                {canAdminister && (
                  <button className={quiet} disabled={busy === "sod-strict"}
                    onClick={() => send({ action: "set_settings", strict: !policy.strict, multiple_appointments: policy.multipleAppointments }, "sod-strict",
                      policy.strict ? "Strict separation is off. Each pair follows its own setting." : "Strict separation is on. Every pair is blocked on positions.")}>
                    {policy.strict ? "Turn strict separation off" : "Turn strict separation on"}
                  </button>
                )}
              </div>
              <div className="rounded-lg border border-gray-100 p-3 space-y-1">
                <p className="font-semibold text-gray-900">Multiple appointments per person: {policy.multipleAppointments ? "Allowed" : "Not allowed"}</p>
                <p className="text-gray-600">{policy.multipleAppointments
                  ? "A person may hold several HQ appointments. What they may do is the union of them within one product, and the per-item rules apply across all of them."
                  : "A person holds one HQ appointment at a time. Prefer one cross-cutting position."}</p>
                {canAdminister && (
                  <button className={quiet} disabled={busy === "sod-multi"}
                    onClick={() => send({ action: "set_settings", strict: policy.strict, multiple_appointments: !policy.multipleAppointments }, "sod-multi",
                      policy.multipleAppointments ? "Multiple appointments are switched off." : "Multiple appointments are allowed.")}>
                    {policy.multipleAppointments ? "Switch multiple appointments off" : "Allow multiple appointments"}
                  </button>
                )}
              </div>
            </div>

            <details>
              <summary className="cursor-pointer text-sm text-gray-800">
                {policy.pairs.filter(p => policy.strict || !p.allowed).length} of {policy.pairs.length} capability pairs are blocked on positions
              </summary>
              <ul className="mt-2 space-y-2 text-[12px] text-gray-700">
                {policy.pairs.map(p => {
                  const blocked = policy.strict || !p.allowed;
                  return (
                    <li key={`${p.a}|${p.b}`} className="rounded-lg border border-gray-100 px-3 py-2 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code>{p.a}</code> with <code>{p.b}</code>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${blocked ? "bg-gray-100 text-gray-800" : "bg-[var(--cmp-surface-success)] text-green-800"}`}>
                          {blocked ? "Blocked on positions" : "May share a position"}
                        </span>
                        {!p.liftable && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--cmp-surface-warning)] text-amber-900">Always blocked</span>}
                        {canAdminister && p.liftable && (
                          <button className={`${quiet} ml-auto`} disabled={busy === `pair-${p.a}-${p.b}`}
                            onClick={() => send({ action: "set_pair", a: p.a, b: p.b, allowed: !p.allowed }, `pair-${p.a}-${p.b}`,
                              p.allowed ? `Blocked ${p.a} with ${p.b} on positions.` : `${p.a} and ${p.b} may now share a position. The item-level rule still applies.`)}>
                            {p.allowed ? "Block" : "Allow"}
                          </button>
                        )}
                      </div>
                      <p className="text-gray-500">When blocked: {p.reason}.</p>
                      <p className="text-gray-500">{p.liftable
                        ? `Item-level safeguard that makes it safe to allow: ${p.safeguard}`
                        : "No equal or stronger item-level safeguard exists, so it cannot be allowed."}</p>
                    </li>
                  );
                })}
              </ul>
            </details>

            <div className="space-y-1">
              <p className="text-sm text-gray-800">Extra separation by content type</p>
              <ul className="space-y-1 text-[12px] text-gray-700">
                {policy.contentRules.map(r => (
                  <li key={r.kind} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
                    <span className="font-medium text-gray-900">{r.label}</span>
                    <span className="text-gray-600">The publisher may not be one of its clinical approvers: {r.publisherNotApprover ? "Required" : "Not required"}</span>
                    {canAdminister && (
                      <button className={`${quiet} ml-auto`} disabled={busy === `rule-${r.kind}`}
                        onClick={() => send({ action: "set_content_rule", kind: r.kind, publisher_not_approver: !r.publisherNotApprover }, `rule-${r.kind}`,
                          `${r.label}: the publisher-not-approver rule is ${r.publisherNotApprover ? "off" : "on"}.`)}>
                        {r.publisherNotApprover ? "Stop requiring" : "Require"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {canAdminister && <ReasonField id="sod-reason" value={reason} onChange={setReason} />}
          </>
        )}
        <p className="text-[12px] text-gray-500">
          {HQ_CAPABILITY_PAIRS.filter(p => !p.liftable).length} pairs are always blocked: the competency assessor stays separate from content
          approval and the Verification Studio, and a research proposer never reviews or governs research.
        </p>
      </div>
    </section>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────
export default function PositionsBoard({ board, migrationApplied, canAdminister, isOwner, viewerName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const say: Say = (k, t) => setMsg({ k, t });
  // What the database refuses on a position now. Unreadable policy (640 absent) counts every pair, as 580 did.
  const exclusions = effectiveExclusions(board.sod ?? { ok: false, error: "not loaded" });

  const post: Post = async (body, key, okText) => {
    setBusy(key); setMsg(null);
    try {
      const r = await fetch("/api/hq/positions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { say("ok", okText); router.refresh(); return true; }
      say("err", j.error ?? `The request failed (HTTP ${r.status}). Nothing was changed.`);
    } catch {
      say("err", "The request did not reach the server, so nothing was changed.");
    } finally {
      setBusy(null);
    }
    return false;
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-gray-900">HQ positions and grants</h1>
        <p className="text-gray-500 text-sm mt-1 max-w-3xl">
          Create a position, decide what it grants, and end grants it should no longer hold. Every change is written
          to the audit trail before it is made. Positions are deactivated, never deleted, and an ended grant stays as
          history. To put a person in a position, use <Link href="/super-admin/users/appointments" className="text-teal-700 hover:underline">appointments</Link>.
        </p>
      </header>

      {msg && (
        <p role="status" className={`text-sm rounded-lg px-3 py-2 ${msg.k === "ok" ? "bg-[var(--cmp-surface-success)] text-green-800" : "bg-[var(--cmp-surface-error)] text-red-800"}`}>
          {msg.t}
        </p>
      )}
      {!migrationApplied && (
        <p className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">
          Changes are not available yet: this database does not have migration 500. You can read the positions below.
        </p>
      )}
      {!isOwner && (
        <p className="text-sm rounded-lg px-3 py-2 bg-gray-100 text-gray-700">
          You are signed in as {viewerName ?? "an appointed HQ user"} and can read this screen. Changing positions is
          reserved to a platform owner, and the database refuses it for anyone else, so no button is shown.
        </p>
      )}

      {canAdminister && <CreatePosition post={post} busy={busy} />}

      <CatalogueSync board={board} post={post} busy={busy} canAdminister={canAdminister} />

      <SeparationOfDuties sod={board.sod} post={post} busy={busy} canAdminister={canAdminister} say={say} />

      {!board.positions.ok ? <Unreadable what="The positions" error={board.positions.error} /> : (
        <div className="space-y-8">
          {HQ_SPACES.map(s => {
            const list = board.positions.ok ? board.positions.value.filter(p => p.space === s) : [];
            return (
              <section key={s} className="space-y-3">
                <h2 className="text-base font-bold text-gray-900">{SPACE_LABEL[s]} space <span className="text-gray-500 font-normal text-sm">· {list.length} position{list.length === 1 ? "" : "s"}</span></h2>
                {list.length === 0
                  ? <p className="text-[12px] text-gray-500">No position in this space.</p>
                  : <div className="grid gap-3 lg:grid-cols-2">
                      {list.map(p => <PositionCard key={p.code} p={p} catalogue={board.catalogue} exclusions={exclusions} canAdminister={canAdminister} post={post} busy={busy} say={say} />)}
                    </div>}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
