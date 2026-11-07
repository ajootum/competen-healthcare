"use client";

import { createContext, useContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import { READER_ZONE_COOKIE, readerZoneCookie, readerZoneSync, type ReaderClock } from "@/lib/datetime";

// The reader's clock in the browser. Design: docs/design/LOCAL-TIME-ZONES.md.
//
// The layout resolves the clock on the server and hands it down, so the server and the browser format with the same
// zone and hydration cannot disagree. Without a clock (the policy is off, or outside a provider) this does nothing:
// no cookie, no refresh, and useReaderClock is null.

const Context = createContext<ReaderClock | null>(null);

export const useReaderClock = (): ReaderClock | null => useContext(Context);

const cookieValue = (): string | null => {
  const hit = document.cookie.split("; ").find(c => c.startsWith(`${READER_ZONE_COOKIE}=`));
  if (!hit) return null;
  try { return decodeURIComponent(hit.slice(READER_ZONE_COOKIE.length + 1)); } catch { return null; }
};

const deviceZone = (): string | null => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { return null; }
};

function ZoneSync({ clock }: { clock: ReaderClock }) {
  const router = useRouter();
  useEffect(() => {
    const sync = () => {
      const next = readerZoneSync({ device: deviceZone(), cookie: cookieValue(), clock });
      if (!next.write) return;
      document.cookie = readerZoneCookie(next.write, window.location.protocol === "https:");
      // Cookies blocked: the write did not hold, so a refresh could change nothing. Stay on the current zone.
      if (next.refresh && cookieValue() === next.write) router.refresh();
    };
    sync();
    // A laptop that crossed a border while asleep comes back here.
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [clock, router]);
  return null;
}

export function ReaderClockProvider({ clock, children }: { clock: ReaderClock | null; children: React.ReactNode }) {
  if (!clock) return <>{children}</>;
  return <Context.Provider value={clock}><ZoneSync clock={clock} />{children}</Context.Provider>;
}
