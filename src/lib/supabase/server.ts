import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * The same privileged client, but `null` instead of a throw when the environment cannot supply one.
 *
 * ⚠ FOR PUBLIC PAGES THAT READ A LAUNCH FLAG, AND NOT AS A GENERAL ESCAPE HATCH (COMP-ENG-002 §7).
 * `createAdminClient()` above passes `SUPABASE_SERVICE_ROLE_KEY!` straight to supabase-js, which throws
 * "supabaseKey is required" on undefined -- at CONSTRUCTION, before any caller's error handling runs.
 *
 * That defeated a fail-safe somebody had already written on purpose. `platformFlag` catches its own read
 * error and returns false precisely so "a flag read failing must not take a public marketing page down
 * with it" -- but the call was `platformFlag(createAdminClient(), ...)`, and an argument is evaluated
 * before the function it is passed to. The safety net sat downstream of the thing that broke, on five
 * unauthenticated pages: /practice/sign-in, /practice/login, /practice/sign-up, /signup and every
 * marketing JourneyPage with a gate.
 *
 * ⚠ THIS IS A MITIGATION, NOT THE FIX. The real question COMP-ENG-002 §7 asks is whether these pages
 * need privileged access at all, and they do not -- they read one boolean from
 * `practice_platform_flags`. They need it only because that table has RLS enabled with no policy, so an
 * anon client reads nothing. A policy permitting anon SELECT on launch flags would remove the privileged
 * dependency outright, but RLS posture on practice_* is a governance decision with real blast radius
 * (CLAUDE.md § Tenant and data isolation), not a drive-by migration. Recorded, not taken.
 *
 * Anything genuinely privileged -- a write, a cross-tenant read, an auth admin call -- must keep using
 * `createAdminClient()` and fail loudly. Degrading those to null would turn a misconfiguration into
 * silently missing data, which is far worse than a crash.
 */
export function createAdminClientOrNull() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createAdminClient();
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component — cookies will be set by middleware
          }
        },
      },
    }
  );
}
