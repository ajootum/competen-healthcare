"use client";

import { useEffect } from "react";

// CPR-360: resolving "match my device".
//
// THE ONLY APPEARANCE DECISION THE SERVER CANNOT MAKE. Light and dark are written as a data attribute by
// the layout, so they are correct in the first painted frame; "system" depends on what the device
// prefers, which is not in the request. This component fills that one attribute in and then keeps
// listening, so a device that switches to dark at sunset takes the workspace with it.
//
// It renders nothing and does nothing at all unless the preference is "system".

export default function PracticeAppearance({ preference }: { preference: string }) {
  useEffect(() => {
    if (preference !== "system") return;

    const shell = document.querySelector<HTMLElement>("[data-practice-theme-preference]");
    if (!shell) return;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      if (query.matches) shell.setAttribute("data-practice-theme", "dark");
      else shell.removeAttribute("data-practice-theme");
    };

    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preference]);

  return null;
}
