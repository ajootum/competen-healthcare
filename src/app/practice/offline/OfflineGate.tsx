"use client";

import { useEffect, useState } from "react";
import DeviceLockPrompt from "../_offline/DeviceLockPrompt";
import OfflineReader from "./OfflineReader";

// The offline page's PIN gate. CP-OFFLINE-SURVEY-001 s5 precondition 0.
//
// ⚠ ON THIS PAGE THE PROMPT IS A WALL, AND IN THE SHELL IT IS A LINE. That difference is deliberate:
// here there is genuinely nothing to show until the store can be opened, whereas in the shell the
// practitioner is online and working and must never be stopped by a device credential.
//
// ⚠ IT HOLDS THE KEY IN COMPONENT STATE ONLY. offline-session.ts keeps it for the tab; this passes it
// down. Neither writes it anywhere, and a reload asks again -- which is what "once per tab" means.
export default function OfflineGate() {
  const [cacheKey, setCacheKey] = useState<CryptoKey | null>(null);

  // ⚠⚠ THE WORKER IS REGISTERED FROM HERE TOO, AND UNTIL 2026-08-11 IT WAS NOT.
  //
  // `serviceWorker.register` lived in exactly one place: OfflineCacheWriter, inside the (shell), behind
  // an auth redirect and the offline feature flag. So the worker whose ONLY job is to make THIS page
  // bootable could be installed or updated solely from a page requiring a live connection, a session and
  // a flag. The page that depends on it could never keep it current.
  //
  // The consequence is what the owner hit: a device holding an old worker, showing an old shell, with no
  // route to a newer one -- because reaching the newer one required visiting a page that is not this one.
  //
  // ⚠ REGISTERING FROM AN UNAUTHENTICATED PAGE IS SAFE HERE, and only here. sw.js caches exactly two
  // things: this document, which contains no patient data at all, and hashed build assets. Every /api/
  // path is refused by `cachePolicy` before anything else is considered. Nothing this registration can
  // reach is disclosive.
  //
  // ⚠ IT IS NOT AWAITED AND CANNOT AFFECT RENDERING. Offline it simply fails, which is correct: there is
  // nothing to fetch, and what is already stored is what this page is about to read.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/practice/", updateViaCache: "none" })
      // ⚠ `update()` explicitly: registering an already-registered worker is a no-op in some browsers,
      // and the whole point of this call is to notice a NEW script.
      .then(reg => reg.update())
      .catch(() => undefined);
  }, []);

  return (
    <DeviceLockPrompt variant="page" onUnlocked={setCacheKey}>
      <OfflineReader cacheKey={cacheKey} />
    </DeviceLockPrompt>
  );
}
