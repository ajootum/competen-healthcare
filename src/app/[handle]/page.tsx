import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveHandle, bookingQr, NOT_BUILT } from "@/lib/practice/identity-service";

// /@handle -- PIS-000 s8, the canonical practitioner URL.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// AT THE ROOT, BECAUSE THAT IS WHERE THE SPEC PUTS IT: https://practice.competenhealthcare.com/@handle.
//
// A root-level dynamic segment sounds alarming next to /students, /hospitals and /practice, and is not:
// Next.js gives a STATIC segment precedence over a dynamic one, so every existing page keeps its path
// and only an unmatched single segment reaches here. Anything not beginning with '@' is handed to a 404,
// which is exactly what it got before this route existed -- so no previously-working URL changes and no
// previously-404ing URL starts rendering.
//
// A HIDDEN PRACTITIONER IS A 404, NOT A REFUSAL. "This person exists but will not see you" is a
// disclosure about a named individual; nothing here distinguishes it from a handle never issued.
//
// s7: only a practitioner who chose 'public' is indexable. Everybody else is noindex -- the position the
// site already takes for /verify, where unguessable is not the same as unpublished.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

function handleFrom(segment: string): string | null {
  let decoded = segment;
  try { decoded = decodeURIComponent(segment); } catch { return null; }
  return decoded.startsWith("@") ? decoded.slice(1) : null;
}

export async function generateMetadata({ params }: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const handle = handleFrom((await params).handle);
  if (!handle) return { robots: { index: false, follow: false } };

  const resolved = await resolveHandle(createAdminClient(), handle);
  if (resolved.kind !== "found") return { robots: { index: false, follow: false } };

  const listed = resolved.profile.discovery === "public";
  return {
    title: `${resolved.profile.displayName} — Competen Practice`,
    description: resolved.profile.specialties ?? undefined,
    robots: { index: listed, follow: listed },
  };
}

export default async function PractitionerPage({ params }: {
  params: Promise<{ handle: string }>;
}) {
  const handle = handleFrom((await params).handle);
  if (!handle) notFound();

  const resolved = await resolveHandle(createAdminClient(), handle);
  // s8: legacy URLs redirect automatically after a handle change, so printed cards keep working.
  if (resolved.kind === "redirect") redirect(resolved.to);
  if (resolved.kind === "none") notFound();

  const p = resolved.profile;
  const qr = p.handle ? await bookingQr(p.handle, "svg") : null;
  const otpGap = NOT_BUILT.find(n => n.key === "otp_booking")!;

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <header>
        <p className="text-[12px] font-semibold text-[var(--cp-primary-deep)]">@{p.handle}</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">{p.displayName}</h1>
        {p.qualifications && <p className="mt-0.5 text-[13px] text-gray-600">{p.qualifications}</p>}
        {p.specialties && <p className="mt-0.5 text-[13px] text-gray-600">{p.specialties}</p>}
        <p className="mt-1 text-[11px] text-gray-400">{p.practitionerNumber}</p>
      </header>

      {p.biography && (
        <section className="mt-6">
          <h2 className="text-[13px] font-bold text-gray-900">About</h2>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-gray-700">{p.biography}</p>
        </section>
      )}

      <div className="mt-6 grid sm:grid-cols-2 gap-4">
        {p.languages && (
          <section>
            <h2 className="text-[12px] font-bold text-gray-900">Languages</h2>
            <p className="mt-0.5 text-[13px] text-gray-700">{p.languages}</p>
          </section>
        )}
        {p.consultationTypes && (
          <section>
            <h2 className="text-[12px] font-bold text-gray-900">Consultation types</h2>
            <p className="mt-0.5 text-[13px] text-gray-700">{p.consultationTypes}</p>
          </section>
        )}
      </div>

      {/* ── Booking (s11) ────────────────────────────────────────────────────────────────────────── */}
      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Booking</h2>
        {p.bookingNote && <p className="mt-1 text-[12px] text-gray-600">{p.bookingNote}</p>}
        {/* THE ONE PART OF s11 THAT CANNOT BE BUILT, said here rather than behind a button that would
            fail at the last step. */}
        <p className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3 text-[11px] text-gray-600">
          <span className="font-semibold text-gray-700">{otpGap.label}.</span> {otpGap.detail}
        </p>
        <p className="mt-2 break-all text-[11px] text-gray-500">{p.bookingUrl}</p>
      </section>

      {qr && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Scan to reach this page</h2>
          <div className="mt-2 flex items-start gap-4 flex-wrap">
            {/* Drawn in this process from the URL above. No external image service ever sees it, so a
                printed card does not depend on somebody else's server still being up. */}
            <div className="w-40 shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="min-w-0 flex-1 text-[11px] text-gray-500">
              This code encodes the address on this page and nothing else.
            </p>
          </div>
        </section>
      )}

      <p className="mt-8 text-[11px] text-gray-400">
        <Link href="/practice" className="hover:underline">Competen Practice</Link>
        {p.discovery !== "public" && " · this page is not listed in search"}
      </p>
    </div>
  );
}
