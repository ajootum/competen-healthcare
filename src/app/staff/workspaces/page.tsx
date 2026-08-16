import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveStaffGateway } from "@/lib/staff/gateway";

// /staff/workspaces -- the staff workspace selector and its no-access states
// (COMP-STAFF-ACCESS-001 s7 steps 3-7, s11, s15).
//
// ⚠ THE LIST IS ONLY WHAT IS HELD. Destinations come from the same resolver the Workspace Launcher
// and GlobalHeader use (workspaceLinksForUser -- "the gate's own condition, no looser and no
// tighter"), so nothing here can be offered that its gate then refuses, and no inaccessible
// destination is shown as a disabled teaser (ARCH s14). Every destination re-authorises itself on
// arrival: this page routes, it grants nothing.
//
// ⚠ EXACTLY ONE CONTEXT STILL RENDERS THE PAGE, as a confirm rather than a silent redirect -- the
// spec allows "route or confirm" (s7 step 7) and a person crossing an internal trust boundary should
// see which door they are walking through. It also keeps this surface free of redirect loops by
// construction.
//
// ⚠ EVERY NO-ACCESS STATE IS A SENTENCE WITH AN EXIT, never a privileged fallback (s15): who you
// are signed in as, what is true of this account, and where to go -- sign out, support, or the
// product that actually holds you.

export const metadata = {
  title: "Your workspaces — Competen Staff Access",
  description: "The internal workspaces this account currently holds.",
};

export const dynamic = "force-dynamic";

function Frame({ name, children }: { name: string | null; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0f1923] flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-white text-sm font-bold">C</span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold text-white">competen</span>
            <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-teal-400">Staff Access</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          {/* The active identity, made obvious (spec s24) -- it is the viewer's own session. */}
          <span className="text-[12px] text-gray-400">
            Signed in as <span className="font-semibold text-gray-200">{name ?? "this account"}</span>
          </span>
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="text-[12px] text-gray-400 hover:text-white hover:underline">Sign out</button>
          </form>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}

/** The support path every refusal carries -- a person, not a void (spec s15). */
function SupportLine() {
  return (
    <p className="mt-4 text-[12px] text-gray-500">
      If you expected access, contact the person who appointed you, or{" "}
      <a href="mailto:gabriel@semacast.com?subject=Competen%20staff%20access" className="font-semibold text-teal-400 hover:underline">
        Competen support
      </a>.
    </p>
  );
}

export default async function StaffWorkspacesPage() {
  const res = await resolveStaffGateway();
  if (res.state === "AUTH_REQUIRED") redirect("/staff");
  const { decision, fullName } = res;

  if (decision.state === "PRACTICE_ONLY") {
    return (
      <Frame name={fullName}>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-7">
          <h1 className="text-lg font-bold text-white">This account belongs to Competen Practice</h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-gray-400">
            Staff access is for Competen personnel and appointed leaders, and this account holds no
            Competen Platform membership. Your product is one step away — nothing is wrong with your
            account.
          </p>
          <Link href={decision.destination}
            className="mt-5 inline-block rounded-xl bg-teal-700 px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-teal-800">
            Go to Competen Practice →
          </Link>
          <SupportLine />
        </div>
      </Frame>
    );
  }

  if (decision.state === "ACCESS_WITHDRAWN") {
    return (
      <Frame name={fullName}>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-7">
          <h1 className="text-lg font-bold text-white">Your appointment is no longer active</h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-gray-400">
            This account has held an appointment, but none of its appointments currently grants
            access — an appointment stops opening workspaces the moment it ends, is suspended or is
            revoked. No workspace can be offered here until one is active again.
          </p>
          <SupportLine />
        </div>
      </Frame>
    );
  }

  if (decision.state === "INSUFFICIENT") {
    return (
      <Frame name={fullName}>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-7">
          <h1 className="text-lg font-bold text-white">Your appointment does not open a workspace here</h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-gray-400">
            This account holds an active appointment, but it does not currently open any workspace
            through this gateway — its position may be deactivated, its grants may have been
            withdrawn, or its workspace may be reached another way. You are signed in; there is
            simply nothing this door can open for you today.
          </p>
          <SupportLine />
        </div>
      </Frame>
    );
  }

  if (decision.state === "NO_APPOINTMENT") {
    return (
      <Frame name={fullName}>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-7">
          <h1 className="text-lg font-bold text-white">No authorised workspace</h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-gray-400">
            Staff workspaces are opened by appointment and by organisation role, and this account
            currently holds neither. Signing in proves who you are; it does not by itself grant any
            internal workspace — that is how this door is meant to work.
          </p>
          <p className="mt-3 text-[13px] text-gray-400">
            Everything your account does hold lives in{" "}
            <Link href="/dashboard" className="font-semibold text-teal-400 hover:underline">your Competen dashboard</Link>.
          </p>
          <SupportLine />
        </div>
      </Frame>
    );
  }

  // SELECT -- at least one genuinely held destination.
  const { workspaces, governanceContexts } = decision;
  return (
    <Frame name={fullName}>
      <h1 className="text-xl font-bold text-white">Your workspaces</h1>
      <p className="mt-1 text-[13px] text-gray-400">
        {workspaces.length === 1
          ? "This is the one workspace your account opens today."
          : "These are the workspaces your account opens today. Choose where you are working."}
      </p>

      <div className="mt-5 grid gap-3">
        {workspaces.map(w => (
          <Link key={w.href} href={w.href}
            className="group rounded-2xl bg-white/5 border border-white/10 p-5 hover:bg-white/10 hover:border-teal-500/40 transition-colors">
            <div className="flex items-center gap-3">
              <span aria-hidden className="text-xl">{w.icon}</span>
              <div className="flex-1">
                <p className="text-[14.5px] font-bold text-white">{w.label}</p>
                {/* Under the HQ door: the appointment(s) it rests on, so a multi-appointment person
                    sees WHAT they hold (spec s11 "display the effective appointment/role"). */}
                {w.href === "/super-admin" && governanceContexts.length > 0 && (
                  <p className="mt-0.5 text-[12px] text-gray-400">
                    {governanceContexts.map(c =>
                      c.productLineCode ? `${c.positionName} — ${c.productLineCode}` : c.positionName,
                    ).join(" · ")}
                  </p>
                )}
              </div>
              <span aria-hidden className="text-gray-500 group-hover:text-teal-400 transition-colors">→</span>
            </div>
          </Link>
        ))}
      </div>

      <p className="mt-5 text-[12px] text-gray-500">
        Each workspace checks your access again when you enter — this list opens doors, it does not
        create authority. Everything else on your account lives in{" "}
        <Link href="/dashboard" className="font-semibold text-teal-400 hover:underline">your Competen dashboard</Link>.
      </p>
    </Frame>
  );
}
