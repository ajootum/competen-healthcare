"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PRACTICE_MODES, SETUP_LABELS, capabilityDef,
  ACTIVATION_IS_NOT_PERMISSION, MODES_ARE_PRESETS, DEACTIVATION_KEEPS_HISTORY, NOT_YET_WIRED,
  type CapabilityId, type PracticeModeId,
} from "@/lib/practice/capability-registry";
import type { CapabilityResolution, CapabilityStatus } from "@/lib/practice/capabilities";

// CPR-CAP-001 s4, s5 and s6 -- the practice's own view of what it has switched on.
//
// ⚠ VALUES FROM capability-registry.ts, TYPES FROM capabilities.ts. The registry is import-free; the
// engine imports audit and talks to the database. A value import from the engine here would drag a
// server module into this bundle, which is the failure scripts/practice-bundle-harness.ts exists to
// catch. `import type` is erased at compile time and is safe.
//
// ⚠ THREE STATES ARE RENDERED AS THREE STATES. On, off, and "we could not read this". The third is not
// drawn as off, because a practitioner who reads "Calendar: off" during a database blip will go looking
// for what they broke.
//
// ⚠ EVERY SENTENCE ON THIS SCREEN IS TRUE TODAY. In particular the page says plainly that nothing yet
// hides a menu from these switches. It will keep saying it until something does.

const CARD = "rounded-xl border border-gray-200 bg-white p-4";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";

type Pending = { capability: CapabilityId; dependents: CapabilityId[]; message: string };

