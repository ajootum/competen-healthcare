import { redirect } from "next/navigation";

// /my -> /dashboard. PLAT-ROUTE-001 names the personal landing /my (My Competen); the built landing is
// /dashboard and roughly every guard in the codebase redirects there. The owner's decision (2026-08-11):
// ALIAS, not rename -- the spec's URL works, nothing else moves. Same shape as the deferred /hq rename,
// and if the full rename ever happens, this file is where it starts.
//
// ⚠ redirect, NOT permanentRedirect: a 308 would let browsers cache the alias so hard that a future
// rename to /my-as-canonical could not take it back.
export default function Page() {
  redirect("/dashboard");
}
