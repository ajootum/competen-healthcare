"use client";

import { useEffect, useState } from "react";

// CPR-MOB-001 s8 -- "am I below the md breakpoint?", asked of the SAME 768px boundary Tailwind's
// max-md:* classes use, so a component that must MOUNT something different on a phone (a full-screen
// sheet, a body scroll lock) can never disagree with the classes that HIDE things on one.
//
// ⚠ WHY A HOOK EXISTS AT ALL when the Phase 3 mechanism is CSS siblings: two of s8's rows need
// BEHAVIOUR, not just display -- FullScreenSheet runs a focus trap and a scroll lock the moment it is
// mounted, and mounting it display:none on desktop would leave a hidden dialog fighting the visible
// form for focus. Those two mounts are gated on this hook; everything that can be CSS stays CSS.
//
// SSR-SAFE BY RETURNING false FIRST: the server render and the first client render agree (desktop
// face), and the flip happens on mount -- before any of the gated surfaces can be opened, because all
// of them open from a user action.
export function useBelowMd(): boolean {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setBelow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return below;
}
