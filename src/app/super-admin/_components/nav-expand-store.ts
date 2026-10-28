// HQ-NAV-EXPAND-01 — the sidebar's open/closed choices, shared by the desktop rail and the mobile drawer.
//
// ⚠ AN EXTERNAL STORE, NOT COMPONENT STATE. The drawer unmounts when it closes and the rail never does, so
// state held inside either would forget, or disagree. sessionStorage is the source of truth (one tab,
// survives reloads); the parsed copy is cached only against the exact stored string, which keeps the
// snapshot stable for useSyncExternalStore without a second, drifting copy. A failed read or write
// (private mode, blocked storage) means the parents fall back to opening the active page's chain, which
// is the rule anyway.
//
// ⚠ THE SERVER SNAPSHOT IS EMPTY, so the first paint is the same on server and client (only the active
// chain open) and hydration cannot mismatch; the remembered choices apply on the next render.

import { useSyncExternalStore } from "react";
import type { ToggleRecord } from "@/lib/nav/expand";

type Records = Readonly<Record<string, ToggleRecord>>;
const KEY = "hq-nav-expanded";
const EMPTY: Records = Object.freeze({});
const listeners = new Set<() => void>();
let cache: { raw: string | null; records: Records } = { raw: null, records: EMPTY };

function read(): Records {
  let raw: string | null = null;
  try { raw = window.sessionStorage.getItem(KEY); } catch { return cache.records; }
  if (raw === cache.raw) return cache.records;
  let records: Records = EMPTY;
  try { records = raw ? (JSON.parse(raw) as Records) : EMPTY; } catch { /* unreadable: start empty */ }
  cache = { raw, records };
  return records;
}

export function setParentOpen(key: string, open: boolean, at: string): void {
  const records = { ...read(), [key]: { open, at } };
  const raw = JSON.stringify(records);
  try { window.sessionStorage.setItem(KEY, raw); } catch { /* storage unavailable: keep it in memory */ }
  cache = { raw, records };
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useParentRecords(): Records {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
