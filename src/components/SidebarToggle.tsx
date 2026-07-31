"use client";

import { useSyncExternalStore } from "react";

// Collapses the workspace sidebar to an icon rail (desktop only). Flips
// <html class="sb-collapsed"> — the CSS in globals.css shrinks aside[data-sidebar]
// and expands main[data-content] — and persists the choice to localStorage so it
// survives navigation. The root layout re-applies it pre-paint to avoid a flash.
// Rendered inside each workspace sidebar; sits in the header's free top-right.
//
// State is read straight off the <html> class via useSyncExternalStore rather
// than useState/useEffect: the server snapshot (false) is used for hydration and
// React reconciles to the real DOM value afterwards, so there's no hydration
// mismatch and no synchronous setState inside an effect.

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Keep sibling tabs in sync when the preference changes elsewhere.
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function getSnapshot() {
  return document.documentElement.classList.contains("sb-collapsed");
}

// `variant` only changes where the control sits, never what it does — the two
// share one state source, so the rail toggle and the PUI-002 header toggle can
// never disagree about whether the sidebar is collapsed.
export default function SidebarToggle({ variant = "rail" }: { variant?: "rail" | "header" }) {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, () => false);

  function toggle() {
    const next = !document.documentElement.classList.contains("sb-collapsed");
    document.documentElement.classList.toggle("sb-collapsed", next);
    try { localStorage.setItem("sb-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
    listeners.forEach((l) => l());
  }

  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const cls = variant === "header"
    ? "hidden md:inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors shrink-0"
    : "hidden md:flex absolute top-6 right-2 z-30 w-6 h-6 items-center justify-center rounded-md bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors text-sm leading-none";

  return (
    <button onClick={toggle} type="button" aria-label={label} title={label}
      {...(variant === "header" ? { "data-touch-target": "" } : {})} className={cls}>
      {variant === "header" ? <span aria-hidden>☰</span> : collapsed ? "»" : "«"}
    </button>
  );
}
