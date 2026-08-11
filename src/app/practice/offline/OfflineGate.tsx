"use client";

import { useState } from "react";
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
  return (
    <DeviceLockPrompt variant="page" onUnlocked={setCacheKey}>
      <OfflineReader cacheKey={cacheKey} />
    </DeviceLockPrompt>
  );
}
