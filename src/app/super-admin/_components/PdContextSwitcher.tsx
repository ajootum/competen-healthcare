"use client";

import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useDismiss } from "@/components/ui/use-dismiss";
import type { WorkspaceLink } from "@/lib/roles";
import type { PdSidebarGeometry } from "./pd-sidebar-mode";

// CPR-PD-001 s6 — "Retain the Competen HQ context switcher at the bottom."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHY THIS IS NOT RoleSwitcher, WHICH IS THE OBVIOUS ANSWER AND THE WRONG ONE.
//
// The HQ sidebar's switcher is wrapped in [data-sb-label], so it DISAPPEARS the moment that sidebar
// collapses. PD-001 s4 lists what a collapsed rail must preserve and the context control is on that list
// by name -- "preserve brand mark, primary navigation icons, HQ/context control, profile access and sign
// out access" -- and s10 makes it an acceptance criterion: "HQ context switching remains available in
// both expanded and collapsed states". A control that vanishes at 4.75rem fails both. So the trigger here
// is an ICON that keeps working in the rail, and only its label is hidden.
//
// RoleSwitcher also POSTs to /api/auth/switch-role to change the active_role cookie, which is an estate
// concern -- a Product Director's context is a PRODUCT, and swapping their estate role is not what s6 is
// asking for. The destinations below are plain links, resolved on the server by workspaceLinksForUser.
//
// ⚠ AND VISIBILITY IS NOT AUTHORIZATION (s7: "a hidden navigation item does not constitute
// authorization... switching context must follow entitlement resolution and must never grant access
// merely because a destination is visible"). Every entry here was resolved server-side for this viewer,
// and every destination re-authorises on arrival regardless -- this menu grants nothing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function PdContextSwitcher({ workspaces, geometry, productLabel, roleLabel }: {
  /** Resolved on the server for this viewer. May be empty -- then there is nothing to switch to. */
  workspaces: WorkspaceLink[];
  geometry: PdSidebarGeometry;
  /** The product context, e.g. "Competen Practice". */
  productLabel: string;
  /** The role context, e.g. "Product Director Workspace". */
  roleLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, trigger);

  // The workspace you are standing in, if the switcher offers it. /super-admin is offered to an HQ
  // appointee as "Competen HQ", and that IS where a Product Director is -- so it is presented as the
  // current context rather than as somewhere to go.
  const here = workspaces.find(w => pathname === w.href || pathname.startsWith(w.href + "/"));
  const elsewhere = workspaces.filter(w => w !== here);

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        // ⚠ THE ACCESSIBLE NAME IS COMPLETE WHETHER OR NOT THE LABEL IS DRAWN. In the rail the visible
        // text is gone and this sentence is the only thing a screen reader has -- s4: "tooltips are not
        // a substitute for aria-labels".
        aria-label={`Switch context — currently ${productLabel}, ${roleLabel}`}
        title="Switch context"
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium text-[var(--pd-shell-ink)] transition-colors hover:bg-[var(--pd-shell-hover)] pointer-coarse:min-h-[var(--cp-touch)] ${geometry.row}`}
      >
        <span aria-hidden className="w-5 shrink-0 text-center text-sm leading-none">🏛️</span>
        <span aria-hidden className={`min-w-0 flex-1 truncate text-left ${geometry.label}`}>Switch context</span>
        <span aria-hidden className={`text-[9px] text-[var(--pd-shell-ink-dim)] ${geometry.label}`}>▾</span>
      </button>

      {open && (
        <>
          {/* The scrim catches the outside click; useDismiss above catches Escape and hands focus back
              to the trigger, which a scrim alone cannot do. */}
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            role="menu"
            aria-label="Switch context"
            className="absolute bottom-full left-0 z-50 mb-1 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-xl"
          >
            <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">Current context</p>
            <div className="flex items-start gap-2.5 px-3 pb-2 text-sm">
              <span aria-hidden>🩺</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-gray-900">{productLabel}</span>
                <span className="block text-[11px] text-gray-500">{roleLabel}</span>
              </span>
              {/* Not colour alone: the word says it as well as the tint (s9). */}
              <span className="shrink-0 text-[10px] font-bold text-teal-600">Active</span>
            </div>

            {elsewhere.length > 0 ? (
              <>
                <p className="border-t border-gray-100 px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">Switch to</p>
                {elsewhere.map(ws => (
                  <a
                    key={ws.href}
                    href={ws.href}
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 pointer-coarse:min-h-[var(--cp-touch)]"
                  >
                    <span aria-hidden>{ws.icon}</span>
                    <span className="flex-1 text-left">{ws.label}</span>
                  </a>
                ))}
              </>
            ) : (
              // ⚠ SAYS SO RATHER THAN RENDERING AN EMPTY MENU. A person holding one context is the normal
              // case, and a menu that opens onto nothing reads as a fault.
              <p className="border-t border-gray-100 px-3 py-3 text-[11px] text-gray-500">
                This is the only workspace open to you.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
