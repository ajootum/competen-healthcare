"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PARTICIPATION_CATEGORIES, PARTICIPATION_LABEL, type ParticipationCategory } from "@/lib/hq/account-participation";

// Private module development access (owner GO 2 Nov 2026): one editor per Scholar module. It keeps a LOCAL draft of the mode, the
// accounts and the pilot groups, adds an account by the email typed (resolved to an id by the route, which refuses an unknown
// email), and saves the draft to /api/hq/individual/config {action: "set"}, which stores IDS ONLY and re-checks the capability and
// that every id is an account. Nothing here is effective until the policy is published below.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const input = "w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[14px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";

type Mode = "private" | "pilot" | "public";
export type Account = { id: string; name: string | null; email: string | null };

export default function ModuleAccessEditor({ policyKey, label, mode: initialMode, accounts: initialAccounts, groups: initialGroups, hasOverride, maxUsers, modeLabels, modeMeanings }: {
  policyKey: string; label: string; mode: Mode; accounts: Account[]; groups: ParticipationCategory[]; hasOverride: boolean; maxUsers: number;
  modeLabels: Record<Mode, string>; modeMeanings: Record<Mode, string>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [groups, setGroups] = useState<ParticipationCategory[]>(initialGroups);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const id = `ma-${policyKey}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; json: any }> {
    const res = await fetch("/api/hq/individual/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  }

  // Looks the typed email up and returns the list with that account on it, or null (with the reason shown) when it cannot be added.
  async function withTyped(list: Account[]): Promise<Account[] | null> {
    const r = await post({ action: "module_access_lookup", email });
    if (!r.ok) { setMsg({ ok: false, text: r.json?.error ?? "That account could not be looked up. Nothing was added." }); return null; }
    const a = r.json.account as Account;
    if (list.some(x => x.id === a.id)) return list;
    if (list.length >= maxUsers) { setMsg({ ok: false, text: `At most ${maxUsers} accounts. That limit is fixed.` }); return null; }
    return [...list, a];
  }

  // Saves the draft with this list. Adding and removing an account save at once, so the list on screen is always the draft.
  async function store(list: Account[], done: string) {
    const r = await post({ action: "set", key: policyKey, value: { mode, users: list.map(a => a.id), groups } });
    if (!r.ok) { setMsg({ ok: false, text: r.json?.error ?? "That could not be saved. Nothing has changed." }); return false; }
    setAccounts(list); setMsg({ ok: true, text: done }); router.refresh();
    return true;
  }

  async function add() {
    setBusy(true); setMsg(null);
    try {
      const list = await withTyped(accounts);
      if (!list) return;
      if (await store(list, `${list[list.length - 1]?.name ?? "The account"} is on the draft and saved. Publish below to make it effective.`)) setEmail("");
    } catch { setMsg({ ok: false, text: "That account could not be added. Check your connection." }); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setMsg(null);
    try { await store(accounts.filter(x => x.id !== id), "Removed from the draft and saved. Publish below to make it effective."); }
    catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); } finally { setBusy(false); }
  }

  // Save draft also takes an email still sitting in the box, so a typed account is never silently left out.
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const list = email.trim() ? await withTyped(accounts) : accounts;
      if (!list) return;
      if (await store(list, "Draft saved. Publish below to make it effective.")) setEmail("");
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); } finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true); setMsg(null);
    try {
      const r = await post({ action: "reset", key: policyKey });
      if (!r.ok) { setMsg({ ok: false, text: r.json?.error ?? "That could not be reset. Nothing has changed." }); return; }
      setMsg({ ok: true, text: "Removed. The default (private, nobody listed) applies now, and the change is in the history." }); router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be reset. Check your connection." }); } finally { setBusy(false); }
  }

  const toggleGroup = (g: ParticipationCategory) => setGroups(list => list.includes(g) ? list.filter(x => x !== g) : [...list, g]);

  return (
    <div className="space-y-4">
      <fieldset className="space-y-1.5">
        <legend className="text-[12.5px] font-semibold text-gray-700">Draft: who can see {label.replace(/ access$/, "")}</legend>
        {(Object.keys(modeLabels) as Mode[]).map(m => (
          <label key={m} className="flex items-start gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
            <input type="radio" name={`${id}-mode`} checked={mode === m} onChange={() => setMode(m)} className="mt-1 h-4 w-4" />
            <span><span className="font-semibold">{modeLabels[m]}.</span> <span className="text-gray-600">{modeMeanings[m]}</span></span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-1.5">
        <p className="text-[12.5px] font-semibold text-gray-700">Accounts ({accounts.length} of {maxUsers})</p>
        {accounts.length === 0 ? <p className="text-[13px] text-gray-600">No account is listed.</p> : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {accounts.map(a => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13.5px]">
                <span className="min-w-0 break-words">
                  <span className="font-semibold text-gray-900">{a.name ?? (a.email ? "No name on record" : "An account that no longer exists")}</span>
                  {a.email && <span className="text-gray-600"> · {a.email}</span>}
                </span>
                <button type="button" className={ghost} disabled={busy} onClick={() => void remove(a.id)}>
                  Remove<span className="sr-only"> {a.email ?? a.name ?? "this account"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor={`${id}-email`} className="block text-[12.5px] font-semibold text-gray-700">Add by email</label>
            <input id={`${id}-email`} type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && email.trim() && !busy) { e.preventDefault(); void add(); } }} className={input} />
          </div>
          <button type="button" className={ghost} disabled={busy || !email.trim()} onClick={() => void add()}>Add account</button>
        </div>
        <p className="text-[12px] text-gray-500">Only an account that already exists can be added. Accounts are stored by id, not by email.</p>
      </div>

      {mode === "pilot" && (
        <fieldset className="space-y-1.5">
          <legend className="text-[12.5px] font-semibold text-gray-700">Pilot: also every account in these participation categories</legend>
          {PARTICIPATION_CATEGORIES.map(g => (
            <label key={g} className="flex items-center gap-2 text-[14px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
              <input type="checkbox" checked={groups.includes(g)} onChange={() => toggleGroup(g)} className="h-4 w-4 rounded border-gray-400" />
              {PARTICIPATION_LABEL[g]}
            </label>
          ))}
          <p className="text-[12px] text-gray-500">A category is read from the account&apos;s participation label (Users). An ended or missing label gives no access.</p>
        </fieldset>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={busy} onClick={() => void save()}>Save draft</button>
        {hasOverride && <button type="button" className={ghost} disabled={busy} onClick={() => void reset()}>Use default now</button>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>}
    </div>
  );
}
