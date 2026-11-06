"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// SCHOLAR-PERF-01: a page is built on the server, and until it arrives the old page stays on screen, so a tap looked like nothing
// happened. This shows a bar in the moment of the tap, and costs no read and no data.

/** Would this click move to another page in the app? Pure. */
export function startsNavigation(
  click: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean },
  link: { href: string; target: string; hasDownload: boolean },
  here: { origin: string; pathname: string; search: string },
): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if (link.hasDownload || (link.target && link.target !== "_self")) return false;
  let to: URL;
  try { to = new URL(link.href, here.origin); } catch { return false; }
  if (to.origin !== here.origin) return false;
  // The same page, or only a place on it.
  return to.pathname !== here.pathname || to.search !== here.search;
}

const SAFETY_MS = 30_000;

export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);

  // Arrived: the address has changed.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the router's new address is the event that ends the wait
  useEffect(() => { setPending(false); }, [pathname, search]);

  useEffect(() => {
    // Listened for on the way down. On the way back a Next Link has already cancelled the browser's own navigation to do its own,
    // so by then every in-app link looks cancelled. A link that truly cancels itself shows the bar until SAFETY_MS.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const { origin, pathname: p, search: s } = window.location;
      if (startsNavigation(e, { href: a.href, target: a.target, hasDownload: a.hasAttribute("download") }, { origin, pathname: p, search: s })) setPending(true);
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement | null;
      if (!e.defaultPrevented && f?.method === "get") setPending(true);
    };
    // Back from the browser's own page cache: nothing is on its way.
    const onShow = () => setPending(false);
    window.addEventListener("click", onClick, true);
    window.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  // A navigation that never arrives must not leave the bar running for ever.
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => setPending(false), SAFETY_MS);
    return () => clearTimeout(id);
  }, [pending]);

  if (!pending) return null;
  return (
    <div data-nav-progress className="fixed inset-x-0 top-0 z-[80] h-[3px] overflow-hidden bg-[var(--cmp-app-border)]">
      <span role="status" className="sr-only">Loading</span>
      <div aria-hidden className="cmp-nav-progress h-full bg-[var(--learn-ink,currentColor)]" />
    </div>
  );
}
