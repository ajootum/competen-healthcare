import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveHandle, bookingQr, bookingUrl } from "@/lib/practice/identity-service";

// /practice/book/@handle/print -- CPB-002's "Download & Print Assets": appointment card, business card,
// A4 poster.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE ADDRESS ON THESE SHEETS IS PERMANENT IN A WAY A SCREEN IS NOT.
//
// A page showing a stale link is fixed by a deploy. A box of five hundred printed cards is not, and the
// patient holding one has no recourse -- they type what is on the card and reach nothing. Two things
// follow, and both are structural rather than a note somebody remembers:
//
//   1. THE URL AND THE QR COME FROM ONE FUNCTION. bookingUrl() composes the link; bookingQr() calls
//      bookingUrl() itself, so the code and the text below it cannot disagree. Every asset on this page
//      prints the SAME string, and the harness asserts the QR's payload is byte-identical to the printed
//      text rather than trusting this paragraph.
//
//   2. THE HANDLE OUTLIVES A CHANGE. If this practitioner ever changes their handle,
//      practice_handle_history keeps the old one attached to them for ever and resolveHandle REDIRECTS
//      an arrival at it to the current address -- it does not merely reserve the name. That is the whole
//      reason a printed poster is safe to make, and the reason the old name can never be reissued to
//      somebody else.
//
// ---- WHAT IS ON THESE ASSETS, AND WHAT IS NOT ------------------------------------------------------
//
// Only stored, patient-facing fields: the display name, the qualifications, the specialties and the
// address. CPB-002's comp also shows a photograph on the business card, a blue verified tick beside the
// name, a star rating, a patient count and a response time. No column holds any of them -- see the
// public profile page for the same refusal at more length -- and a card is the worst place to invent
// one, because it is the version a patient keeps in a wallet.
//
// ---- PDF ------------------------------------------------------------------------------------------
//
// CPB-002 asks for PDF. This is a print stylesheet rather than a PDF generator: the browser's own
// "Save as PDF" produces one, with no second library and no server-side renderer. NOT_BUILT's `qr_pdf`
// records that as the position rather than leaving it implied.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

// ⚠ NEVER INDEXED, whatever the practitioner's discovery setting. A print sheet is a working document,
// not a page anybody should arrive at from a search engine.
export const metadata: Metadata = { robots: { index: false, follow: false } };

function handleFrom(segment: string): string | null {
  let decoded = segment;
  try { decoded = decodeURIComponent(segment); } catch { return null; }
  return decoded.startsWith("@") ? decoded.slice(1) : null;
}

