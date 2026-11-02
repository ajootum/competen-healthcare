// HQ-SCHOLAR-PREVIEW-01 -- read the preview state the PROXY injected. Pure.
//
// The proxy strips every client-sent `x-scholar-preview-*` header on every host and sets its own only after verifying a live
// session on the preview host (proxy.ts). A layout therefore treats a present header as proof of a preview render, and
// otherwise shows nothing. A header on the main host is impossible by construction, and harness P9 proves it.

import { PREVIEW_EXPIRES_HEADER, PREVIEW_MODE_HEADER, type PreviewMode } from "./session";

export type PreviewRender = { mode: PreviewMode; secondsLeft: number };

export function readPreviewRender(h: { get(name: string): string | null }, now: number = Date.now()): PreviewRender | null {
  const mode = h.get(PREVIEW_MODE_HEADER);
  if (mode !== "read_only" && mode !== "testing") return null;
  const expires = Date.parse(h.get(PREVIEW_EXPIRES_HEADER) ?? "");
  const secondsLeft = Number.isFinite(expires) ? Math.max(0, Math.floor((expires - now) / 1000)) : 0;
  return { mode, secondsLeft };
}