export default function CapabilityConsole({ resolution, canManage }: {
  resolution: CapabilityResolution;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const statuses = resolution.statuses;
  const activeCount = useMemo(
    () => statuses.filter(s => s.state === "active").length,
    [statuses]);

  type ApiBody = Record<string, unknown>;

  async function post(payload: Record<string, unknown>): Promise<ApiBody | null> {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/capabilities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // s6 bullet four: the warning names the dependents rather than saying "this cannot be done".
        if (body?.error?.code === "DEPENDENTS_ACTIVE" && Array.isArray(body.error.dependents)) {
          setPending({
            capability: payload.capability as CapabilityId,
            dependents: body.error.dependents as CapabilityId[],
            message: String(body.error.message ?? ""),
          });
          return null;
        }
        setNotice({ kind: "err", text: body?.error?.message ?? `That did not work (${res.status}).` });
        return null;
      }
      setPending(null);
      router.refresh();
      return body;
    } catch (e) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "That did not work." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: CapabilityId) {
    const body = await post({ action: "activate", capability: id });
    if (!body) return;
    const parts: string[] = [];
    const changed = (body.changed as CapabilityId[] | undefined) ?? [];
    const deps = (body.dependenciesActivated as CapabilityId[] | undefined) ?? [];
    if (changed.length === 0) parts.push(`${name(id)} was already on.`);
    else parts.push(`${name(id)} is on.`);
    if (deps.length > 0) parts.push(`${deps.map(name).join(" and ")} came with it, because it needs them.`);
    const setup = (body.setupRequired as (keyof typeof SETUP_LABELS)[] | undefined) ?? [];
    if (setup.length > 0) parts.push(`Still to set up: ${setup.map(k => SETUP_LABELS[k]).join(", ")}.`);
    const rec = (body.recommended as CapabilityId[] | undefined) ?? [];
    if (rec.length > 0) parts.push(`${rec.map(name).join(" and ")} would go well with it, but ${rec.length === 1 ? "it is" : "they are"} not required.`);
    setNotice({ kind: "ok", text: parts.join(" ") });
  }

  async function deactivate(id: CapabilityId, acknowledge: boolean) {
    const body = await post({ action: "deactivate", capability: id, acknowledgeDependents: acknowledge });
    if (!body) return;
    const changed = (body.changed as CapabilityId[] | undefined) ?? [];
    const also = (body.dependentsDeactivated as CapabilityId[] | undefined) ?? [];
    const parts: string[] = [];
    if (changed.length === 0) parts.push(`${name(id)} was already off.`);
    else parts.push(`${name(id)} is off.`);
    if (also.length > 0) parts.push(`${also.map(name).join(" and ")} went off too.`);
    parts.push(DEACTIVATION_KEEPS_HISTORY);
    setNotice({ kind: "ok", text: parts.join(" ") });
  }

  async function applyMode(mode: PracticeModeId) {
    const body = await post({ action: "applyMode", mode });
    if (!body) return;
    const changed = (body.changed as CapabilityId[] | undefined) ?? [];
    setNotice({
      kind: "ok",
      text: changed.length === 0
        ? "Everything in that starting point was already on. Nothing changed."
        : `Switched on: ${changed.map(name).join(", ")}. ${MODES_ARE_PRESETS}`,
    });
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ⚠ THE HONEST LIMIT, FIRST, NOT IN A FOOTNOTE. */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900">
        <p className="font-semibold">{NOT_YET_WIRED}</p>
      </div>

      {!resolution.readable && (
        <div role="status" className="rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] leading-relaxed text-red-800">
          <p className="font-semibold">We could not read what your practice has switched on.</p>
          <p className="mt-1">
            Nothing below is a statement about your practice &mdash; every capability is shown as
            &ldquo;not known&rdquo; rather than as off, and nothing can be changed until this page can read
            your settings again.
          </p>
          {resolution.error && <p className="mt-1 font-mono text-[11px] opacity-80">{resolution.error}</p>}
        </div>
      )}

      {notice && (
        <div role="status" className={`rounded-xl border p-3 text-[12px] leading-relaxed ${
          notice.kind === "ok"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-red-200 bg-red-50 text-red-800"}`}>
          {notice.text}
        </div>
      )}

      {/* s6 bullet four: the warning, naming the dependents. */}
      {pending && (
        <div role="alertdialog" aria-label="Confirm switching off" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900">
          <p className="font-semibold">{pending.message}.</p>
          <p className="mt-1">{DEACTIVATION_KEEPS_HISTORY}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BTN} disabled={busy}
              onClick={() => deactivate(pending.capability, true)}>
              Switch off {[pending.capability, ...pending.dependents].map(name).join(", ")}
            </button>
            <button type="button" className={QUIET} disabled={busy} onClick={() => setPending(null)}>
              Leave everything as it is
            </button>
          </div>
        </div>
      )}

      {/* ── s5. Starting points. ─────────────────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-[15px] font-bold text-gray-900">Starting points</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">{MODES_ARE_PRESETS}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
          Choosing one switches its capabilities on. It never switches anything off, so nothing you have
          already set up is lost.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {PRACTICE_MODES.map(mode => (
            <div key={mode.id} className="rounded-lg border border-gray-200 p-3">
              <p className="text-[13px] font-semibold text-gray-900">{mode.displayName}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
                Switches on: {mode.selects.map(name).join(", ")}
                {dependencyNote(mode.selects)}
              </p>
              {mode.unmodelled && (
                <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{mode.unmodelled}</p>
              )}
              <button type="button" className={`${QUIET} mt-2`}
                disabled={!canManage || busy || !resolution.readable}
                onClick={() => applyMode(mode.id)}>
                Use this starting point
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── s4. The registry, and this practice's state against it. ──────────────────────────── */}
      <section className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-bold text-gray-900">What this practice uses</h2>
          <p className="text-[12px] text-gray-500">
            {resolution.readable
              ? `${activeCount} of ${statuses.length} switched on`
              : `${statuses.length} capabilities, state not known`}
          </p>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">{ACTIVATION_IS_NOT_PERMISSION}</p>

        <ul className="mt-3 flex flex-col gap-2">
          {statuses.map(s => (
            <li key={s.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-gray-900">
                    {s.displayName} <StateChip state={s.state} />
                  </p>
                  <p className="mt-0.5 text-[12px] text-gray-500">{s.area}</p>
                  <Provenance status={s} />
                </div>
                <Controls
                  status={s}
                  canManage={canManage}
                  busy={busy}
                  readable={resolution.readable}
                  onActivate={() => activate(s.id)}
                  onDeactivate={() => deactivate(s.id, false)}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function name(id: CapabilityId): string {
  return capabilityDef(id)?.displayName ?? id;
}

/** What a preset drags in beyond its own list, said out loud rather than appearing unannounced. */
function dependencyNote(selects: CapabilityId[]): string {
  const own = new Set(selects);
  const extra: string[] = [];
  for (const id of selects) {
    for (const dep of capabilityDef(id)?.requires ?? []) {
      if (!own.has(dep) && !extra.includes(name(dep))) extra.push(name(dep));
    }
  }
  return extra.length === 0 ? "." : `, and ${extra.join(" and ")} because those are needed for it.`;
}

function StateChip({ state }: { state: CapabilityStatus["state"] }) {
  if (state === "active") {
    return <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">On</span>;
  }
  if (state === "inactive") {
    return <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">Off</span>;
  }
  // ⚠ THE THIRD STATE, DRAWN AS ITSELF. Never as Off.
  return <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">Not known</span>;
}

function Provenance({ status }: { status: CapabilityStatus }) {
  const bits: string[] = [];
  if (status.origin === "registry_default") {
    bits.push(status.state === "active"
      ? "On by default. Nobody has changed this."
      : "Off by default. Nobody has changed this.");
  }
  if (status.modeCode) {
    const mode = PRACTICE_MODES.find(m => m.id === status.modeCode);
    if (mode) bits.push(`Switched on by the ${mode.displayName} starting point.`);
  } else if (status.source === "dependency") {
    bits.push("Changed because something else needed it.");
  }
  if (status.requires.length > 0) bits.push(`Needs: ${status.requires.map(name).join(", ")}.`);
  if (status.requiresSetup.length > 0) {
    bits.push(`Needs set up: ${status.requiresSetup.map(k => SETUP_LABELS[k]).join(", ")}.`);
  }
  if (status.recommends.length > 0) {
    bits.push(`${status.recommends.map(name).join(", ")} goes well with it, but is not required.`);
  }
  if (status.activeDependents && status.activeDependents.length > 0) {
    bits.push(`${status.activeDependents.map(name).join(", ")} ${status.activeDependents.length === 1 ? "depends" : "depend"} on it.`);
  }
  if (bits.length === 0) return null;
  return <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{bits.join(" ")}</p>;
}

function Controls({ status, canManage, busy, readable, onActivate, onDeactivate }: {
  status: CapabilityStatus;
  canManage: boolean;
  busy: boolean;
  readable: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  if (!canManage) {
    return <p className="text-[11px] text-gray-400">Only somebody who manages practice settings can change this.</p>;
  }
  // ⚠ NO SWITCH OVER AN UNKNOWN STATE. Pressing "switch off" against a state nobody could read would
  // write a decision on top of a guess, and the engine refuses it anyway.
  if (!readable) {
    return <p className="text-[11px] text-gray-400">Not available while your settings cannot be read.</p>;
  }
  return status.state === "active"
    ? <button type="button" className={QUIET} disabled={busy} onClick={onDeactivate}>Switch off</button>
    : <button type="button" className={BTN} disabled={busy} onClick={onActivate}>Switch on</button>;
}
