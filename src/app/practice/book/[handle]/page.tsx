import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveHandle, bookingQr } from "@/lib/practice/identity-service";
import { publicBookingEntry } from "@/lib/practice/patient-booking";

// /practice/book/@handle -- CPB-002's canonical practitioner URL.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THIS FILE USED TO LIVE AT src/app/[handle]/page.tsx, AT THE ROOT, AND THE MOVE IS THE POINT.
//
// PIS-000 s8 named https://practice.competenhealthcare.com/@handle and this route was built for it. The
// address is now https://competenhealthcare.com/practice/book/@handle: one domain, no subdomain, the
// path carrying the meaning. identity-service.ts records all three candidates and which was chosen.
//
// ---- WHAT THE ROOT ROUTE WAS CATCHING, AND WHY LOSING IT IS AN IMPROVEMENT --------------------------
//
// A root-level dynamic segment matches EVERY unmatched single top-level path. Next.js gives a static
// segment precedence, so it shadowed none of /students, /hospitals, /practice, /login and the rest, and
// robots.ts, sitemap.ts and favicon.ico are metadata routes that also outrank it. What it did catch was
// everything else: /foo, /pricing, /careers, a typo, a scanner probing for /wp-admin. Each of those was
// answered by a `force-dynamic` server render that opened an admin Supabase client before deciding the
// segment did not begin with '@' and calling notFound().
//
// So nothing was shadowed, and the status codes were the same -- but every 404 on a one-segment URL was
// a dynamic render, and any top-level route added later would have had to win a precedence argument
// nobody would have remembered to check. Under /practice/book/ the segment is reachable only beneath a
// static prefix, and an unmatched /foo is a plain 404 again.
//
// ---- ⚠ AND THE OLD PATH IS DELETED RATHER THAN REDIRECTED ------------------------------------------
//
// A route that silently stops resolving is how a printed link dies, so this was checked against the
// database rather than assumed: practice_practitioner_identity holds thirty rows and EVERY ONE has a
// null handle, practice_handle_history is empty and practice_booking_access is empty. No /@handle URL
// has ever resolved to anything, for anybody, so none can have been printed, shared or bookmarked.
// There is nothing to redirect. If a single handle had been claimed this would have been a permanent
// redirect instead, and it should be if that ever stops being true before launch.
//
// A HIDDEN PRACTITIONER IS A 404, NOT A REFUSAL. "This person exists but will not see you" is a
// disclosure about a named individual; nothing here distinguishes it from a handle never issued.
//
// s7: only a practitioner who chose 'public' is indexable. Everybody else is noindex -- the position the
// site already takes for /verify, where unguessable is not the same as unpublished.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

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
  // ⚠ A DATABASE THAT WOULD NOT ANSWER IS NOT A PRACTITIONER WHO DOES NOT EXIST. resolveHandle used to
  // discard its read errors and return `none`, so a failed read was served as a 404 -- to a patient
  // holding a printed card for a live, published clinician. This says what actually happened, and says
  // exactly the same thing whether or not the handle exists, so it discloses nothing.
  if (resolved.kind === "unreadable") {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-xl font-bold text-gray-900">This page could not be loaded just now</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          Nothing could be read about this address, so nothing here is a statement about whether it
          exists. This is a fault at our end rather than anything about the link you followed &mdash;
          please try again shortly.
        </p>
        <p className="mt-8 text-[11px] text-gray-400">
          <Link href="/practice" className="hover:underline">Competen Practice</Link>
        </p>
      </div>
    );
  }
  if (resolved.kind === "none") notFound();

  const p = resolved.profile;
  const qr = p.handle ? await bookingQr(p.handle, "svg") : null;
  // ⚠ READ, NOT WRITTEN INTO THE PAGE. This section used to render a hard-coded paragraph saying booking
  // could not be built, and that paragraph had quietly stopped being true. publicBookingEntry derives the
  // answer from the practice's published page and from whether a code could actually be delivered, so the
  // sentence below changes on its own rather than when somebody remembers to edit this file.
  const entry = p.handle ? await publicBookingEntry(createAdminClient(), p.handle) : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <header>
        <p className="text-[12px] font-semibold text-[var(--cp-primary-deep)]">@{p.handle}</p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">{p.displayName}</h1>
        {p.qualifications && <p className="mt-0.5 text-[13px] text-gray-600">{p.qualifications}</p>}
        {p.specialties && <p className="mt-0.5 text-[13px] text-gray-600">{p.specialties}</p>}
        {/* Its own line rather than appended to the specialty: a paediatric urologist is a paediatrician
            AND a urologist, and running the two together reads as one longer specialty name. */}
        {p.subSpecialty && <p className="text-[13px] text-gray-600">{p.subSpecialty}</p>}
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

      {/* ── Booking (s11; CPB-001 s5, s6) ───────────────────────────────────────────────────────── */}
      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Booking</h2>
        {p.bookingNote && <p className="mt-1 text-[12px] text-gray-600">{p.bookingNote}</p>}

        {/* ⚠ WHAT THIS PRACTICE OFFERS, AND ONLY WHERE IT CHOSE TO EXPOSE IT. CPB-001 s6: "Only fields
            explicitly approved for public display may be rendered." An empty list is drawn as nothing at
            all rather than as an empty heading -- absence is not a section. */}
        {entry?.state === "open" && entry.locations.length > 0 && (
          <div className="mt-3">
            <h3 className="text-[12px] font-bold text-gray-900">Where</h3>
            <ul className="mt-0.5 text-[13px] text-gray-700">
              {entry.locations.map(l => <li key={l.id}>{l.name}</li>)}
            </ul>
          </div>
        )}
        {entry?.state === "open" && entry.instructions && (
          <p className="mt-3 whitespace-pre-wrap text-[12px] text-gray-700">{entry.instructions}</p>
        )}

        {/* ⚠ NO BUTTON UNLESS A PATIENT COULD ACTUALLY FINISH. `canBook` is false whenever the practice
            has published nothing, a code could not reach anybody, or no patient-facing screen exists --
            and today the last of those is true everywhere. So this renders the reason, not a CTA that
            would fail at its last step. */}
        {entry && !entry.canBook && entry.whyNot && (
          <p className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3 text-[12px] leading-relaxed text-gray-600">
            {entry.whyNot}
          </p>
        )}
        {entry?.state === "unreadable" && (
          <p className="mt-2 text-[11px] text-gray-500">
            Nothing about this practice&rsquo;s booking has been assumed &mdash; the check itself did not complete.
          </p>
        )}

        <p className="mt-3 break-all text-[11px] text-gray-500">{p.bookingUrl}</p>
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
