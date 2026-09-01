"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-PROFILE-001 s4 -- the practitioner's photograph.
//
// ⚠ THE FILE IS RE-ENCODED HERE BEFORE IT IS SENT, AND THAT IS A PRIVACY CONTROL RATHER THAN A
// CONVENIENCE. A photograph off a phone carries EXIF: where it was taken, on what, and when. Drawing it
// to a canvas and re-encoding produces a JPEG with none of that, because a canvas has no metadata to
// carry -- and it also bounds the dimensions, so a 12-megapixel original does not become a 4MB upload
// for an image rendered at eighty pixels.
//
// ⚠ IT IS NOT THE ONLY CONTROL, AND MUST NOT BE. Anything running in a browser is something a caller
// can skip; practitioner-photo.ts checks the magic bytes and strips every APPn segment server-side. This
// is the half that protects an ordinary practitioner from their own camera, not the half that protects
// the bucket from an attacker.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Eighty pixels on screen, so 512 covers retina and any future larger rendering without waste. */
const MAX_EDGE = 512;
const JPEG_QUALITY = 0.85;

/**
 * Decode, square-crop, resize and re-encode as JPEG.
 *
 * Rejects rather than guesses when the browser cannot decode the file: a practitioner who chose a HEIC
 * straight off an iPhone needs to be told that, not to have an empty canvas uploaded on their behalf.
 */
async function toCleanJpeg(file: File): Promise<{ ok: true; blob: Blob } | { ok: false; why: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    }).catch(() => null);

    if (!img || !img.naturalWidth || !img.naturalHeight)
      return { ok: false, why: "That file could not be opened as an image. JPEG and PNG both work; a photo straight from an iPhone may be HEIC, which browsers cannot read." };

    // A square crop from the centre, because the avatar is a circle and letterboxing a portrait into
    // one puts the person's chin at the edge.
    const edge = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - edge) / 2;
    const sy = (img.naturalHeight - edge) / 2;
    const size = Math.min(edge, MAX_EDGE);

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, why: "This browser could not prepare the image." };
    // White behind, so a transparent PNG does not become a black square when encoded as JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, sx, sy, edge, edge, 0, 0, size, size);

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return { ok: false, why: "The image could not be prepared for upload." };
    return { ok: true, blob };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function PhotoConsole({ photoUrl, displayName, mayManage }: {
  photoUrl: string | null; displayName: string; mayManage: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // What the practitioner is looking at right now: the stored photograph, or the one they just chose.
  const [preview, setPreview] = useState<string | null>(photoUrl);

  const initials = displayName.trim().split(/\s+/).filter(Boolean)
    .map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "·";

  async function choose(file: File | null) {
    if (!file) return;
    setBusy(true);
    setNotice(null);

    const prepared = await toCleanJpeg(file);
    if (!prepared.ok) {
      setBusy(false);
      setNotice({ kind: "err", text: prepared.why });
      return;
    }

    const body = new FormData();
    body.append("photo", prepared.blob, "photo.jpg");
    const res = await fetch("/api/v1/practice/identity/photo", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";

    if (!res.ok) {
      setNotice({ kind: "err", text: `Not saved — ${data.error ?? "the image was not stored."}` });
      return;
    }
    setPreview(String(data.url ?? ""));
    setNotice({
      kind: "ok",
      text: "Your photograph is on your booking page. Location and camera details were removed before it was sent.",
    });
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/v1/practice/identity/photo", { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice({ kind: "err", text: `Not removed — ${data.error ?? "the image is still published."}` });
      return;
    }
    setPreview(null);
    setNotice({ kind: "ok", text: "Your photograph has been deleted. Patients see your initials again." });
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-[13px] font-bold text-gray-900">Photograph</h2>
      <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
        Optional. A photograph helps a patient recognise you at the appointment. Without one your page
        shows your initials, which is a finished look rather than a gap.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={displayName} width={72} height={72}
            className="h-[72px] w-[72px] shrink-0 rounded-full object-cover ring-1 ring-gray-200" />
        ) : (
          <span aria-hidden
            className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[24px] font-bold text-white">
            {initials}
          </span>
        )}

        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept="image/*" disabled={busy || !mayManage}
            onChange={e => choose(e.target.files?.[0] ?? null)}
            className="block text-[11.5px] text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--cp-primary)] file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-white hover:file:opacity-90 disabled:opacity-50" />
          {preview && mayManage && (
            <button type="button" onClick={remove} disabled={busy}
              className="self-start rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Remove photograph
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-gray-500">
        {/* The privacy fact stated plainly, because it is the reason the upload is slower than a copy. */}
        Your image is resized and re-saved before it leaves this page, which removes the location and
        camera information a phone stores inside a photograph. It is then published on your public
        booking page, where anyone with your link can see it.
      </p>

      {!mayManage && (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          You can see this. Changing it needs the practice settings permission.
        </p>
      )}

      {notice && (
        <p role="status" className={`mt-2 max-w-md rounded-lg px-3 py-2 text-[11.5px] leading-relaxed ${
          notice.kind === "ok" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
            : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"}`}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
