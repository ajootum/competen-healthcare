import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPracticeMembership } from "@/lib/practice/shell";
import { pageMetadata } from "@/lib/marketing/site";

// /practice/sign-up (CPR-IAM-001 s8). The real self-service form is a CONTROLLED-LAUNCH deliverable,
// gated by the practice_public_signup flag (OFF, migration 191): a signup form that created real
// accounts on a product that is not open would be worse than a fake one. The provisioning machinery it
// will call is already live and harness-proven through the pilot path -- what is missing is the decision
// to open the door, and per IAM-001 s14.1 that comes after the private pilot, not before it. Until then
// this page says exactly that, and deliberately collects nothing.

export const metadata = pageMetadata({
  title: "Create your Competen Practice",
  description: "Individual practitioner signup for Competen Practice.",
  path: "/practice/sign-up",
});

export const dynamic = "force-dynamic";

export default async function Page() {
  if (await hasPracticeMembership()) redirect("/practice/home");

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <span className="w-9 h-9 rounded-full bg-[#2563EB] flex items-center justify-center text-white font-bold">C</span>
          <span className="text-lg font-bold text-gray-900">competen<span className="text-[#2563EB]">Practice</span></span>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <h1 className="text-lg font-bold text-gray-900">Signup is not open yet</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Competen Practice provisioning runs in a controlled pilot first. Public self-service signup
            opens after the pilot completes; until then no account can be created from this page, and we
            would rather tell you that than collect an email for a waiting list that does not exist.
          </p>
          <p className="mt-4 text-[13px] text-gray-500">
            See what you will get at{" "}
            <Link href="/practice" className="font-semibold text-[#1D4ED8] hover:underline">Competen Practice</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
