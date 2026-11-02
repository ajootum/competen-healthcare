"use client";

import type { MouseEvent, ReactNode } from "react";
import { ACCOUNT_TYPE_LABEL } from "@/lib/hq/account-classification";
import { PARTICIPATION_LABEL, type ParticipationCategory } from "@/lib/hq/account-participation";
import type { Readable } from "@/lib/hq/user-directory";
import { productSummary } from "@/lib/hq/user-detail";
import { ROLE_CONFIG, PLATFORM_ROLE_CONFIG, type AppRole, type PlatformRole } from "@/lib/roles";
import type { UserRow } from "./UsersWorkspace";
import { ROLE_BADGE, STATUS_UI, TYPE_PILL, relTime, tint } from "./users-ui";

// The directory list. A compact table from the md edge up, compact cards below it (CPR-MOB-001: one md edge, touch
// size by pointer-coarse, never by viewport width). The columns separate identity, account type, product access, roles
// and appointments, organisation and status, and the Products column shows the ACTUAL live entitlements with their end
// dates, never access inferred from a role badge. Competency and Passport live in the profile, not here.
//
// The name is a real link to ?user=<id> (it opens in a new tab if asked to) and also opens the profile in place, so the
// list, its filters and its scroll position stay where they are.

export default function UsersTable({ rows, selected, onToggle, hrefFor, onOpen, renderMenu, readable, empty }: {
  rows: UserRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  hrefFor: (id: string) => string;
  onOpen: (id: string) => void;
  /** The existing row actions menu (copy, reset, suspend, delete). */
  renderMenu: (u: UserRow) => ReactNode;
  readable: Readable;
  empty: ReactNode;
}) {
  const open = (u: UserRow) => (e: MouseEvent) => {
    // A modified click keeps the link's own meaning (new tab, new window).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(u.id);
  };

  const products = (u: UserRow) => {
    const s = productSummary(u.access, readable);
    return (
      <div aria-label="Product access" className="flex flex-col gap-0.5 text-[12px] text-gray-800">
        {s.lines.map(l => <span key={l}>{l}</span>)}
        {s.none && <span className="text-gray-500">None</span>}
        {s.unreadable.length > 0 && <span className="text-[var(--cmp-text-warning)]">Not readable: {s.unreadable.join(", ")}</span>}
        {u.participation && <span className="text-[11px] text-gray-500">{PARTICIPATION_LABEL[u.participation as ParticipationCategory] ?? u.participation}</span>}
      </div>
    );
  };

  const roles = (u: UserRow) => {
    const hq = u.access.hq.filter(h => h.status === "active");
    const pr = u.platformRole && PLATFORM_ROLE_CONFIG[u.platformRole as PlatformRole];
    return (
      <div className="flex max-w-[220px] flex-wrap gap-1">
        {pr && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700">{pr.label}</span>}
        {u.roles.map(r => <span key={r} className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${ROLE_BADGE[r] ?? "bg-gray-100 text-gray-600"}`}>{ROLE_CONFIG[r as AppRole]?.label ?? r}</span>)}
        {hq.map(h => <span key={h.position} className="rounded border border-violet-200 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700" title="HQ appointment">HQ · {h.name ?? h.position}</span>)}
        {!readable.hq && <span className="text-[11px] text-[var(--cmp-text-warning)]">HQ positions: Not readable</span>}
        {!pr && u.roles.length === 0 && hq.length === 0 && readable.hq && <span className="text-[12px] text-gray-500">None</span>}
      </div>
    );
  };

  const nameLink = (u: UserRow) => (
    <a href={hrefFor(u.id)} onClick={open(u)} title={`View details for ${u.name}`}
      className="block truncate font-medium text-gray-900 hover:text-teal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
      {u.name}
    </a>
  );

  const avatar = (u: UserRow) => (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${tint(u.id)}`} aria-hidden="true">{u.name[0]?.toUpperCase() ?? "?"}</div>
  );

  if (rows.length === 0) {
    return <div className="rounded-xl border border-gray-100 bg-white px-4 py-12 text-center text-sm text-gray-500">{empty}</div>;
  }

  return (
    <>
      {/* md and up: the table */}
      <div className="hidden overflow-x-auto rounded-xl border border-gray-100 bg-white md:block">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-bold uppercase tracking-wider text-gray-500">
              <th scope="col" className="w-8 px-4 py-3"><span className="sr-only">Select</span></th>
              <th scope="col" className="px-2 py-3 text-left">Person</th>
              <th scope="col" className="px-3 py-3 text-left">Account type</th>
              <th scope="col" className="px-3 py-3 text-left">Products</th>
              <th scope="col" className="px-3 py-3 text-left">Roles &amp; appointments</th>
              <th scope="col" className="px-3 py-3 text-left">Organisation / facility</th>
              <th scope="col" className="px-3 py-3 text-left">Status</th>
              <th scope="col" className="px-4 py-3 text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(u => {
              const st = STATUS_UI[u.status];
              return (
                <tr key={u.id} className="align-top hover:bg-gray-50/40">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => onToggle(u.id)} aria-label={`Select ${u.name}`} className="accent-teal-600" />
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-3">
                      {avatar(u)}
                      <div className="min-w-0 max-w-[220px]">
                        {nameLink(u)}
                        <p className="truncate text-[11px] text-gray-500">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${TYPE_PILL[u.accountType]}`} title="Account type (administrative, grants no access)">{ACCOUNT_TYPE_LABEL[u.accountType]}</span>
                  </td>
                  <td className="px-3 py-3">{products(u)}</td>
                  <td className="px-3 py-3">{roles(u)}</td>
                  <td className="px-3 py-3 text-xs text-gray-600">
                    <p>{u.organisation ?? <span className="text-gray-500">{"—"}</span>}</p>
                    <p className="text-[11px] text-gray-500">{u.facility ?? "—"}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${st.pill}`}>{st.label}</span>
                    <p className="mt-1 text-[11px] text-gray-500">{u.statusDetail}</p>
                    {/* Relative times drift between server render and hydration */}
                    <p className="text-[11px] text-gray-500" suppressHydrationWarning>Signed in {relTime(u.lastSignIn).toLowerCase()}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <a href={hrefFor(u.id)} onClick={open(u)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:inline-flex pointer-coarse:items-center">View details</a>
                      {renderMenu(u)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* below md: compact cards. Name, products, status, one action. */}
      <ul className="flex flex-col gap-2 md:hidden" aria-label="Users">
        {rows.map(u => {
          const st = STATUS_UI[u.status];
          return (
            <li key={u.id} className="rounded-xl border border-gray-100 bg-white p-3">
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => onToggle(u.id)} aria-label={`Select ${u.name}`} className="mt-2 accent-teal-600" />
                {avatar(u)}
                <div className="min-w-0 flex-1">
                  {nameLink(u)}
                  <p className="truncate text-[11px] text-gray-500">{u.email}</p>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${st.pill}`}>{st.label}</span>
              </div>
              <div className="mt-2 pl-[3.25rem]">{products(u)}</div>
              <div className="mt-3 pl-[3.25rem]">
                <a href={hrefFor(u.id)} onClick={open(u)} className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] pointer-coarse:min-h-[var(--cmp-touch-min)] font-semibold text-gray-700 hover:bg-gray-50">View details</a>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