export default async function PrintAssetsPage({ params }: {
  params: Promise<{ handle: string }>;
}) {
  const handle = handleFrom((await params).handle);
  if (!handle) notFound();

  const resolved = await resolveHandle(createAdminClient(), handle);
  // The same redirect the profile page performs, for the same reason: an old handle must arrive
  // somewhere, including when somebody is reprinting from an old link.
  if (resolved.kind === "redirect") redirect(`${resolved.to}/print`);
  // ⚠ AND A FAILED READ PRINTS NOTHING. These sheets are the one output that cannot be corrected once it
  // leaves the printer, so "we could not check" must never render as a card. Same sentence for every
  // handle, so it discloses nothing about who exists.
  if (resolved.kind === "unreadable") {
    return (
      <main className="mx-auto max-w-[210mm] px-4 py-12">
        <h1 className="text-lg font-bold text-gray-900">Nothing has been printed</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          This address could not be read just now, so no card, no poster and no code has been drawn.
          Printing something we could not verify is the one mistake these sheets cannot recover from.
          Please try again shortly.
        </p>
      </main>
    );
  }
  if (resolved.kind === "none") notFound();

  const p = resolved.profile;
  if (!p.handle) notFound();

  // ⚠ ONE COMPOSITION. `url` is what is printed; `qr` encodes bookingUrl(p.handle) inside the generator.
  // Both resolve to the same call, so there is no second literal to drift.
  const url = bookingUrl(p.handle);
  const qr = await bookingQr(p.handle, "svg");

  const sheet = "mx-auto my-6 bg-white text-gray-900 print:my-0 print:break-after-page";

  return (
    <main className="bg-gray-100 py-8 print:bg-white print:py-0">
      <style>{`@page { margin: 12mm } @media print { .no-print { display: none } }`}</style>

      <div className="no-print mx-auto mb-6 max-w-[210mm] px-4">
        <h1 className="text-lg font-bold">Print assets for @{p.handle}</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-gray-600">
          Three sheets: an appointment card, a business card and an A4 poster. Print this page, or use
          your browser&rsquo;s &ldquo;Save as PDF&rdquo;. Every asset carries the same address and the
          same code &mdash; <span className="font-mono">{url}</span> &mdash; and that address keeps
          working even if this handle is changed later.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-500">
          Nothing here shows a rating, a review count, a patient total, a response time or a verified
          badge. Nothing in this product measures or checks any of those, and a card is not the place to
          print a figure nobody stands behind.
        </p>
      </div>

      {/* ── 1. APPOINTMENT CARD (A7-ish, handed to a patient at the desk) ─────────────────────────── */}
      <section className={`${sheet} w-[105mm] rounded-lg border border-gray-300 p-5 shadow-sm print:shadow-none`}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Your next appointment</p>
        <p className="mt-2 text-[15px] font-bold">{p.displayName}</p>
        {p.qualifications && <p className="text-[11px] text-gray-600">{p.qualifications}</p>}
        {p.specialties && <p className="text-[11px] text-gray-600">{p.specialties}</p>}

        <div className="mt-4 border-t border-dashed border-gray-300 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Date and time</p>
          {/* ⚠ A RULED LINE, NOT A DATE. This card is printed in advance, in a batch, before any of the
              appointments on it exist -- so the date is written on by hand at the desk. Printing a
              plausible-looking date here would be printing a fiction onto a patient's reminder. */}
          <div className="mt-3 h-px w-full bg-gray-300" />
          <div className="mt-5 h-px w-full bg-gray-300" />
        </div>

        <div className="mt-4 flex items-end gap-3">
          <div className="w-[22mm] shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">Book or change online</p>
            <p className="break-all font-mono text-[9px] text-gray-700">{url}</p>
          </div>
        </div>
      </section>

      {/* ── 2. BUSINESS CARD (85 x 55 mm) ────────────────────────────────────────────────────────── */}
      <section className={`${sheet} flex w-[85mm] items-center gap-3 rounded-lg border border-gray-300 p-4 shadow-sm print:shadow-none`}>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-tight">{p.displayName}</p>
          {p.specialties && <p className="text-[10px] text-gray-600">{p.specialties}</p>}
          {p.qualifications && <p className="text-[9px] text-gray-500">{p.qualifications}</p>}
          <p className="mt-2 font-mono text-[9px] text-gray-500">@{p.handle}</p>
          <p className="break-all font-mono text-[8px] text-gray-500">{url}</p>
          {/* The practitioner number, because it is the identifier that never changes and it is already
              printed on the public profile. */}
          <p className="mt-1 text-[8px] text-gray-400">{p.practitionerNumber}</p>
        </div>
        <div className="w-[20mm] shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
      </section>

      {/* ── 3. A4 POSTER (waiting room, notice board) ────────────────────────────────────────────── */}
      <section className={`${sheet} flex w-[210mm] flex-col items-center rounded-lg border border-gray-300 px-10 py-14 text-center shadow-sm print:border-0 print:shadow-none`}>
        <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-gray-400">Book with</p>
        <h2 className="mt-3 text-[34px] font-bold leading-tight">{p.displayName}</h2>
        {p.specialties && <p className="mt-1 text-[17px] text-gray-700">{p.specialties}</p>}
        {p.qualifications && <p className="mt-0.5 text-[13px] text-gray-500">{p.qualifications}</p>}

        <div className="mt-8 w-[70mm]" dangerouslySetInnerHTML={{ __html: qr }} />

        <p className="mt-6 text-[14px] font-semibold text-gray-700">Scan to book</p>
        <p className="mt-1 break-all font-mono text-[12px] text-gray-600">{url}</p>

        {p.bookingNote && <p className="mt-6 max-w-[140mm] text-[12px] text-gray-600">{p.bookingNote}</p>}
        <p className="mt-10 text-[10px] uppercase tracking-widest text-gray-400">Competen Practice</p>
      </section>
    </main>
  );
}
