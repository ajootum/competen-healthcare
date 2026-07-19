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

export default function SidebarToggle() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, () => false);

  function toggle() {
    const next = !document.documentElement.classList.contains("sb-collapsed");
    document.documentElement.classList.toggle("sb-collapsed", next);
    try { localStorage.setItem("sb-collapsed", next ? "1" : "0"); } catch { /* ignore */ }
    listeners.forEach((l) => l());
  }

  return (
    <button onClick={toggle} type="button"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="hidden md:flex absolute top-6 right-2 z-30 w-6 h-6 items-center justify-center rounded-md bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors text-sm leading-none">
      {collapsed ? "»" : "«"}
    </button>
  );
}
