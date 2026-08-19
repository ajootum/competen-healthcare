import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  getFormat, formatHistory, formatPractitionerNumber, FORMAT_CHANGE_ACKNOWLEDGEMENT,
} from "@/lib/practice/identifier-format";
import IdentifierFormatConsole from "./IdentifierFormatConsole";
import { requireHqCapability } from "@/lib/hq/context";

// /super-admin/platform-ops/practice/identifiers -- the shape of the practitioner number.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// DIFFICULT TO CHANGE, AND IT CHANGES EVERYWHERE -- two requirements that pull against each other, and
// the tension is resolved by being precise about what "everywhere" means.
//
// IT DOES NOT MEAN REWRITING NUMBERS ALREADY ISSUED. PIS-000 s2 says permanent and never reused, and an
// issued number is printed on cards, encoded into QR codes and saved in patients' phones. Rewriting it
// would mean it was never permanent.
//
// IT MEANS: one place in the codebase knows the shape, so agreeing a new one reaches every future
// issuance, every validator and every parser at once -- and each identity records the version it was
// issued under, so which shape a number follows is answerable rather than guessed.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function IdentifierFormats() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  /**
   * The profiles read that used to be here selected role and roles and used NEITHER. CPR-PD-014 section
   * 9 forbids profiles.role as an authorization input, and the real gate is requireHqCapability below.
   * Removed rather than narrowed, because nothing on this page needs a profile at all.
   */
  await requireHqCapability("hq.practice.operations.view");

  const [format, history] = await Promise.all([getFormat(admin), formatHistory(admin)]);
  const { count: issued } = await admin.from("practice_practitioner_identity")
    .select("*", { count: "exact", head: true });

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link>
          <span>/</span>
          <Link href="/super-admin/platform-ops/practice" className="hover:text-teal-700">Competen Practice</Link>
          <span>/</span><span className="text-gray-600">Identifiers</span>
        </div>
        <h1 className="mt-0.5 text-2xl font-bold text-gray-900">Practitioner number format</h1>
        <p className="text-sm text-gray-500">
          The shape of a permanent identifier that patients type and that gets printed onto cards.
        </p>
      </div>

      {/* ── What it is now ──────────────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-gray-900">Current format</h2>
          <span className="text-xs text-gray-500">
            version {format.version} · {issued ?? 0} number{(issued ?? 0) === 1 ? "" : "s"} issued
            {format.locked ? " · locked" : ""}
          </span>
        </div>
        <p className="mt-2 font-mono text-2xl font-bold text-gray-900">
          {formatPractitionerNumber(1, format)}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          The one-thousandth would be {formatPractitionerNumber(1000, format)}; the last one this format
          can hold is {formatPractitionerNumber(Math.pow(10, format.digits) - 1, format)}.
        </p>

        <dl className="mt-3 grid sm:grid-cols-4 gap-3 text-xs">
          {[
            ["Prefix", format.prefix],
            ["Digits", String(format.digits)],
            ["Check digit", format.checkDigit ? "yes (Damm)" : "no"],
            ["Separator", format.separator || "none"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold text-gray-500">{k}</dt>
              <dd className="text-gray-900">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Why it looks like this ──────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-bold text-gray-900">Why this shape was proposed</h2>
        <ul className="mt-2 flex flex-col gap-2 text-xs text-gray-600">
          <li>
            <span className="font-semibold text-gray-800">CP, not CPR.</span> PIS-000 §2 writes
            CPR-000001. In this codebase a bare CPR-nnn is a <em>specification</em> id — CPR-240 is the
            portfolio spec — and the two would differ only by digit count, which is a distinction a
            person skimming a support ticket will miss.
          </li>
          <li>
            <span className="font-semibold text-gray-800">A check digit, which is the substantive part.</span>{" "}
            PIS-000 §11 lets a patient find a practitioner by number. Without one,{" "}
            <span className="font-mono">{formatPractitionerNumber(132, format)}</span> would be exactly as
            valid as <span className="font-mono">{formatPractitionerNumber(123, format)}</span> and would
            resolve to <em>a different real clinician</em> — the patient reaches the wrong person and
            nothing notices, because both numbers are real. Damm&rsquo;s algorithm catches every
            single-digit error and every transposition of adjacent digits: the two mistakes people
            actually make typing or reading aloud.
          </li>
          <li>
            <span className="font-semibold text-gray-800">Six digits</span> holds 999,999 practitioners.
            Widening later is allowed; narrowing below the numbers already allocated is refused.
          </li>
        </ul>
      </section>

      {/* ── Changing it ─────────────────────────────────────────────────────────────────────────── */}
      <IdentifierFormatConsole
        format={{
          prefix: format.prefix, digits: format.digits,
          checkDigit: format.checkDigit, separator: format.separator,
          version: format.version, locked: format.locked,
        }}
        issued={issued ?? 0}
        acknowledgement={FORMAT_CHANGE_ACKNOWLEDGEMENT}
      />

      {/* ── History ─────────────────────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-bold text-gray-900">Changes</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">
            The format has not been changed since it was seeded.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {history.map((h: {
              id: string; version: number; prefix: string; digits: number; separator: string;
              check_digit: boolean; previous: { prefix?: string; digits?: number } | null;
              change_reason: string | null; changed_at: string;
            }) => (
              <li key={h.id} className="border-b border-gray-100 py-2 last:border-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-mono text-xs text-gray-900">
                    {h.previous?.prefix ?? "?"}-{"0".repeat(h.previous?.digits ?? 6)} → {h.prefix}
                    {h.separator}{"0".repeat(h.digits)}{h.check_digit ? `${h.separator}n` : ""}
                  </span>
                  <span className="ml-auto text-[11px] text-gray-500">
                    v{h.version} · {String(h.changed_at).slice(0, 10)}
                  </span>
                </div>
                {h.change_reason && <p className="mt-0.5 text-xs text-gray-600">{h.change_reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
