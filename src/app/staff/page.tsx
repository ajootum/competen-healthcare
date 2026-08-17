import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pageMetadata } from "@/lib/marketing/site";
import StaffSignInForm from "./StaffSignInForm";

// /staff -- the Competen Staff Access gateway (COMP-STAFF-ACCESS-001 s4/s7 step 1-2), the first
// machinery behind the public footer's "Competen Staff Access" label.
//
// ⚠ ONE IDENTITY, A DIFFERENT DOOR. This page authenticates through the SAME GoTrue project as
// every other surface (the form posts to /api/auth/login; SSO rides the shared start route). What
// makes it the staff door is what happens AFTER identity is proven: /staff/workspaces resolves
// appointments and roles against what this account actually holds, and refuses the staff
// environment in words when it holds nothing. Authentication proves identity; appointments and
// capabilities determine authority -- the spec's primary principle, already this estate's rule.
//
// ⚠ THE TRUST BOUNDARY IS STATED ON THE PAGE (spec s24): a practitioner or customer reading this
// door is told, before typing anything, that their sign-in lives elsewhere -- not discovered after.
//
// ⚠ NO MFA STEP IS RENDERED AND NONE IS CLAIMED. The spec mandates staff MFA; the estate has no
// TOTP machinery (decided, not built -- docs/COMP-ACCESS-SURVEY-001.md s6.4). A fake challenge
// screen would be a painted door. When MFA exists, it slots between this form and the resolver.

export const metadata = pageMetadata({
  title: "Competen Staff Access",
  description: "The internal access gateway for Competen personnel and appointed leaders.",
  path: "/staff",
});

export const dynamic = "force-dynamic";

export default async function StaffGatewayPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Already signed in: identity is proven, so the only question left is the resolver's -- unless a
  // route sent them here with somewhere to be (s14's bookmark restoration). Validated to a single
  // leading slash, because "//evil.example" is a valid pathname; the destination re-authorises
  // itself on arrival as every staff route does.
  if (user) {
    const raw = (await searchParams).next;
    const asked = Array.isArray(raw) ? raw[0] : raw;
    redirect(asked && asked.startsWith("/") && !asked.startsWith("//") ? asked : "/staff/workspaces");
  }

  return (
    <div className="min-h-screen bg-[#0f1923] flex flex-col">
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2.5 justify-center mb-2">
            <span className="w-9 h-9 rounded-full bg-teal-600 flex items-center justify-center text-white font-bold">C</span>
            <span className="leading-tight">
              <span className="block text-lg font-bold text-white">competen</span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-teal-400">Staff Access</span>
            </span>
          </div>
          <p className="text-center text-[12.5px] text-gray-400 mb-6">
            The internal entrance for Competen personnel and appointed leaders.
          </p>

          <StaffSignInForm />

          {/* ⚠ The boundary, stated where it can still redirect someone (spec s24: the label "must
              clearly distinguish internal access from practitioner/customer sign-in"). */}
          <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-[12px] leading-relaxed text-gray-400">
              This is not the sign-in for practitioners or customers. If you use Competen Practice, your
              door is{" "}
              <Link href="/practice/sign-in" className="font-semibold text-teal-400 hover:underline">Practice sign-in</Link>;
              for everything else on your Competen account, use{" "}
              <Link href="/login" className="font-semibold text-teal-400 hover:underline">the Competen sign-in</Link>.
            </p>
          </div>
        </div>
      </main>

      <footer className="px-6 py-5 text-center text-[12px] text-gray-500">
        <Link href="/" className="hover:text-gray-300 transition-colors">← Competen home</Link>
      </footer>
    </div>
  );
}
