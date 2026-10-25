"use client";

import { useState } from "react";
import { focusRing, secondaryBtn } from "../chrome";

// The full share link, and a button that copies it. The link is built from the configured site address
// (SITE_URL), never the request's host, so what the person sends is the real public /verify page.

export default function CopyLink({ url, accent }: { url: string; accent: string }) {
  const [said, setSaid] = useState<string | null>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setSaid("Link copied."); }
    catch { setSaid("Copy did not work here. Select the link and copy it."); }
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <input readOnly value={url} aria-label="Share link" onFocus={e => e.currentTarget.select()}
        className={`min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-2 py-1.5 font-mono text-[12.5px] text-gray-800 ${focusRing}`} />
      <button type="button" onClick={copy} className={secondaryBtn} style={{ color: accent }}>Copy link</button>
      {said && <span role="status" className="text-[12.5px] text-gray-600">{said}</span>}
    </div>
  );
}
