import Link from "next/link";

/**
 * The Staff Access frame (COMP-STAFF-ACCESS-001 s24): the wordmark, who is signed in, and a way out.
 * Shared by /staff/workspaces and /staff/profile so the staff surface stays one look.
 *
 * `profileHref` adds a "My profile" link (owner review GO 2026-10-23, PR D item 3). The caller passes it
 * only when the viewer holds HQ access: it is how an HQ appointee WITHOUT estate membership -- who lands
 * here, and can enter no estate shell -- reaches their own profile. It grants nothing; the profile page
 * re-checks HQ access itself.
 */
export default function StaffFrame({ name, profileHref, wide = false, children }: {
  name: string | null; profileHref?: string | null; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0f1923] flex flex-col">
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-white text-sm font-bold">C</span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold text-white">competen</span>
            <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-teal-400">Staff Access</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {/* The active identity, made obvious (spec s24) -- it is the viewer's own session. */}
          <span className="text-[12px] text-gray-400">
            Signed in as <span className="font-semibold text-gray-200">{name ?? "this account"}</span>
          </span>
          {profileHref && (
            <Link href={profileHref} className="text-[12px] text-gray-400 hover:text-white hover:underline">My profile</Link>
          )}
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="text-[12px] text-gray-400 hover:text-white hover:underline">Sign out</button>
          </form>
        </div>
      </header>
      <main className={`flex-1 flex ${wide ? "items-start" : "items-center"} justify-center p-6`}>
        <div className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"}`}>{children}</div>
      </main>
    </div>
  );
}
