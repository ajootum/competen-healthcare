"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// The PRIVATE profile photo -- COMPETEN-INDIVIDUAL-IDENTITY-HUB-01 (590). Shown to the person through their own
// short-lived link (/api/individual/identity/photo), never a public URL. Uploading checks the type and size here for
// quick feedback; the server sniffs the bytes, strips location and device metadata and stores it privately.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const small = `inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center justify-center rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-50 ${focusRing}`;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function PhotoControl({ name, version, accent, available }: { name: string; version: string | null; accent: string; available: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("") || "?";

  async function upload(file: File) {
    if (!TYPES.includes(file.type)) { setMsg({ ok: false, text: "Use a JPEG, PNG or WebP photo." }); return; }
    if (file.size > 5 * 1024 * 1024) { setMsg({ ok: false, text: "Choose a photo under 5 MB." }); return; }
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.set("document", file);
      const res = await fetch("/api/individual/identity/photo", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "Your photo could not be saved. Nothing was changed." }); return; }
      setMsg({ ok: true, text: "Photo saved. Location and camera details were removed." });
      router.refresh();
    } catch { setMsg({ ok: false, text: "Competen could not be reached. Nothing was changed." }); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function remove() {
    if (!window.confirm("Remove your photo?")) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/individual/identity/photo", { method: "DELETE" });
      setMsg(res.ok ? { ok: true, text: "Photo removed." } : { ok: false, text: "Your photo could not be removed just now." });
      if (res.ok) router.refresh();
    } catch { setMsg({ ok: false, text: "Competen could not be reached." }); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      {version ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, short-lived signed image: next/image would cache it publicly
        <img src={`/api/individual/identity/photo?v=${encodeURIComponent(version)}`} alt={`Photo of ${name}`} className="h-24 w-24 rounded-full object-cover ring-4 ring-white" />
      ) : (
        <span aria-hidden className="flex h-24 w-24 items-center justify-center rounded-full text-[28px] font-bold text-white ring-4 ring-white" style={{ background: accent }}>{initials}</span>
      )}
      {available && (
        <div className="flex flex-wrap justify-center gap-2">
          <label className={`${small} cursor-pointer border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
            {busy ? "Saving…" : version ? "Change photo" : "Add photo"}
            <input ref={input} type="file" accept={TYPES.join(",")} className="sr-only" disabled={busy}
              onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          </label>
          {version && <button type="button" onClick={remove} disabled={busy} className={`${small} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}>Remove</button>}
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`max-w-[16rem] text-center text-[12px] sm:text-left ${msg.ok ? "text-green-800" : "font-semibold text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}
